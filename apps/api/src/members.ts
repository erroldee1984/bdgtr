import type { AssignableRole, Member, Role } from '@bdgtr/shared';
import { sortMembers } from '@bdgtr/shared';
import type { Db, ObjectId } from 'mongodb';

import { MEMBERSHIPS, type MembershipDoc } from './households.js';
import { USERS, type UserDoc } from './users.js';

/** Active members of a household, House Owner first (docs/PLAN.md §3). */
export async function listMembers(db: Db, householdId: ObjectId, callerId: ObjectId): Promise<Member[]> {
  const rows = await db
    .collection<MembershipDoc>(MEMBERSHIPS)
    .aggregate<{ userId: ObjectId; role: Role; joinedAt: Date; user: UserDoc | null }>([
      { $match: { householdId, status: 'active' } },
      { $lookup: { from: USERS, localField: 'userId', foreignField: '_id', as: 'user' } },
      { $set: { user: { $first: '$user' } } },
      { $project: { userId: 1, role: 1, joinedAt: 1, user: 1 } },
    ])
    .toArray();
  return sortMembers(
    rows.map((r) => ({
      userId: r.userId.toHexString(),
      name: r.user?.displayName ?? null,
      email: r.user?.email ?? null,
      role: r.role,
      joinedAt: r.joinedAt.toISOString(),
      isYou: r.userId.equals(callerId),
    })),
  );
}

export async function findActiveMember(db: Db, householdId: ObjectId, userId: ObjectId): Promise<MembershipDoc | null> {
  return db.collection<MembershipDoc>(MEMBERSHIPS).findOne({ householdId, userId, status: 'active' });
}

/**
 * Sets a member's role (Co-Owner ↔ House Member). Never touches the House
 * Owner's membership: the filter excludes it, so even a racing request can't.
 */
export async function setMemberRole(
  db: Db,
  householdId: ObjectId,
  userId: ObjectId,
  role: AssignableRole,
  now: Date,
): Promise<boolean> {
  const res = await db
    .collection<MembershipDoc>(MEMBERSHIPS)
    .updateOne({ householdId, userId, status: 'active', role: { $ne: 'owner' } }, { $set: { role, updatedAt: now } });
  return res.matchedCount === 1;
}

/** Ends a membership: `removed` by an Owner/Co-Owner, or `left` by the person themselves. Never the House Owner. */
export async function endMembership(
  db: Db,
  householdId: ObjectId,
  userId: ObjectId,
  status: 'removed' | 'left',
  now: Date,
): Promise<boolean> {
  const res = await db
    .collection<MembershipDoc>(MEMBERSHIPS)
    .updateOne({ householdId, userId, status: 'active', role: { $ne: 'owner' } }, { $set: { status, updatedAt: now } });
  return res.matchedCount === 1;
}

/**
 * Hands the House Owner role to another active member; the old Owner becomes a
 * Co-Owner. One transaction, so the household never has zero or two Owners
 * (the partial unique index also forbids two). Returns false if either side
 * is no longer valid.
 */
export async function transferOwnership(
  db: Db,
  householdId: ObjectId,
  fromUserId: ObjectId,
  toUserId: ObjectId,
  now: Date,
): Promise<boolean> {
  const memberships = db.collection<MembershipDoc>(MEMBERSHIPS);
  const session = db.client.startSession();
  try {
    let ok = false;
    await session.withTransaction(async () => {
      ok = false;
      const demoted = await memberships.updateOne(
        { householdId, userId: fromUserId, status: 'active', role: 'owner' },
        { $set: { role: 'co_owner', updatedAt: now } },
        { session },
      );
      if (demoted.matchedCount !== 1) {
        await session.abortTransaction();
        return;
      }
      const promoted = await memberships.updateOne(
        { householdId, userId: toUserId, status: 'active', role: { $ne: 'owner' } },
        { $set: { role: 'owner', updatedAt: now } },
        { session },
      );
      if (promoted.matchedCount !== 1) {
        await session.abortTransaction();
        return;
      }
      ok = true;
    });
    return ok;
  } finally {
    await session.endSession();
  }
}
