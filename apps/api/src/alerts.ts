import { type Alert, type AlertKind, type AlertLevel, formatAlert, levelReached, type Role } from '@bdgtr/shared';
import { type Db, MongoServerError, ObjectId } from 'mongodb';

import { effectiveBudgets } from './budgets.js';
import { CATEGORIES, type CategoryDoc } from './categories.js';
import type { HouseholdDoc, MembershipDoc } from './households.js';
import { MEMBERSHIPS } from './households.js';
import { TRANSACTIONS, type TransactionDoc } from './transactions.js';
import { USERS, type UserDoc } from './users.js';

/**
 * docs/PLAN.md §4: the first alert per household, month, scope and level is
 * unique; "repeat" ones (further spends in a category already at 90%+) aren't.
 */
export interface AlertDoc {
  _id: ObjectId;
  householdId: ObjectId;
  yearMonth: string;
  /** Missing on alerts from before notices existed: those are budget alerts. */
  kind?: AlertKind;
  /** Who it's for. Missing = everyone. 'managers' = House Owner and Co-Owners only. */
  audience?: 'all' | 'managers';
  /** 'total', or the category id (hex). */
  scope: string;
  level: AlertLevel;
  categoryId: ObjectId | null;
  title: string;
  body: string;
  budgetMinor: number;
  spentMinor: number;
  triggeredBy: ObjectId;
  /** Fixed-transaction notices: the item and the day it was due. */
  fixedTransactionId?: ObjectId;
  dueDate?: string;
  /** The spend behind it; null for a "due today" notice. */
  transactionId: ObjectId | null;
  /** True for a further alert in a category already at that level this month. */
  repeat: boolean;
  createdAt: Date;
}

export const ALERTS = 'alerts';
// Collection names from fixed.ts, repeated to avoid a circular import (fixed.ts imports this file).
const FIXED_COLLECTION = 'fixedTransactions';
const FIXED_POSTINGS_COLLECTION = 'fixedPostings';

export async function ensureAlertIndexes(db: Db): Promise<void> {
  const alerts = db.collection<AlertDoc>(ALERTS);
  // Upgrade from the first version (every alert unique per month): mark existing
  // alerts as firsts, then swap the index for one that ignores repeats. Safe to rerun.
  await alerts.updateMany({ repeat: { $exists: false } }, { $set: { repeat: false } });
  await alerts.dropIndex('one_per_crossing').catch((err: unknown) => {
    if (!(err instanceof MongoServerError && (err.code === 27 || err.codeName === 'IndexNotFound' || err.codeName === 'NamespaceNotFound'))) throw err;
  });
  await alerts.createIndexes([
    {
      key: { householdId: 1, yearMonth: 1, scope: 1, level: 1 },
      unique: true,
      name: 'first_per_crossing',
      partialFilterExpression: { repeat: false },
    },
    { key: { householdId: 1, createdAt: -1 }, name: 'household_recent' },
  ]);
}

export async function spentInMonth(db: Db, householdId: ObjectId, yearMonth: string, categoryId?: ObjectId): Promise<number> {
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
  const [categorySpent, totalSpent, budgets] = await Promise.all([
    spentInMonth(db, household._id, tx.yearMonth, tx.categoryId),
    spentInMonth(db, household._id, tx.yearMonth),
    effectiveBudgets(db, household, tx.yearMonth), // the spend's month: its overrides, else the defaults
  ]);

  const candidates: { scope: string; categoryId: ObjectId | null; categoryName: string | null; budget: number; after: number }[] = [];
  if (category) {
    candidates.push({
      scope: category._id.toHexString(),
      categoryId: category._id,
      categoryName: category.name,
      budget: budgets.categoryMinor(category),
      after: categorySpent,
    });
  }
  candidates.push({ scope: 'total', categoryId: null, categoryName: null, budget: budgets.totalMinor, after: totalSpent });

  const created: AlertDoc[] = [];
  const insert = async (doc: AlertDoc): Promise<boolean> => {
    try {
      await db.collection<AlertDoc>(ALERTS).insertOne(doc);
      created.push(doc);
      return true;
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) return false; // already recorded this month
      throw err;
    }
  };
  for (const c of candidates) {
    const level = levelReached(c.after, c.budget);
    if (!level) continue;
    const make = (repeat: boolean): AlertDoc => ({
      _id: new ObjectId(),
      householdId: household._id,
      yearMonth: tx.yearMonth,
      scope: c.scope,
      kind: 'budget',
      audience: 'all',
      level,
      categoryId: c.categoryId,
      ...formatAlert({ householdName: household.name, categoryName: c.categoryName, level, budgetMinor: c.budget, spentMinor: c.after, repeat }),
      budgetMinor: c.budget,
      spentMinor: c.after,
      triggeredBy: tx.createdBy,
      transactionId: tx._id,
      repeat,
      createdAt: now,
    });
    // A category at 90%+: every further spend in it sends its current alert again
    // (updated numbers; a repeated "over" says "Still over budget"). The household
    // total stays once a month per level.
    if (!(await insert(make(false))) && c.categoryId) await insert(make(true));
  }
  return created;
}

