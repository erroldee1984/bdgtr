import { createHash, randomBytes } from 'node:crypto';

import { type AssignableRole, INVITE_TTL_DAYS, type Invite, type Role } from '@bdgtr/shared';
import { type Db, ObjectId } from 'mongodb';

import { HOUSEHOLDS, type HouseholdDoc, MEMBERSHIPS, type MembershipDoc } from './households.js';

/**
 * Invites (docs/PLAN.md §3): a random 256-bit token, only its SHA-256 hash is
 * stored, single use, expires in 7 days, bound to the invitee's email.
 */
export interface InviteDoc {
  _id: ObjectId;
  householdId: ObjectId;
  email: string;
  role: AssignableRole;
  tokenHash: string;
  status: 'pending' | 'accepted' | 'revoked';
  expiresAt: Date;
  invitedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  acceptedBy?: ObjectId;
}

/** Failed accept attempts, for rate limiting (expire on their own). */
interface InviteAttemptDoc {
  _id: ObjectId;
  userId: ObjectId;
  at: Date;
}

export const INVITES = 'invites';
export const INVITE_ATTEMPTS = 'inviteAttempts';
/** Failed accepts allowed per person per window before 429. */
export const MAX_FAILED_ACCEPTS = 10;
export const FAILED_ACCEPT_WINDOW_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function ensureInviteIndexes(db: Db): Promise<void> {
  const invites = db.collection<InviteDoc>(INVITES);
  await Promise.all([
    invites.createIndex({ tokenHash: 1 }, { unique: true, name: 'tokenHash_unique' }),
    invites.createIndex({ householdId: 1, status: 1 }, { name: 'household_status' }),
    // Clean up 30 days after expiry (accepted/revoked ones too).
    invites.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'ttl_cleanup' }),
    db
      .collection<InviteAttemptDoc>(INVITE_ATTEMPTS)
      .createIndex({ at: 1 }, { expireAfterSeconds: FAILED_ACCEPT_WINDOW_MS / 1000, name: 'ttl' }),
    db.collection<InviteAttemptDoc>(INVITE_ATTEMPTS).createIndex({ userId: 1, at: 1 }, { name: 'user_at' }),
  ]);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 random bytes, base64url without padding (43 characters). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function toInvite(doc: InviteDoc): Invite {
  return { id: doc._id.toHexString(), email: doc.email, role: doc.role, expiresAt: doc.expiresAt.toISOString() };
}

/** Pending, unexpired invites of a household, newest first. */
export async function listPendingInvites(db: Db, householdId: ObjectId, now: Date): Promise<InviteDoc[]> {
  return db
    .collection<InviteDoc>(INVITES)
    .find({ householdId, status: 'pending', expiresAt: { $gt: now } })
    .sort({ createdAt: -1, _id: -1 })
    .toArray();
}

export async function countPendingInvites(db: Db, householdId: ObjectId, now: Date): Promise<number> {
  return db.collection<InviteDoc>(INVITES).countDocuments({ householdId, status: 'pending', expiresAt: { $gt: now } });
}

/**
 * Creates an invite and returns it with its token (the only time the token
 * exists outside the person's hands). A pending invite to the same email in
 * this household is revoked, so there's only ever one working link per person.
 */
export async function createInvite(
  db: Db,
  input: { householdId: ObjectId; email: string; role: AssignableRole; invitedBy: ObjectId },
  now: Date,
): Promise<{ doc: InviteDoc; token: string }> {
  const invites = db.collection<InviteDoc>(INVITES);
  await invites.updateMany(
    { householdId: input.householdId, email: input.email, status: 'pending' },
    { $set: { status: 'revoked', updatedAt: now } },
  );
  const token = newToken();
  const doc: InviteDoc = {
    _id: new ObjectId(),
    householdId: input.householdId,
    email: input.email,
    role: input.role,
    tokenHash: hashToken(token),
    status: 'pending',
    expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS),
    invitedBy: input.invitedBy,
    createdAt: now,
    updatedAt: now,
  };
  await invites.insertOne(doc);
  return { doc, token };
}

