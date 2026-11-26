import { z } from 'zod';

import { formatPHP } from './money.ts';
import { TransactionSchema } from './transactions.ts';

/**
 * Budget alerts (docs/PLAN.md §6.3, §6.10, §2b).
 *
 * After each new spend, per scope (the spend's category, and the household total):
 * - spending above 100% of the budget → "over";
 * - otherwise spending at 90% or more → "near";
 * and that alert is recorded only if this household hasn't had it yet this
 * month (the database allows one per household, month, scope and level).
 * So "near" fires once on reaching 90%, "over" on passing 100%, a spend that
 * jumps past both sends only "over", and a ₱0 budget never fires.
 *
 * Category budgets: every new spend in a category at 90% or more sends that
 * category's current alert again with updated numbers; a repeated "over" is
 * titled "Still over budget". The household total stays once a month per level.
 *
 * Judging the level reached (not "did this one spend cross the line") keeps
 * simultaneous spends from all missing a crossing: whichever save checks
 * last sees every spend.
 */

export const ALERT_LEVELS = ['near', 'over'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** The alert level spending has reached. Integer maths only: no rounding surprises. */
export function levelReached(spentMinor: number, budgetMinor: number): AlertLevel | null {
  if (budgetMinor <= 0) return null;
  if (spentMinor > budgetMinor) return 'over';
  if (spentMinor * 10 >= budgetMinor * 9) return 'near';
  return null;
}

/** Whole percent of budget used, rounded down (so "90%" really means at least 90%). */
export function percentUsed(spentMinor: number, budgetMinor: number): number {
  return budgetMinor > 0 ? Math.floor((spentMinor * 100) / budgetMinor) : 0;
}

export const HOUSEHOLD_LABEL_MAX = 40;

/**
 * "Dela Cruz" → "Dela Cruz household"; a name already ending in "household"
 * isn't doubled; long names are shortened so the amount stays visible in a
 * collapsed notification.
 */
export function householdLabel(name: string): string {
  const trimmed = name.trim();
  const short = trimmed.length > HOUSEHOLD_LABEL_MAX ? `${trimmed.slice(0, HOUSEHOLD_LABEL_MAX - 1).trimEnd()}…` : trimmed;
  return /household$/i.test(trimmed) ? short : `${short} household`;
}

/** Whole pesos for notification text: ₱8,000 rather than ₱8,000.00 (keeps it short). */
function pesos(minor: number): string {
  return minor % 100 === 0 ? formatPHP(minor).replace(/\.00$/, '') : formatPHP(minor);
}

/**
 * Notification/toast wording, household first, never a transaction
 * description (notifications can show on a lock screen).
 */
export function formatAlert(input: {
  householdName: string;
  /** Null for the household total. */
  categoryName: string | null;
  level: AlertLevel;
  budgetMinor: number;
  spentMinor: number;
  /** A further spend in a category already at this level this month. */
  repeat?: boolean;
}): { title: string; body: string } {
  const who = householdLabel(input.householdName);
  const budget = input.categoryName ? `${pesos(input.budgetMinor)} ${input.categoryName} budget` : `${pesos(input.budgetMinor)} monthly budget`;
  if (input.level === 'over') {
    return {
      title: input.categoryName
        ? `${input.repeat ? 'Still over budget' : 'Over budget'} · ${input.categoryName}`
        : 'Over the monthly budget',
      body: `${who} is over its ${budget} by ${pesos(input.spentMinor - input.budgetMinor)}`,
    };
  }
  return {
    title: input.categoryName ? `Nearly at budget · ${input.categoryName}` : 'Nearly at the monthly budget',
    body: `${who} has used ${percentUsed(input.spentMinor, input.budgetMinor)}% of its ${budget}`,
  };
}

/**
 * What an alert is about. Fixed-transaction notices (docs/PLAN.md §6.5) go out
 * with the 7:00 AM run: "added automatically" to the whole household, "due
 * today" (items not added automatically) to the House Owner and Co-Owners.
 * Notices use level 'near', the neutral, polite style, so app builds from
 * before notices existed still read them.
 */
export const ALERT_KINDS = ['budget', 'fixed_added', 'fixed_due'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Wording for a fixed-transaction notice: household first, never the description. */
export function formatFixedNotice(input: {
  kind: 'fixed_added' | 'fixed_due';
  householdName: string;
  itemName: string;
  amountMinor: number;
  categoryName: string | null;
}): { title: string; body: string } {
  const who = householdLabel(input.householdName);
  const what = `${input.itemName} (${pesos(input.amountMinor)}${input.categoryName ? `, ${input.categoryName}` : ''})`;
  if (input.kind === 'fixed_added') {
    return { title: `Added automatically · ${input.itemName}`, body: `${who}: ${what} was added as today's spend.` };
  }
  return { title: `Due today · ${input.itemName}`, body: `${who}: ${what} is due today. Add it in Fixed transactions.` };
}

export const AlertSchema = z.object({
  id: z.string(),
  yearMonth: z.string(),
  /** Older servers sent no kind: those were all budget alerts. */
  kind: z.enum(ALERT_KINDS).default('budget'),
  level: z.enum(ALERT_LEVELS),
  /** Null for the household total. */
  categoryId: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  /** Who entered the spend that crossed the line (name, else email). */
  triggeredBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  unread: z.boolean(),
});
export type Alert = z.infer<typeof AlertSchema>;

/** POST /transactions: the saved spend and any alerts it set off (empty on a retried save). */
export const CreateTransactionResponseSchema = z.object({
  transaction: TransactionSchema,
  alerts: z.array(AlertSchema),
});
export type CreateTransactionResponse = z.infer<typeof CreateTransactionResponseSchema>;

export const AlertsResponseSchema = z.object({
  alerts: z.array(AlertSchema),
  unreadCount: z.number().int().min(0),
});
export type AlertsResponse = z.infer<typeof AlertsResponseSchema>;
