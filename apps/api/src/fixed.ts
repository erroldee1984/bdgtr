import { createHash } from 'node:crypto';

import {
  type CreateFixedInput,
  type FixedTransaction,
  fixedPostingDate,
  isDueOn,
  type UpdateFixedInput,
  yearMonthOf,
} from '@bdgtr/shared';
import { type Db, MongoServerError, ObjectId } from 'mongodb';

import { recordCrossings, type AlertDoc } from './alerts.js';
import { CATEGORIES, type CategoryDoc } from './categories.js';
import { HOUSEHOLDS, type HouseholdDoc } from './households.js';
import { fanOutAlerts, type PushSender } from './push.js';
import { createTransaction, type TransactionDoc } from './transactions.js';

/** docs/PLAN.md §4: soft-removed, never deleted, so past postings still resolve. */
export interface FixedDoc {
  _id: ObjectId;
  householdId: ObjectId;
  name: string;
  categoryId: ObjectId;
  amountMinor: number;
  description: string | null;
  dayOfMonth: number;
  autoPostEnabled: boolean;
  isRemoved: boolean;
  removedAt: Date | null;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** One per fixed item per month: the first time it was added that month (auto or bulk). */
export interface FixedPostingDoc {
  _id: ObjectId;
  householdId: ObjectId;
  fixedTransactionId: ObjectId;
  yearMonth: string;
  transactionId: ObjectId;
  date: string;
  createdAt: Date;
}

export const FIXED = 'fixedTransactions';
export const FIXED_POSTINGS = 'fixedPostings';

export async function ensureFixedIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection<FixedDoc>(FIXED).createIndexes([
      { key: { householdId: 1, isRemoved: 1 }, name: 'household_active' },
      { key: { autoPostEnabled: 1, isRemoved: 1, dayOfMonth: 1 }, name: 'autopost_due' },
    ]),
    db.collection<FixedPostingDoc>(FIXED_POSTINGS).createIndexes([
      { key: { fixedTransactionId: 1, yearMonth: 1 }, unique: true, name: 'fixed_month_unique' },
      { key: { householdId: 1, yearMonth: 1 }, name: 'household_month' },
    ]),
  ]);
}

export function toFixed(doc: FixedDoc, postedOn: string | null): FixedTransaction {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    categoryId: doc.categoryId.toHexString(),
    amountMinor: doc.amountMinor,
    description: doc.description,
    dayOfMonth: doc.dayOfMonth,
    autoPostEnabled: doc.autoPostEnabled,
    postedOn,
  };
}

/** Active items, by day then name, with when each was first added in `yearMonth`. */
export async function listFixed(db: Db, householdId: ObjectId, yearMonth: string): Promise<FixedTransaction[]> {
  const [docs, postings] = await Promise.all([
    db.collection<FixedDoc>(FIXED).find({ householdId, isRemoved: false }).sort({ dayOfMonth: 1, name: 1 }).toArray(),
    db.collection<FixedPostingDoc>(FIXED_POSTINGS).find({ householdId, yearMonth }).toArray(),
  ]);
  const posted = new Map(postings.map((p) => [p.fixedTransactionId.toHexString(), p.date]));
  return docs.map((d) => toFixed(d, posted.get(d._id.toHexString()) ?? null));
}

export async function countFixed(db: Db, householdId: ObjectId): Promise<number> {
  return db.collection<FixedDoc>(FIXED).countDocuments({ householdId, isRemoved: false });
}

export async function findFixed(db: Db, householdId: ObjectId, id: ObjectId): Promise<FixedDoc | null> {
  return db.collection<FixedDoc>(FIXED).findOne({ _id: id, householdId, isRemoved: false });
}

