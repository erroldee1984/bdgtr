import { type Alert, type AlertLevel, formatAlert, levelReached } from '@bdgtr/shared';
import { type Db, MongoServerError, ObjectId } from 'mongodb';

import { CATEGORIES, type CategoryDoc } from './categories.js';
import type { HouseholdDoc, MembershipDoc } from './households.js';
import { MEMBERSHIPS } from './households.js';
import { TRANSACTIONS, type TransactionDoc } from './transactions.js';
import { USERS, type UserDoc } from './users.js';

/** docs/PLAN.md §4: one alert per household, month, scope and level. */
export interface AlertDoc {
  _id: ObjectId;
  householdId: ObjectId;
  yearMonth: string;
  /** 'total', or the category id (hex). */
  scope: string;
  level: AlertLevel;
  categoryId: ObjectId | null;
  title: string;
  body: string;
  budgetMinor: number;
  spentMinor: number;
  triggeredBy: ObjectId;
  transactionId: ObjectId;
  createdAt: Date;
}

export const ALERTS = 'alerts';

export async function ensureAlertIndexes(db: Db): Promise<void> {
  await db.collection<AlertDoc>(ALERTS).createIndexes([
    { key: { householdId: 1, yearMonth: 1, scope: 1, level: 1 }, unique: true, name: 'one_per_crossing' },
    { key: { householdId: 1, createdAt: -1 }, name: 'household_recent' },
  ]);
}

async function spentInMonth(db: Db, householdId: ObjectId, yearMonth: string, categoryId?: ObjectId): Promise<number> {
  const match: Record<string, unknown> = { householdId, yearMonth };
  if (categoryId) match.categoryId = categoryId;
  const [row] = await db
    .collection<TransactionDoc>(TRANSACTIONS)
    .aggregate<{ total: number }>([{ $match: match }, { $group: { _id: null, total: { $sum: '$amountMinor' } } }])
    .toArray();
  return row?.total ?? 0;
}

/**
 * After a new spend is saved: checks its category and the household total
 * against their budgets and records the level reached, if this household
 * hasn't had that alert this month (see levelReached in shared). Returns only
 * the alerts this spend created; one already recorded (e.g. by a simultaneous
 * spend) isn't repeated.
 */
export async function recordCrossings(db: Db, household: HouseholdDoc, tx: TransactionDoc, now: Date): Promise<AlertDoc[]> {
  const category = await db.collection<CategoryDoc>(CATEGORIES).findOne({ _id: tx.categoryId, householdId: household._id });
  const [categorySpent, totalSpent] = await Promise.all([
    spentInMonth(db, household._id, tx.yearMonth, tx.categoryId),
    spentInMonth(db, household._id, tx.yearMonth),
  ]);

  const candidates: { scope: string; categoryId: ObjectId | null; categoryName: string | null; budget: number; after: number }[] = [];
  if (category) {
    candidates.push({
      scope: category._id.toHexString(),
      categoryId: category._id,
      categoryName: category.name,
      budget: category.defaultBudgetMinor,
      after: categorySpent,
    });
  }
  candidates.push({ scope: 'total', categoryId: null, categoryName: null, budget: household.defaultMonthlyBudgetMinor, after: totalSpent });

  const created: AlertDoc[] = [];
  for (const c of candidates) {
    const level = levelReached(c.after, c.budget);
    if (!level) continue;
    // "Nearly there" after "over" this month would be confusing (e.g. after a delete brings it back down).
    if (
      level === 'near' &&
      (await db.collection<AlertDoc>(ALERTS).countDocuments({ householdId: household._id, yearMonth: tx.yearMonth, scope: c.scope, level: 'over' })) > 0
    ) {
      continue;
    }
    const text = formatAlert({ householdName: household.name, categoryName: c.categoryName, level, budgetMinor: c.budget, spentMinor: c.after });
    const doc: AlertDoc = {
      _id: new ObjectId(),
      householdId: household._id,
      yearMonth: tx.yearMonth,
      scope: c.scope,
      level,
      categoryId: c.categoryId,
      ...text,
      budgetMinor: c.budget,
      spentMinor: c.after,
      triggeredBy: tx.createdBy,
      transactionId: tx._id,
      createdAt: now,
    };
    try {
      await db.collection<AlertDoc>(ALERTS).insertOne(doc);
      created.push(doc);
    } catch (err) {
      if (!(err instanceof MongoServerError && err.code === 11000)) throw err; // already recorded this month
    }
  }
  return created;
}

/** Alerts created after this moment are unread for the member (never ones from before they joined). */
export function readCutoff(membership: MembershipDoc): Date {
  const lastRead = membership.alertsLastReadAt ?? null;
  return lastRead && lastRead > membership.joinedAt ? lastRead : membership.joinedAt;
}

export function toAlert(doc: AlertDoc, cutoff: Date, triggeredBy: string | null): Alert {
  return {
    id: doc._id.toHexString(),
    yearMonth: doc.yearMonth,
    level: doc.level,
    categoryId: doc.categoryId?.toHexString() ?? null,
    title: doc.title,
    body: doc.body,
    triggeredBy,
    createdAt: doc.createdAt.toISOString(),
    unread: doc.createdAt > cutoff,
  };
}

/** A month's alerts, newest first, with who triggered each one. */
export async function listAlerts(db: Db, householdId: ObjectId, yearMonth: string, cutoff: Date): Promise<Alert[]> {
  const docs = await db.collection<AlertDoc>(ALERTS).find({ householdId, yearMonth }).sort({ createdAt: -1, _id: -1 }).toArray();
  const ids = [...new Set(docs.map((d) => d.triggeredBy.toHexString()))].map((h) => new ObjectId(h));
  const users = await db.collection<UserDoc>(USERS).find({ _id: { $in: ids } }).toArray();
  const names = new Map(users.map((u) => [u._id.toHexString(), u.displayName ?? u.email ?? null]));
  return docs.map((d) => toAlert(d, cutoff, names.get(d.triggeredBy.toHexString()) ?? null));
}

export async function countUnread(db: Db, householdId: ObjectId, cutoff: Date): Promise<number> {
  return db.collection<AlertDoc>(ALERTS).countDocuments({ householdId, createdAt: { $gt: cutoff } });
}

export async function markAlertsRead(db: Db, membershipId: ObjectId, now: Date): Promise<void> {
  await db.collection<MembershipDoc>(MEMBERSHIPS).updateOne({ _id: membershipId }, { $set: { alertsLastReadAt: now } });
}
