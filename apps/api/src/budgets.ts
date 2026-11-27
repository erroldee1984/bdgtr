import { buildMonthBudgets, effectiveBudget, type MonthBudgets, unbudgetedMinor } from '@bdgtr/shared';
import { type Db, MongoServerError, type ObjectId } from 'mongodb';

import { CATEGORIES, type CategoryDoc } from './categories.js';
import type { HouseholdDoc } from './households.js';

/**
 * Monthly budget overrides (docs/PLAN.md §4). A row exists only while a month's
 * value differs from the default; deleting it is "Reset to default".
 */
export interface MonthlyBudgetDoc {
  _id: ObjectId;
  householdId: ObjectId;
  yearMonth: string;
  totalBudgetMinor: number;
  updatedBy: ObjectId;
  updatedAt: Date;
}

export interface CategoryBudgetDoc {
  _id: ObjectId;
  householdId: ObjectId;
  yearMonth: string;
  categoryId: ObjectId;
  budgetMinor: number;
  updatedBy: ObjectId;
  updatedAt: Date;
}

export const MONTHLY_BUDGETS = 'monthlyBudgets';
export const CATEGORY_BUDGETS = 'categoryBudgets';

export async function ensureBudgetIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection<MonthlyBudgetDoc>(MONTHLY_BUDGETS).createIndex({ householdId: 1, yearMonth: 1 }, { unique: true, name: 'household_month' }),
    db
      .collection<CategoryBudgetDoc>(CATEGORY_BUDGETS)
      .createIndex({ householdId: 1, yearMonth: 1, categoryId: 1 }, { unique: true, name: 'household_month_category' }),
  ]);
}

/** A month's overrides: the total (or null) and per category id (hex). */
export async function monthOverrides(db: Db, householdId: ObjectId, yearMonth: string): Promise<{ total: number | null; categories: Map<string, number> }> {
  const [total, categories] = await Promise.all([
    db.collection<MonthlyBudgetDoc>(MONTHLY_BUDGETS).findOne({ householdId, yearMonth }),
    db.collection<CategoryBudgetDoc>(CATEGORY_BUDGETS).find({ householdId, yearMonth }).toArray(),
  ]);
  return {
    total: total ? total.totalBudgetMinor : null,
    categories: new Map(categories.map((c) => [c.categoryId.toHexString(), c.budgetMinor])),
  };
}

/** What applies in a month: the household total and each category's budget. */
export async function effectiveBudgets(
  db: Db,
  household: HouseholdDoc,
  yearMonth: string,
): Promise<{ totalMinor: number; categoryMinor: (category: CategoryDoc) => number }> {
  const [overrides, active] = await Promise.all([
    monthOverrides(db, household._id, yearMonth),
    db.collection<CategoryDoc>(CATEGORIES).find({ householdId: household._id, isRemoved: false }, { projection: { defaultBudgetMinor: 1, kind: 1 } }).toArray(),
  ]);
  const totalMinor = effectiveBudget(household.defaultMonthlyBudgetMinor, overrides.total);
  const own = (c: Pick<CategoryDoc, '_id' | 'defaultBudgetMinor'>) => effectiveBudget(c.defaultBudgetMinor, overrides.categories.get(c._id.toHexString()));
  // The built-in Unbudgeted category gets what the others don't: one rule for the
  // dashboard, alerts and Budget per Category (shared unbudgetedMinor).
  const rest = unbudgetedMinor(totalMinor, active.filter((c) => c.kind !== 'unbudgeted').map(own));
  return { totalMinor, categoryMinor: (category) => (category.kind === 'unbudgeted' ? rest : own(category)) };
}

/** Upsert that survives two people saving the same month at once (unique index race). */
async function upsertOnce(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      await run(); // the other save created the row; this one now updates it
      return;
    }
    throw err;
  }
}

/** Sets a month's total. The default's own value is stored as "no override". */
export async function setMonthlyBudget(db: Db, household: HouseholdDoc, yearMonth: string, value: number, by: ObjectId, now: Date): Promise<void> {
  const col = db.collection<MonthlyBudgetDoc>(MONTHLY_BUDGETS);
  const key = { householdId: household._id, yearMonth };
  if (value === household.defaultMonthlyBudgetMinor) {
    await col.deleteOne(key);
    return;
  }
  await upsertOnce(() =>
    col.updateOne(key, { $set: { totalBudgetMinor: value, updatedBy: by, updatedAt: now } }, { upsert: true }),
  );
}

export async function resetMonthlyBudget(db: Db, householdId: ObjectId, yearMonth: string): Promise<void> {
  await db.collection<MonthlyBudgetDoc>(MONTHLY_BUDGETS).deleteOne({ householdId, yearMonth });
}

/** Sets a category's budget for a month. Its default's value is stored as "no override". */
export async function setCategoryBudget(db: Db, category: CategoryDoc, yearMonth: string, value: number, by: ObjectId, now: Date): Promise<void> {
  const col = db.collection<CategoryBudgetDoc>(CATEGORY_BUDGETS);
  const key = { householdId: category.householdId, yearMonth, categoryId: category._id };
  if (value === category.defaultBudgetMinor) {
    await col.deleteOne(key);
    return;
  }
  await upsertOnce(() => col.updateOne(key, { $set: { budgetMinor: value, updatedBy: by, updatedAt: now } }, { upsert: true }));
}

export async function resetCategoryBudget(db: Db, householdId: ObjectId, yearMonth: string, categoryId: ObjectId): Promise<void> {
  await db.collection<CategoryBudgetDoc>(CATEGORY_BUDGETS).deleteOne({ householdId, yearMonth, categoryId });
}

/** GET /budgets: the month's total and every active category, with defaults and overrides. */
export async function monthBudgets(db: Db, household: HouseholdDoc, yearMonth: string): Promise<MonthBudgets> {
  const [overrides, categories] = await Promise.all([
    monthOverrides(db, household._id, yearMonth),
    db.collection<CategoryDoc>(CATEGORIES).find({ householdId: household._id, isRemoved: false }).toArray(),
  ]);
  return buildMonthBudgets({
    month: yearMonth,
    defaultMonthlyBudgetMinor: household.defaultMonthlyBudgetMinor,
    monthlyOverrideMinor: overrides.total,
    categories: categories.map((c) => ({
      id: c._id.toHexString(),
      name: c.name,
      icon: c.icon,
      colour: c.colour,
      defaultBudgetMinor: c.defaultBudgetMinor,
      overrideMinor: overrides.categories.get(c._id.toHexString()) ?? null,
      kind: c.kind === 'unbudgeted' ? ('unbudgeted' as const) : ('normal' as const),
    })),
  });
}