export async function createFixed(db: Db, householdId: ObjectId, input: CreateFixedInput, by: ObjectId, now: Date): Promise<FixedDoc> {
  const doc: FixedDoc = {
    _id: new ObjectId(),
    householdId,
    name: input.name,
    categoryId: new ObjectId(input.categoryId),
    amountMinor: input.amountMinor,
    description: input.description ?? null,
    dayOfMonth: input.dayOfMonth,
    autoPostEnabled: input.autoPostEnabled,
    isRemoved: false,
    removedAt: null,
    createdBy: by,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<FixedDoc>(FIXED).insertOne(doc);
  return doc;
}

export async function updateFixed(db: Db, householdId: ObjectId, id: ObjectId, input: UpdateFixedInput, now: Date): Promise<FixedDoc | null> {
  const set: Partial<FixedDoc> = { updatedAt: now };
  if (input.name !== undefined) set.name = input.name;
  if (input.categoryId !== undefined) set.categoryId = new ObjectId(input.categoryId);
  if (input.amountMinor !== undefined) set.amountMinor = input.amountMinor;
  if (input.dayOfMonth !== undefined) set.dayOfMonth = input.dayOfMonth;
  if (input.autoPostEnabled !== undefined) set.autoPostEnabled = input.autoPostEnabled;
  if (input.description !== undefined) set.description = input.description;
  return db
    .collection<FixedDoc>(FIXED)
    .findOneAndUpdate({ _id: id, householdId, isRemoved: false }, { $set: set }, { returnDocument: 'after' });
}

export async function removeFixed(db: Db, householdId: ObjectId, id: ObjectId, now: Date): Promise<boolean> {
  const res = await db
    .collection<FixedDoc>(FIXED)
    .updateOne({ _id: id, householdId, isRemoved: false }, { $set: { isRemoved: true, removedAt: now, updatedAt: now } });
  return res.modifiedCount === 1;
}

/**
 * The same UUID every time for one item in one month, so an auto-post that
 * runs twice (a cron retry) finds the spend it already made instead of adding
 * another: transactions are unique per (household, clientId).
 */
export function autoPostClientId(fixedId: ObjectId, yearMonth: string): string {
  const h = createHash('sha256').update(`fixed-auto:${fixedId.toHexString()}:${yearMonth}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Remembers the first time an item was added in a month (later adds leave it alone). */
async function notePosting(db: Db, item: FixedDoc, tx: TransactionDoc, now: Date): Promise<void> {
  try {
    await db.collection<FixedPostingDoc>(FIXED_POSTINGS).updateOne(
      { fixedTransactionId: item._id, yearMonth: tx.yearMonth },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          householdId: item.householdId,
          fixedTransactionId: item._id,
          yearMonth: tx.yearMonth,
          transactionId: tx._id,
          date: tx.date,
          createdAt: now,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    if (!(err instanceof MongoServerError && err.code === 11000)) throw err; // a parallel upsert won
  }
}

/** Adds one fixed item as a spend; budget alerts go out as for any spend. */
export async function postFixed(
  db: Db,
  household: HouseholdDoc,
  item: FixedDoc,
  opts: { date: string; clientId: string; source: 'fixed-auto' | 'fixed-bulk'; by: ObjectId; now: Date; sendPush: PushSender | null },
): Promise<{ tx: TransactionDoc; alerts: AlertDoc[]; created: boolean }> {
  const { doc, created } = await createTransaction(
    db,
    household._id,
    { clientId: opts.clientId, date: opts.date, categoryId: item.categoryId.toHexString(), amountMinor: item.amountMinor, description: item.description },
    opts.by,
    opts.now,
    { source: opts.source, fixedTransactionId: item._id },
  );
  await notePosting(db, item, doc, opts.now);
  if (!created) return { tx: doc, alerts: [], created };
  const alerts = await recordCrossings(db, household, doc, opts.now);
  await fanOutAlerts(db, household, alerts, opts.sendPush);
  return { tx: doc, alerts, created };
}

export interface AutoPostResult {
  date: string;
  posted: number;
  alreadyPosted: number;
  skippedRemovedCategory: number;
}

/**
 * The 00:15 Manila run (docs/PLAN.md §6.5): every enabled item, in every
 * household, whose day (clamped to the month) is `today`. Skips items already
 * added this month (auto or bulk) and items whose category was removed.
 * Safe to run again: nothing is added twice.
 */
export async function autoPostDue(db: Db, today: string, now: Date, sendPush: PushSender | null): Promise<AutoPostResult> {
  const yearMonth = yearMonthOf(today);
  const day = Number(today.slice(8, 10));
  const lastDay = fixedPostingDate(yearMonth, 31) === today;
  const candidates = await db
    .collection<FixedDoc>(FIXED)
    .find({ autoPostEnabled: true, isRemoved: false, dayOfMonth: lastDay ? { $gte: day } : day })
    .toArray();
  const due = candidates.filter((d) => isDueOn(d.dayOfMonth, today));
  const result: AutoPostResult = { date: today, posted: 0, alreadyPosted: 0, skippedRemovedCategory: 0 };
  if (due.length === 0) return result;

  const [households, postings, categories] = await Promise.all([
    db.collection<HouseholdDoc>(HOUSEHOLDS).find({ _id: { $in: [...new Set(due.map((d) => d.householdId))] }, deletedAt: null }).toArray(),
    db.collection<FixedPostingDoc>(FIXED_POSTINGS).find({ fixedTransactionId: { $in: due.map((d) => d._id) }, yearMonth }).toArray(),
    db.collection<CategoryDoc>(CATEGORIES).find({ _id: { $in: due.map((d) => d.categoryId) } }).toArray(),
  ]);
  const householdById = new Map(households.map((h) => [h._id.toHexString(), h]));
  const postedIds = new Set(postings.map((p) => p.fixedTransactionId.toHexString()));
  const liveCategory = new Set(categories.filter((c) => !c.isRemoved).map((c) => c._id.toHexString()));

  for (const item of due) {
    const household = householdById.get(item.householdId.toHexString());
    if (!household) continue; // household deleted
    if (postedIds.has(item._id.toHexString())) {
      result.alreadyPosted++;
      continue;
    }
    if (!liveCategory.has(item.categoryId.toHexString())) {
      result.skippedRemovedCategory++;
      continue;
    }
    const { created } = await postFixed(db, household, item, {
      date: today,
      clientId: autoPostClientId(item._id, yearMonth),
      source: 'fixed-auto',
      by: item.createdBy,
      now,
      sendPush,
    });
    if (created) result.posted++;
    else result.alreadyPosted++;
  }
  return result;
}
