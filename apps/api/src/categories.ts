import {
  type Category,
  type CategoryColour,
  type CategoryIcon,
  categoryNameKey,
  type CreateCategoryInput,
  manilaDate,
  addDays,
  STARTER_CATEGORIES,
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

/** Adds the starter set (used for new households, or an existing one with none). */
export async function addStarterCategories(db: Db, householdId: ObjectId, by: ObjectId, now: Date): Promise<CategoryDoc[]> {
  const docs = STARTER_CATEGORIES.map((c) => newDoc(householdId, { ...c, defaultBudgetMinor: 0 }, by, now));
  await db.collection<CategoryDoc>(CATEGORIES).insertMany(docs);
  return docs;
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

/** Soft remove. False if there's no such active category. */
export async function removeCategory(db: Db, householdId: ObjectId, id: ObjectId, now: Date): Promise<boolean> {
  const res = await db
    .collection<CategoryDoc>(CATEGORIES)
    .updateOne({ _id: id, householdId, isRemoved: false }, { $set: { isRemoved: true, removedAt: now, updatedAt: now } });
  return res.matchedCount === 1;
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
