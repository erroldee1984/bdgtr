import {
  type Category,
  type CategoryColour,
  type CategoryIcon,
  categoryNameKey,
  type CreateCategoryInput,
  manilaDate,
  addDays,
  DEFAULT_CATEGORY,
  type UpdateCategoryInput,
} from '@bdgtr/shared';
import { type Db, MongoServerError, ObjectId } from 'mongodb';

import { TRANSACTIONS, type TransactionDoc } from './transactions.js';

/** docs/PLAN.md §4: categories are soft-removed, never deleted, so past spending still resolves. */
export interface CategoryDoc {
  _id: ObjectId;
  householdId: ObjectId;
  name: string;
  /** Lower-cased, space-collapsed name: unique among a household's active categories. */
  nameKey: string;
  icon: CategoryIcon;
  colour: CategoryColour;
  defaultBudgetMinor: number;
  isRemoved: boolean;
  removedAt: Date | null;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const CATEGORIES = 'categories';

export async function ensureCategoryIndexes(db: Db): Promise<void> {
  await db.collection<CategoryDoc>(CATEGORIES).createIndexes([
    {
      key: { householdId: 1, nameKey: 1 },
      unique: true,
      name: 'active_name_unique',
      partialFilterExpression: { isRemoved: false },
    },
    { key: { householdId: 1 }, name: 'household' },
  ]);
}

export const isDuplicateKey = (err: unknown) => err instanceof MongoServerError && err.code === 11000;

export function toCategory(doc: CategoryDoc, recentUseCount = 0): Category {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    icon: doc.icon,
    colour: doc.colour,
    defaultBudgetMinor: doc.defaultBudgetMinor,
    isRemoved: doc.isRemoved,
    recentUseCount,
  };
}

/** All of a household's categories (removed ones too), with 90-day use counts. */
export async function listCategories(db: Db, householdId: ObjectId, now: Date): Promise<Category[]> {
  const [docs, counts] = await Promise.all([
    db.collection<CategoryDoc>(CATEGORIES).find({ householdId }).sort({ name: 1 }).toArray(),
    db
      .collection<TransactionDoc>(TRANSACTIONS)
      .aggregate<{ _id: ObjectId; n: number }>([
        { $match: { householdId, date: { $gte: addDays(manilaDate(now), -90) } } },
        { $group: { _id: '$categoryId', n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const byId = new Map(counts.map((c) => [c._id.toHexString(), c.n]));
  return docs.map((d) => toCategory(d, byId.get(d._id.toHexString()) ?? 0));
}

export async function countCategories(db: Db, householdId: ObjectId): Promise<number> {
  return db.collection<CategoryDoc>(CATEGORIES).countDocuments({ householdId });
}

export async function findCategory(db: Db, householdId: ObjectId, id: ObjectId): Promise<CategoryDoc | null> {
  return db.collection<CategoryDoc>(CATEGORIES).findOne({ _id: id, householdId });
}

function newDoc(householdId: ObjectId, input: CreateCategoryInput, by: ObjectId, now: Date): CategoryDoc {
  return {
    _id: new ObjectId(),
    householdId,
    name: input.name,
    nameKey: categoryNameKey(input.name),
    icon: input.icon,
    colour: input.colour,
    defaultBudgetMinor: input.defaultBudgetMinor,
    isRemoved: false,
    removedAt: null,
    createdBy: by,
    createdAt: now,
    updatedAt: now,
  };
}

/** Null if an active category already has that name. */
export async function createCategory(
  db: Db,
  householdId: ObjectId,
  input: CreateCategoryInput,
  by: ObjectId,
  now: Date,
): Promise<CategoryDoc | null> {
  const doc = newDoc(householdId, input, by, now);
  try {
    await db.collection<CategoryDoc>(CATEGORIES).insertOne(doc);
    return doc;
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    throw err;
  }
}

export async function countActiveCategories(db: Db, householdId: ObjectId): Promise<number> {
  return db.collection<CategoryDoc>(CATEGORIES).countDocuments({ householdId, isRemoved: false });
}

/**
 * A household always has at least one active category: if it has none (a new
 * household, or one from before categories existed), add the default
 * (Groceries). Safe to call concurrently: the unique active-name index lets
 * only one copy in.
 */
export async function ensureDefaultCategory(db: Db, householdId: ObjectId, by: ObjectId, now: Date): Promise<void> {
  if ((await countActiveCategories(db, householdId)) > 0) return;
  try {
    await db.collection<CategoryDoc>(CATEGORIES).insertOne(newDoc(householdId, { ...DEFAULT_CATEGORY, defaultBudgetMinor: 0 }, by, now));
  } catch (err) {
    if (!isDuplicateKey(err)) throw err; // someone else just added it
  }
}

export type UpdateResult = { doc: CategoryDoc | null; error: 'not_found' | 'category_exists' | null };

export async function updateCategory(
  db: Db,
  householdId: ObjectId,
  id: ObjectId,
  input: UpdateCategoryInput,
  now: Date,
): Promise<UpdateResult> {
  const set: Partial<CategoryDoc> = { updatedAt: now };
  if (input.name !== undefined) {
    set.name = input.name;
    set.nameKey = categoryNameKey(input.name);
  }
  if (input.icon !== undefined) set.icon = input.icon;
  if (input.colour !== undefined) set.colour = input.colour;
  if (input.defaultBudgetMinor !== undefined) set.defaultBudgetMinor = input.defaultBudgetMinor;
  try {
    const doc = await db
      .collection<CategoryDoc>(CATEGORIES)
      .findOneAndUpdate({ _id: id, householdId }, { $set: set }, { returnDocument: 'after' });
    return { doc, error: doc ? null : 'not_found' };
  } catch (err) {
    if (isDuplicateKey(err)) return { doc: null, error: 'category_exists' };
    throw err;
  }
}

/**
 * Soft remove, never the household's last active category. If two removals
 * race and would leave none, the later one is undone and refused.
 */
export async function removeCategory(
  db: Db,
  householdId: ObjectId,
  id: ObjectId,
  now: Date,
): Promise<'ok' | 'not_found' | 'last_category'> {
  const coll = db.collection<CategoryDoc>(CATEGORIES);
  const target = await coll.findOne({ _id: id, householdId, isRemoved: false });
  if (!target) return 'not_found';
  if ((await countActiveCategories(db, householdId)) <= 1) return 'last_category';
  const res = await coll.updateOne(
    { _id: id, householdId, isRemoved: false },
    { $set: { isRemoved: true, removedAt: now, updatedAt: now } },
  );
  if (res.matchedCount !== 1) return 'not_found';
  if ((await countActiveCategories(db, householdId)) === 0) {
    await coll.updateOne({ _id: id, householdId }, { $set: { isRemoved: false, removedAt: null, updatedAt: now } });
    return 'last_category';
  }
  return 'ok';
}

/** Restore a removed category. 'category_exists' if an active one has taken its name meanwhile. */
export async function restoreCategory(
  db: Db,
  householdId: ObjectId,
  id: ObjectId,
  now: Date,
): Promise<'ok' | 'not_found' | 'category_exists'> {
  try {
    const res = await db
      .collection<CategoryDoc>(CATEGORIES)
      .updateOne({ _id: id, householdId, isRemoved: true }, { $set: { isRemoved: false, removedAt: null, updatedAt: now } });
    return res.matchedCount === 1 ? 'ok' : 'not_found';
  } catch (err) {
    if (isDuplicateKey(err)) return 'category_exists';
    throw err;
  }
}
