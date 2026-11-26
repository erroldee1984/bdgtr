import { z } from 'zod';

import { fixedPostingDate, isValidIsoDate } from './dates.ts';
import { MAX_AMOUNT_MINOR } from './money.ts';
import { DESCRIPTION_MAX, MIN_TRANSACTION_DATE, TransactionSchema } from './transactions.ts';
import { AlertSchema } from './alerts.ts';

/**
 * Monthly fixed transactions (docs/PLAN.md §6.5): rent, bills, allowances.
 * Each can auto-post on its day (00:15 Manila cron; days 29–31 clamp to the
 * month's end) and can be bulk-added on any date.
 */

export const FIXED_NAME_MAX = 60;
export const MAX_FIXED_TRANSACTIONS = 100;
export const MAX_BULK_POST = 100;

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(FIXED_NAME_MAX, `Name must be ${FIXED_NAME_MAX} characters or fewer`)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Name contains invalid characters');

const amountMinor = z
  .number({ error: 'Amount must be a number' })
  .int('Amount must be in whole centavos')
  .min(1, 'Amount must be more than ₱0')
  .max(MAX_AMOUNT_MINOR, 'Amount is too large');

const dayOfMonth = z
  .number({ error: 'Day is required' })
  .int('Day must be a whole number')
  .min(1, 'Day must be 1–31')
  .max(31, 'Day must be 1–31');

const description = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or fewer`)
  .refine((v) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(v), 'Description contains invalid characters')
  .transform((v) => (v.length ? v : null))
  .nullable();

export const CreateFixedInputSchema = z
  .object({
    name,
    categoryId: objectId,
    amountMinor,
    dayOfMonth,
    autoPostEnabled: z.boolean(),
    description: description.optional(),
  })
  .strict();
export type CreateFixedInput = z.infer<typeof CreateFixedInputSchema>;

export const UpdateFixedInputSchema = z
  .object({
    name: name.optional(),
    categoryId: objectId.optional(),
    amountMinor: amountMinor.optional(),
    dayOfMonth: dayOfMonth.optional(),
    autoPostEnabled: z.boolean().optional(),
    description: description.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });
export type UpdateFixedInput = z.infer<typeof UpdateFixedInputSchema>;

export const FixedTransactionSchema = z.object({
  id: objectId,
  name: z.string(),
  categoryId: objectId,
  amountMinor: z.number().int(),
  description: z.string().nullable(),
  dayOfMonth: z.number().int().min(1).max(31),
  autoPostEnabled: z.boolean(),
  /** The date it was added in the month asked about, or null if not yet. */
  postedOn: z.string().nullable(),
});
export type FixedTransaction = z.infer<typeof FixedTransactionSchema>;

export const FixedTransactionsResponseSchema = z.object({ month: z.string(), items: z.array(FixedTransactionSchema) });
export type FixedTransactionsResponse = z.infer<typeof FixedTransactionsResponseSchema>;
export const FixedTransactionResponseSchema = z.object({ item: FixedTransactionSchema });
export type FixedTransactionResponse = z.infer<typeof FixedTransactionResponseSchema>;

/**
 * Bulk add: the chosen items as spends on one date. Each carries its own
 * clientId (a UUID from the app), so a retried request never adds twice.
 * The app has already let the user skip items added earlier in the month.
 */
export const BulkPostInputSchema = z
  .object({
    date: z
      .string({ error: 'Date is required' })
      .refine(isValidIsoDate, 'Use a real date (YYYY-MM-DD)')
      .refine((d) => d >= MIN_TRANSACTION_DATE, 'Date is too far in the past'),
    items: z
      .array(z.object({ id: objectId, clientId: z.uuid({ error: 'clientId must be a UUID' }) }).strict())
      .min(1, 'Choose at least one item')
      .max(MAX_BULK_POST, `At most ${MAX_BULK_POST} items at once`)
      .refine((xs) => new Set(xs.map((x) => x.id)).size === xs.length, 'Each item only once')
      .refine((xs) => new Set(xs.map((x) => x.clientId)).size === xs.length, 'Each clientId only once'),
  })
  .strict();
export type BulkPostInput = z.infer<typeof BulkPostInputSchema>;

export const BulkPostResponseSchema = z.object({
  transactions: z.array(TransactionSchema),
  alerts: z.array(AlertSchema),
});
export type BulkPostResponse = z.infer<typeof BulkPostResponseSchema>;

/**
 * The fixed items an auto-post run on `today` (YYYY-MM-DD, Manila) should
 * post: those whose day, clamped to this month, is today. So on the last day
 * of a short month, days up to 31 all post.
 */
export function isDueOn(dayOfMonthValue: number, today: string): boolean {
  return fixedPostingDate(today.slice(0, 7), dayOfMonthValue) === today;
}

/** "Every month on the 5th"; "on the last day" style wording for 29–31 is left to the day itself. */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
}