/** Alerts created after this moment are unread for the member (never ones from before they joined). */
export function readCutoff(membership: MembershipDoc): Date {
  const lastRead = membership.alertsLastReadAt ?? null;
  return lastRead && lastRead > membership.joinedAt ? lastRead : membership.joinedAt;
}

export function toAlert(doc: AlertDoc, cutoff: Date, triggeredBy: string | null, canAdd = false): Alert {
  return {
    id: doc._id.toHexString(),
    yearMonth: doc.yearMonth,
    kind: doc.kind ?? 'budget',
    level: doc.level,
    categoryId: doc.categoryId?.toHexString() ?? null,
    title: doc.title,
    body: doc.body,
    fixedTransactionId: doc.fixedTransactionId?.toHexString() ?? null,
    dueDate: doc.dueDate ?? null,
    canAdd,
    triggeredBy,
    createdAt: doc.createdAt.toISOString(),
    unread: doc.createdAt > cutoff,
  };
}

/** House Members don't see managers-only alerts (e.g. "due today" reminders). */
function visibleTo(role: Role): Record<string, unknown> {
  return role === 'member' ? { audience: { $ne: 'managers' } } : {};
}

/**
 * "Due today" reminders that can still be added with one tap: it's still the
 * due day (`today`, Manila), the item hasn't been added that month and still
 * exists. Ids of the alerts, for the House Owner and Co-Owners only.
 */
async function addableReminders(db: Db, docs: AlertDoc[], today: string, role: Role): Promise<Set<string>> {
  if (role === 'member') return new Set();
  const due = docs.filter((d) => d.kind === 'fixed_due' && d.dueDate === today && d.fixedTransactionId);
  if (due.length === 0) return new Set();
  const ids = due.map((d) => d.fixedTransactionId!);
  const [items, postings] = await Promise.all([
    db.collection(FIXED_COLLECTION).find({ _id: { $in: ids }, isRemoved: false }, { projection: { _id: 1 } }).toArray(),
    db.collection(FIXED_POSTINGS_COLLECTION).find({ fixedTransactionId: { $in: ids }, yearMonth: today.slice(0, 7) }).toArray(),
  ]);
  const live = new Set(items.map((i) => (i._id as ObjectId).toHexString()));
  const added = new Set(postings.map((p) => (p.fixedTransactionId as ObjectId).toHexString()));
  return new Set(
    due.filter((d) => live.has(d.fixedTransactionId!.toHexString()) && !added.has(d.fixedTransactionId!.toHexString())).map((d) => d._id.toHexString()),
  );
}

/** A month's alerts the member may see, newest first, with who triggered each budget alert. */
export async function listAlerts(db: Db, householdId: ObjectId, yearMonth: string, cutoff: Date, role: Role, today: string): Promise<Alert[]> {
  const docs = await db
    .collection<AlertDoc>(ALERTS)
    .find({ householdId, yearMonth, ...visibleTo(role) })
    .sort({ createdAt: -1, _id: -1 })
    .toArray();
  const ids = [...new Set(docs.map((d) => d.triggeredBy.toHexString()))].map((h) => new ObjectId(h));
  const users = await db.collection<UserDoc>(USERS).find({ _id: { $in: ids } }).toArray();
  const names = new Map(users.map((u) => [u._id.toHexString(), u.displayName ?? u.email ?? null]));
  const addable = await addableReminders(db, docs, today, role);
  return docs.map((d) =>
    toAlert(d, cutoff, (d.kind ?? 'budget') === 'budget' ? (names.get(d.triggeredBy.toHexString()) ?? null) : null, addable.has(d._id.toHexString())),
  );
}

export async function countUnread(db: Db, householdId: ObjectId, cutoff: Date, role: Role): Promise<number> {
  return db.collection<AlertDoc>(ALERTS).countDocuments({ householdId, createdAt: { $gt: cutoff }, ...visibleTo(role) });
}

export async function markAlertsRead(db: Db, membershipId: ObjectId, now: Date): Promise<void> {
  await db.collection<MembershipDoc>(MEMBERSHIPS).updateOne({ _id: membershipId }, { $set: { alertsLastReadAt: now } });
}
