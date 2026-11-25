import type { CreateHouseholdInput, Role, UpdateHouseholdInput } from '@bdgtr/shared';
import { type Db, ObjectId } from 'mongodb';

/** docs/PLAN.md §4 */
export interface HouseholdDoc {
  _id: ObjectId;
  name: string;
  currency: 'PHP';
  timezone: 'Asia/Manila';
  defaultMonthlyBudgetMinor: number;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  /** Soft delete: set when the House Owner deletes the household. */
  deletedAt: Date | null;
}

export interface MembershipDoc {
  _id: ObjectId;
  householdId: ObjectId;
  userId: ObjectId;
  role: Role;
  status: 'active' | 'removed' | 'left';
  joinedAt: Date;
  updatedAt: Date;
  alertsMuted: boolean;
  dailyDigestEnabled: boolean;
}

export const HOUSEHOLDS = 'households';
export const MEMBERSHIPS = 'memberships';

export async function ensureHouseholdIndexes(db: Db): Promise<void> {
  const memberships = db.collection<MembershipDoc>(MEMBERSHIPS);
  await Promise.all([
    memberships.createIndex({ householdId: 1, userId: 1 }, { unique: true, name: 'household_user_unique' }),
    memberships.createIndex({ userId: 1, status: 1 }, { name: 'user_status' }),
    // Exactly one active House Owner per household (docs/PLAN.md §4).
    memberships.createIndex(
      { householdId: 1 },
      {
        unique: true,
        name: 'one_active_owner',
        partialFilterExpression: { role: 'owner', status: 'active' },
      },
    ),
  ]);
}

/**
 * Creates a household and makes `userId` its House Owner. Without a multi-document
 * transaction, a failed membership insert removes the just-created household so
 * no orphan is left behind.
 */
export async function createHouseholdWithOwner(
  db: Db,
  userId: ObjectId,
  input: CreateHouseholdInput,
  now: Date = new Date(),
): Promise<{ household: HouseholdDoc; membership: MembershipDoc }> {
  const household: HouseholdDoc = {
    _id: new ObjectId(),
    name: input.name,
    currency: 'PHP',
    timezone: 'Asia/Manila',
    defaultMonthlyBudgetMinor: input.defaultMonthlyBudgetMinor,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const membership: MembershipDoc = {
    _id: new ObjectId(),
    householdId: household._id,
    userId,
    role: 'owner',
    status: 'active',
    joinedAt: now,
    updatedAt: now,
    alertsMuted: false,
    dailyDigestEnabled: true,
  };
  await db.collection<HouseholdDoc>(HOUSEHOLDS).insertOne(household);
  try {
    await db.collection<MembershipDoc>(MEMBERSHIPS).insertOne(membership);
  } catch (err) {
    await db.collection<HouseholdDoc>(HOUSEHOLDS).deleteOne({ _id: household._id });
    throw err;
  }
  return { household, membership };
}

/** How many households the user is in now: active memberships of households that still exist. */
export async function countActiveMemberships(db: Db, userId: ObjectId): Promise<number> {
  const [row] = await db
    .collection<MembershipDoc>(MEMBERSHIPS)
    .aggregate<{ n: number }>([
      { $match: { userId, status: 'active' } },
      { $lookup: { from: HOUSEHOLDS, localField: 'householdId', foreignField: '_id', as: 'household' } },
      { $unwind: '$household' },
      { $match: { 'household.deletedAt': null } }, // deleted households don't count toward the limit
      { $count: 'n' },
    ])
    .toArray();
  return row?.n ?? 0;
}

/** The user's active memberships in households that still exist, oldest first. */
export async function listMembershipsForUser(
  db: Db,
  userId: ObjectId,
): Promise<{ householdId: string; householdName: string; role: Role }[]> {
  const rows = await db
    .collection<MembershipDoc>(MEMBERSHIPS)
    .aggregate<{ householdId: ObjectId; role: Role; household: HouseholdDoc }>([
      { $match: { userId, status: 'active' } },
      { $sort: { joinedAt: 1, _id: 1 } },
      { $lookup: { from: HOUSEHOLDS, localField: 'householdId', foreignField: '_id', as: 'household' } },
      { $unwind: '$household' },
      { $match: { 'household.deletedAt': null } },
      { $project: { householdId: 1, role: 1, household: 1 } },
    ])
    .toArray();
  return rows.map((r) => ({ householdId: r.householdId.toHexString(), householdName: r.household.name, role: r.role }));
}

/**
 * The caller's active membership in a household that still exists, or null.
 * Null for "no such household", "deleted", and "not a member" alike, so the
 * API can answer 404 without revealing which.
 */
export async function findActiveMembership(
  db: Db,
  userId: ObjectId,
  householdId: ObjectId,
): Promise<{ membership: MembershipDoc; household: HouseholdDoc } | null> {
  const membership = await db
    .collection<MembershipDoc>(MEMBERSHIPS)
    .findOne({ householdId, userId, status: 'active' });
  if (!membership) return null;
  const household = await db.collection<HouseholdDoc>(HOUSEHOLDS).findOne({ _id: householdId, deletedAt: null });
  return household ? { membership, household } : null;
}

export async function updateHousehold(
  db: Db,
  householdId: ObjectId,
  input: UpdateHouseholdInput,
  now: Date = new Date(),
): Promise<HouseholdDoc | null> {
  const set: Partial<HouseholdDoc> = { updatedAt: now };
  if (input.name !== undefined) set.name = input.name;
  if (input.defaultMonthlyBudgetMinor !== undefined) set.defaultMonthlyBudgetMinor = input.defaultMonthlyBudgetMinor;
  return db
    .collection<HouseholdDoc>(HOUSEHOLDS)
    .findOneAndUpdate({ _id: householdId, deletedAt: null }, { $set: set }, { returnDocument: 'after' });
}

export async function softDeleteHousehold(db: Db, householdId: ObjectId, now: Date = new Date()): Promise<boolean> {
  const res = await db
    .collection<HouseholdDoc>(HOUSEHOLDS)
    .updateOne({ _id: householdId, deletedAt: null }, { $set: { deletedAt: now, updatedAt: now } });
  return res.modifiedCount === 1;
}
