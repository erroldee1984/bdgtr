import type { Db, ObjectId } from 'mongodb';

/** A person who has signed in at least once (docs/PLAN.md §4). */
export interface UserDoc {
  _id: ObjectId;
  clerkUserId: string;
  /** Lower-cased primary email from the session token, if available. */
  email: string | null;
  /** Display name from the session token, if the `name` claim is configured. */
  displayName?: string | null;
  lastHouseholdId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

export const USERS = 'users';

export async function ensureUserIndexes(db: Db): Promise<void> {
  await db.collection<UserDoc>(USERS).createIndex({ clerkUserId: 1 }, { unique: true, name: 'clerkUserId_unique' });
}

/**
 * Creates the user on first sign-in, otherwise refreshes email and lastSeenAt.
 * Atomic (single upsert), so two simultaneous first requests can't create
 * duplicates; the unique index is the backstop.
 */
export async function upsertUserFromAuth(
  db: Db,
  input: { clerkUserId: string; email: string | null; name?: string | null },
  now: Date = new Date(),
): Promise<UserDoc> {
  const set: Partial<UserDoc> = { lastSeenAt: now, updatedAt: now };
  // Never wipe a known email just because one token lacked the claim.
  if (input.email) set.email = input.email;
  if (input.name) set.displayName = input.name;

  const doc = await db.collection<UserDoc>(USERS).findOneAndUpdate(
    { clerkUserId: input.clerkUserId },
    {
      $set: set,
      $setOnInsert: {
        clerkUserId: input.clerkUserId,
        ...(input.email ? {} : { email: null }),
        lastHouseholdId: null,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!doc) throw new Error('upsert returned no document');
  return doc;
}
