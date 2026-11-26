import { householdLabel } from './alerts.ts';
import { formatPHP } from './money.ts';

/**
 * The 7:00 AM daily summary (docs/PLAN.md §6.11). One pure function builds
 * the text, so every example in the plan is unit-tested here.
 */

const DAY = new Intl.DateTimeFormat('en-PH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-PH', { month: 'long', timeZone: 'UTC' });

function utc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d ?? 1));
}

/** "2026-11-22" → "Sun, 22 Nov". */
export function summaryDay(date: string): string {
  const parts = Object.fromEntries(DAY.formatToParts(utc(date)).map((p) => [p.type, p.value]));
  return `${parts.weekday}, ${parts.day} ${parts.month}`;
}

/** "2026-11" → "November". */
export function monthName(yearMonth: string): string {
  return MONTH.format(utc(`${yearMonth}-01`));
}

export interface DailySummaryInput {
  householdName: string;
  /** Yesterday in Manila (YYYY-MM-DD). */
  yesterday: string;
  /** Everyone's spending dated yesterday. */
  yesterdaySpentMinor: number;
  /** The month the summary reports on: yesterday's month. */
  monthBudgetMinor: number;
  /** That month's spending so far (including today's 00:15 auto-posts when it's still the same month). */
  monthSpentMinor: number;
  /**
   * On the 1st (D3): the new month and its budget. Then the month above is
   * last month, and the summary reports how it closed.
   */
  newMonth?: { yearMonth: string; budgetMinor: number } | null;
}

export interface DailySummary {
  title: string;
  body: string;
  /** Over budget: sent as a high-priority ("over") notification. */
  over: boolean;
}

export function formatDailySummary(input: DailySummaryInput): DailySummary {
  const who = householdLabel(input.householdName);
  const month = monthName(input.yesterday.slice(0, 7));
  const first =
    input.yesterdaySpentMinor > 0
      ? `Yesterday (${summaryDay(input.yesterday)}) ${who} spent ${formatPHP(input.yesterdaySpentMinor)}.`
      : `Yesterday (${summaryDay(input.yesterday)}) ${who} had no spending recorded.`;
  const left = input.monthBudgetMinor - input.monthSpentMinor;
  const title = `Daily summary · ${who}`;

  if (input.newMonth) {
    const next = `${monthName(input.newMonth.yearMonth)} budget: ${formatPHP(input.newMonth.budgetMinor)}.`;
    let closed: string;
    if (input.monthBudgetMinor <= 0) closed = `${month} closed with ${formatPHP(input.monthSpentMinor)} spent and no budget set.`;
    else if (left > 0) closed = `${month} closed ${formatPHP(left)} under budget.`;
    else if (left < 0) closed = `${month} closed ${formatPHP(-left)} over budget.`;
    else closed = `${month} closed exactly on budget.`;
    return { title, body: `${first} ${closed} ${next}`, over: false };
  }

  if (input.monthBudgetMinor <= 0) return { title, body: `${first} No budget is set for ${month}.`, over: false };
  if (left < 0) return { title, body: `${first} Over budget by ${formatPHP(-left)} for ${month}.`, over: true };
  return { title, body: `${first} ${formatPHP(left)} left of ${formatPHP(input.monthBudgetMinor)} for ${month}.`, over: false };
}
