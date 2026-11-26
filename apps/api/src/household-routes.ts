import {
  type Capability,
  can,
  CreateHouseholdInputSchema,
  type Household,
  type HouseholdResponse,
  MAX_HOUSEHOLDS_PER_USER,
  UpdateHouseholdInputSchema,
} from '@bdgtr/shared';
import type { Hono, MiddlewareHandler } from 'hono';
import { type Db, ObjectId } from 'mongodb';

import type { AuthVariables } from './auth.js';
import {
  countActiveMemberships,
  createHouseholdWithOwner,
  findActiveMembership,
  type HouseholdDoc,
  type MembershipDoc,
  softDeleteHousehold,
  updateHousehold,
} from './households.js';
import { type UserDoc, upsertUserFromAuth } from './users.js';
import { takeRequest } from './rate-limit.js';
import { parseJsonBody } from './validation.js';
import { ensureDefaultCategory } from './categories.js';

export type AppVariables = AuthVariables & {
  user: UserDoc;
  household: HouseholdDoc;
  membership: MembershipDoc;
};

type AppEnv = { Variables: AppVariables };

interface Deps {
  getDb: () => Promise<Db>;
  now: () => Date;
  /** Per-person request limits (rate-limit.ts). On in production; most tests leave it off. */
  rateLimit?: boolean;
}

function toHousehold(h: HouseholdDoc, m: MembershipDoc): Household {
  return {
    id: h._id.toHexString(),
    name: h.name,
    currency: h.currency,
    timezone: h.timezone,
    defaultMonthlyBudgetMinor: h.defaultMonthlyBudgetMinor,
    role: m.role,
  };
}

/** Loads (or on first contact creates) the signed-in user's record. Needs requireAuth first. */
export function loadUser(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { userId, email, name } = c.get('auth');
    const db = await deps.getDb();
    const retryAfter = deps.rateLimit ? await takeRequest(db, userId, c.req.method, deps.now()) : null;
    if (retryAfter !== null) {
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'rate_limited' }, 429);
    }
    c.set('user', await upsertUserFromAuth(db, { clerkUserId: userId, email, name }, deps.now()));
    await next();
  };
}

/**
 * Household-scoped routes: resolves `X-Household-Id` to the caller's ACTIVE
 * membership in a household that still exists, then checks the capability.
 * - 404 if the id is malformed, unknown, deleted, or the caller isn't a member
 *   (indistinguishable on purpose: no probing which households exist).
 * - 403 if they're a member but their role lacks the capability.
 * The household id is never taken from the request body.
 */
export function requireHousehold(deps: Deps, capability: Capability): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = c.req.header('X-Household-Id') ?? '';
    if (!ObjectId.isValid(raw) || raw.length !== 24) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    const found = await findActiveMembership(db, c.get('user')._id, new ObjectId(raw));
    if (!found) return c.json({ error: 'not_found' }, 404);
    if (!can(found.membership.role, capability)) return c.json({ error: 'forbidden' }, 403);
    c.set('household', found.household);
    c.set('membership', found.membership);
    await next();
  };
}

export function registerHouseholdRoutes(app: Hono<AppEnv>, auth: MiddlewareHandler<AppEnv>, deps: Deps) {
  const user = loadUser(deps);

  // Create a household; the caller becomes its House Owner.
  app.post('/households', auth, user, async (c) => {
    const input = await parseJsonBody(c, CreateHouseholdInputSchema);
    const db = await deps.getDb();
    const me = c.get('user');
    if ((await countActiveMemberships(db, me._id)) >= MAX_HOUSEHOLDS_PER_USER) {
      return c.json({ error: 'household_limit' }, 409);
    }
    const now = deps.now();
    const { household, membership } = await createHouseholdWithOwner(db, me._id, input, now);
    // Every household always has at least one category; new ones start with Groceries.
    await ensureDefaultCategory(db, household._id, me._id, now);
    return c.json<HouseholdResponse>({ household: toHousehold(household, membership) }, 201);
  });

  app.get('/household', auth, user, requireHousehold(deps, 'view'), (c) =>
    c.json<HouseholdResponse>({ household: toHousehold(c.get('household'), c.get('membership')) }),
  );

  app.patch('/household', auth, user, requireHousehold(deps, 'manage_household'), async (c) => {
    const input = await parseJsonBody(c, UpdateHouseholdInputSchema);
    const db = await deps.getDb();
    const updated = await updateHousehold(db, c.get('household')._id, input, deps.now());
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json<HouseholdResponse>({ household: toHousehold(updated, c.get('membership')) });
  });

  // House Owner only. Soft delete; purged after 30 days (docs/PLAN.md §3).
  app.delete('/household', auth, user, requireHousehold(deps, 'delete_household'), async (c) => {
    const db = await deps.getDb();
    await softDeleteHousehold(db, c.get('household')._id, deps.now());
    return c.body(null, 204);
  });

  return { loadUser: user };
}
