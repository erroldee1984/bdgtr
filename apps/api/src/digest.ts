import { addDays, formatDailySummary, yearMonthOf } from '@bdgtr/shared';
import { type Db, MongoServerError, ObjectId } from 'mongodb';

import { ALERTS, type AlertDoc, spentInMonth } from './alerts.js';
import { effectiveBudgets } from './budgets.js';
import { HOUSEHOLDS, type HouseholdDoc, MEMBERSHIPS, type MembershipDoc } from './households.js';
import { fanOutAlerts, type PushSender } from './push.js';
import { TRANSACTIONS, type TransactionDoc } from './transactions.js';

export interface DigestResult {
  /** The day reported on (yesterday in Manila). */
  forDate: string;
  households: number;
  alreadySent: number;
}

async function spentOn(db: Db, householdId: ObjectId, date: string): Promise<number> {
  const [row] = await db
    .collection<TransactionDoc>(TRANSACTIONS)
    .aggregate<{ total: number }>([{ $match: { householdId, date } }, { $group: { _id: null, total: { $sum: '$amountMinor' } } }])
    .toArray();
  return row?.total ?? 0;
}

/**
 * The 7:00 AM daily summary (docs/PLAN.md §6.11) for `today` (Manila): for
 * every household with active members, yesterday's spending by everyone and
 * the month's position (on the 1st, last month's close and the new budget).
 * Stored once in the Alerts tab and pushed to each member who has the daily
 * summary on for that household. Safe to run again: one per household per
 * day (the alerts unique index), so a retry sends nothing twice.
 */
export async function sendDailySummaries(db: Db, today: string, now: Date, sendPush: PushSender | null): Promise<DigestResult> {
  const yesterday = addDays(today, -1);
  const reportMonth = yearMonthOf(yesterday);
  const thisMonth = yearMonthOf(today);
  const activeIds = await db.collection<MembershipDoc>(MEMBERSHIPS).distinct('householdId', { status: 'active' });
  const households = await db.collection<HouseholdDoc>(HOUSEHOLDS).find({ _id: { $in: activeIds }, deletedAt: null }).toArray();
  const result: DigestResult = { forDate: yesterday, households: 0, alreadySent: 0 };

  for (const household of households) {
    const [yesterdaySpent, monthSpent, budgets] = await Promise.all([
      spentOn(db, household._id, yesterday),
      spentInMonth(db, household._id, reportMonth), // as of now: includes today's 00:15 auto-posts
      effectiveBudgets(db, household, reportMonth),
    ]);
    const newMonth = reportMonth !== thisMonth ? { yearMonth: thisMonth, budgetMinor: (await effectiveBudgets(db, household, thisMonth)).totalMinor } : null;
    const summary = formatDailySummary({
      householdName: household.name,
      yesterday,
      yesterdaySpentMinor: yesterdaySpent,
      monthBudgetMinor: budgets.totalMinor,
      monthSpentMinor: monthSpent,
      newMonth,
    });
    const doc: AlertDoc = {
      _id: new ObjectId(),
      householdId: household._id,
      yearMonth: thisMonth, // it arrives today, so it's listed with today's month
      kind: 'daily_summary',
      audience: 'all',
      scope: `daily_summary:${yesterday}`,
      level: summary.over ? 'over' : 'near',
      categoryId: null,
      title: summary.title,
      body: summary.body,
      budgetMinor: budgets.totalMinor,
      spentMinor: monthSpent,
      triggeredBy: household.createdBy,
      transactionId: null,
      repeat: false,
      createdAt: now,
    };
    try {
      await db.collection<AlertDoc>(ALERTS).insertOne(doc);
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        result.alreadySent++;
        continue;
      }
      throw err;
    }
    await fanOutAlerts(db, household, [doc], sendPush);
    result.households++;
  }
  return result;
}