/** Revokes a pending invite of this household. False if there's no such pending invite. */
export async function revokeInvite(db: Db, householdId: ObjectId, inviteId: ObjectId, now: Date): Promise<boolean> {
  const res = await db
    .collection<InviteDoc>(INVITES)
    .updateOne({ _id: inviteId, householdId, status: 'pending' }, { $set: { status: 'revoked', updatedAt: now } });
  return res.matchedCount === 1;
}

export async function findPendingInvite(
  db: Db,
  householdId: ObjectId,
  inviteId: ObjectId,
  now: Date,
): Promise<InviteDoc | null> {
  return db
    .collection<InviteDoc>(INVITES)
    .findOne({ _id: inviteId, householdId, status: 'pending', expiresAt: { $gt: now } });
}

export async function recentFailedAccepts(db: Db, userId: ObjectId, now: Date): Promise<number> {
  return db
    .collection<InviteAttemptDoc>(INVITE_ATTEMPTS)
    .countDocuments({ userId, at: { $gt: new Date(now.getTime() - FAILED_ACCEPT_WINDOW_MS) } });
}

export async function recordFailedAccept(db: Db, userId: ObjectId, now: Date): Promise<void> {
  await db.collection<InviteAttemptDoc>(INVITE_ATTEMPTS).insertOne({ _id: new ObjectId(), userId, at: now });
}

export type AcceptError = 'not_found' | 'invite_expired' | 'invite_used' | 'email_mismatch' | 'already_member';

/**
 * Either `error` is set, or `household` and `role` are. A flat shape (not an
 * { ok } union) so it type-checks the same with strictNullChecks off, as
 * Vercel compiles it.
 */
export interface AcceptResult {
  error: AcceptError | null;
  household?: HouseholdDoc;
  role?: Role;
}

/**
 * Accepts an invite for `user`. Checks, in order: the token exists; it's still
 * pending and unexpired; its household still exists; the signed-in email
 * matches the invite (so a forwarded link is useless); the person isn't
 * already a member. Then claims the invite atomically (single use, even with
 * two simultaneous accepts) and creates (or reactivates) the membership.
 */
export async function acceptInvite(
  db: Db,
  token: string,
  user: { _id: ObjectId; email: string | null },
  now: Date,
): Promise<AcceptResult> {
  const invites = db.collection<InviteDoc>(INVITES);
  const memberships = db.collection<MembershipDoc>(MEMBERSHIPS);
  const invite = await invites.findOne({ tokenHash: hashToken(token) });
  if (!invite) return { error: 'not_found' };
  if (invite.status !== 'pending') return { error: 'invite_used' };
  if (invite.expiresAt <= now) return { error: 'invite_expired' };

  const household = await db.collection<HouseholdDoc>(HOUSEHOLDS).findOne({ _id: invite.householdId, deletedAt: null });
  if (!household) return { error: 'invite_expired' };
  if (!user.email || user.email !== invite.email) return { error: 'email_mismatch' };

  const existing = await memberships.findOne({ householdId: invite.householdId, userId: user._id });
  if (existing?.status === 'active') return { error: 'already_member' };

  // Single use: only one request can move it from pending to accepted.
  const claimed = await invites.findOneAndUpdate(
    { _id: invite._id, status: 'pending', expiresAt: { $gt: now } },
    { $set: { status: 'accepted', acceptedBy: user._id, updatedAt: now } },
  );
  if (!claimed) return { error: 'invite_used' };

  try {
    if (existing) {
      // Someone who left or was removed earlier comes back with the invited role.
      await memberships.updateOne(
        { _id: existing._id, status: { $ne: 'active' } },
        { $set: { status: 'active', role: invite.role, joinedAt: now, updatedAt: now } },
      );
    } else {
      await memberships.insertOne({
        _id: new ObjectId(),
        householdId: invite.householdId,
        userId: user._id,
        role: invite.role,
        status: 'active',
        joinedAt: now,
        updatedAt: now,
        alertsMuted: false,
        dailyDigestEnabled: true,
      });
    }
  } catch (err) {
    // Give the invite back so it can be retried.
    await invites.updateOne({ _id: invite._id }, { $set: { status: 'pending', updatedAt: now }, $unset: { acceptedBy: '' } });
    throw err;
  }
  return { error: null, household, role: invite.role };
}
