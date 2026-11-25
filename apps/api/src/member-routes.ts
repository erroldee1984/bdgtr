import {
  AcceptInviteInputSchema,
  type AcceptInviteResponse,
  can,
  canManageMember,
  ChangeRoleInputSchema,
  CreateInviteInputSchema,
  type CreatedInviteResponse,
  type InvitesResponse,
  MAX_HOUSEHOLDS_PER_USER,
  MAX_PENDING_INVITES,
  type MembersResponse,
  TransferOwnershipInputSchema,
} from '@bdgtr/shared';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { type Db, ObjectId } from 'mongodb';

import { type AppVariables, requireHousehold } from './household-routes.js';
import { countActiveMemberships } from './households.js';
import {
  acceptInvite,
  countPendingInvites,
  createInvite,
  findPendingInvite,
  listPendingInvites,
  MAX_FAILED_ACCEPTS,
  recentFailedAccepts,
  recordFailedAccept,
  revokeInvite,
  toInvite,
} from './invites.js';
import { endMembership, findActiveMember, listMembers, setMemberRole, transferOwnership } from './members.js';
import { USERS, type UserDoc } from './users.js';
import { parseJsonBody } from './validation.js';

type AppEnv = { Variables: AppVariables };

interface Deps {
  getDb: () => Promise<Db>;
  now: () => Date;
}

/** A path id as an ObjectId, or null (callers answer 404, never 400, for ids). */
function idParam(c: Context<AppEnv>, name: string): ObjectId | null {
  const raw = c.req.param(name) ?? '';
  return /^[0-9a-f]{24}$/.test(raw) ? new ObjectId(raw) : null;
}

const ACCEPT_ERRORS = {
  not_found: 404,
  invite_expired: 410,
  invite_used: 410,
  email_mismatch: 403,
  already_member: 409,
} as const;

/**
 * Members & invites (docs/PLAN.md §3, §5). Rules enforced here:
 * - Nobody changes or removes the House Owner; ownership only moves by transfer.
 * - House Members can view the members list and leave, nothing else.
 * - The House Owner can't leave without transferring ownership first.
 */
export function registerMemberRoutes(
  app: Hono<AppEnv>,
  auth: MiddlewareHandler<AppEnv>,
  loadUser: MiddlewareHandler<AppEnv>,
  deps: Deps,
) {
  const inHousehold = (capability: Parameters<typeof requireHousehold>[1]) => [auth, loadUser, requireHousehold(deps, capability)] as const;

  app.get('/members', ...inHousehold('view'), async (c) => {
    const db = await deps.getDb();
    return c.json<MembersResponse>({ members: await listMembers(db, c.get('household')._id, c.get('user')._id) });
  });

  app.patch('/members/:userId', ...inHousehold('manage_members'), async (c) => {
    const targetId = idParam(c, 'userId');
    const { role } = await parseJsonBody(c, ChangeRoleInputSchema);
    if (!targetId) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    const target = await findActiveMember(db, householdId, targetId);
    if (!target) return c.json({ error: 'not_found' }, 404);
    if (!canManageMember(c.get('membership').role, target.role)) return c.json({ error: 'forbidden' }, 403);
    if (!(await setMemberRole(db, householdId, targetId, role, deps.now()))) return c.json({ error: 'forbidden' }, 403);
    return c.body(null, 204);
  });

  // Remove someone (Owner / Co-Owner), or leave (anyone but the House Owner, on themselves).
  app.delete('/members/:userId', ...inHousehold('view'), async (c) => {
    const targetId = idParam(c, 'userId');
    if (!targetId) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    const me = c.get('membership');

    if (targetId.equals(me.userId)) {
      if (me.role === 'owner') return c.json({ error: 'owner_must_transfer' }, 409);
      await endMembership(db, householdId, targetId, 'left', deps.now());
      return c.body(null, 204);
    }

    if (!can(me.role, 'manage_members')) return c.json({ error: 'forbidden' }, 403);
    const target = await findActiveMember(db, householdId, targetId);
    if (!target) return c.json({ error: 'not_found' }, 404);
    if (!canManageMember(me.role, target.role)) return c.json({ error: 'forbidden' }, 403);
    if (!(await endMembership(db, householdId, targetId, 'removed', deps.now()))) return c.json({ error: 'forbidden' }, 403);
    return c.body(null, 204);
  });

  app.post('/members/transfer-ownership', ...inHousehold('transfer_ownership'), async (c) => {
    const { userId } = await parseJsonBody(c, TransferOwnershipInputSchema);
    const targetId = new ObjectId(userId);
    const me = c.get('membership');
    if (targetId.equals(me.userId)) return c.json({ error: 'already_owner' }, 409);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    if (!(await findActiveMember(db, householdId, targetId))) return c.json({ error: 'not_found' }, 404);
    if (!(await transferOwnership(db, householdId, me.userId, targetId, deps.now()))) {
      return c.json({ error: 'conflict' }, 409);
    }
    return c.body(null, 204);
  });

  app.get('/invites', ...inHousehold('manage_members'), async (c) => {
    const db = await deps.getDb();
    const invites = await listPendingInvites(db, c.get('household')._id, deps.now());
    return c.json<InvitesResponse>({ invites: invites.map(toInvite) });
  });

  app.post('/invites', ...inHousehold('manage_members'), async (c) => {
    const input = await parseJsonBody(c, CreateInviteInputSchema);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    const now = deps.now();

    // Already in the household? (Matched by the email they signed in with.)
    const invitee = await db.collection<UserDoc>(USERS).findOne({ email: input.email });
    if (invitee && (await findActiveMember(db, householdId, invitee._id))) {
      return c.json({ error: 'already_member' }, 409);
    }
    if ((await countPendingInvites(db, householdId, now)) >= MAX_PENDING_INVITES) {
      return c.json({ error: 'invite_limit' }, 409);
    }
    const { doc, token } = await createInvite(
      db,
      { householdId, email: input.email, role: input.role, invitedBy: c.get('user')._id },
      now,
    );
    return c.json<CreatedInviteResponse>({ invite: toInvite(doc), token }, 201);
  });

  // "Share again": only a hash of the old link is stored, so issue a fresh link (the old one stops working).
  app.post('/invites/:id/reissue', ...inHousehold('manage_members'), async (c) => {
    const inviteId = idParam(c, 'id');
    if (!inviteId) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    const now = deps.now();
    const old = await findPendingInvite(db, householdId, inviteId, now);
    if (!old) return c.json({ error: 'not_found' }, 404);
    const { doc, token } = await createInvite(
      db,
      { householdId, email: old.email, role: old.role, invitedBy: c.get('user')._id },
      now,
    );
    return c.json<CreatedInviteResponse>({ invite: toInvite(doc), token }, 201);
  });

  app.delete('/invites/:id', ...inHousehold('manage_members'), async (c) => {
    const inviteId = idParam(c, 'id');
    if (!inviteId) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    if (!(await revokeInvite(db, c.get('household')._id, inviteId, deps.now()))) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  // Accept: no X-Household-Id (the invite names the household).
  app.post('/invites/accept', auth, loadUser, async (c) => {
    const db = await deps.getDb();
    const me = c.get('user');
    const now = deps.now();
    if ((await recentFailedAccepts(db, me._id, now)) >= MAX_FAILED_ACCEPTS) {
      c.header('Retry-After', '900');
      return c.json({ error: 'too_many_attempts' }, 429);
    }
    const { token } = await parseJsonBody(c, AcceptInviteInputSchema);
    if ((await countActiveMemberships(db, me._id)) >= MAX_HOUSEHOLDS_PER_USER) {
      return c.json({ error: 'household_limit' }, 409);
    }
    const result = await acceptInvite(db, token, me, now);
    const error = result.error;
    if (error) {
      if (error !== 'already_member') await recordFailedAccept(db, me._id, now);
      return c.json({ error }, ACCEPT_ERRORS[error]);
    }
    const household = result.household!;
    return c.json<AcceptInviteResponse>({
      householdId: household._id.toHexString(),
      householdName: household.name,
      role: result.role!,
    });
  });
}
