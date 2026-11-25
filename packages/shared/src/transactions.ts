import { z } from 'zod';

import { addDays, isValidIsoDate, manilaDate } from './dates.ts';
import { MAX_AMOUNT_MINOR } from './money.ts';

/**
 * Transactions (docs/PLAN.md §4, §6.3). Amounts are positive whole centavos.
 * `clientId` is a UUID made by the app, so a retried save never creates a
 * duplicate (and offline queuing can come later without changes).
 */

export const DESCRIPTION_MAX = 500;
/** Furthest ahead a spend may be dated (a typo guard; plan §11). */
export const MAX_DAYS_AHEAD = 365;
/** Oldest date accepted. */
export const MIN_TRANSACTION_DATE = '2000-01-01';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');

const isoDate = z
  .string({ error: 'Date is required' })
  .refine(isValidIsoDate, 'Use a real date (YYYY-MM-DD)')
  .refine((d) => d >= MIN_TRANSACTION_DATE, 'Date is too far in the past');

const amountMinor = z
  .number({ error: 'Amount must be a number' })
  .int('Amount must be in whole centavos')
  .min(1, 'Amount must be more than ₱0')
  .max(MAX_AMOUNT_MINOR, 'Amount is too large');

/** Optional free text; control characters other than line breaks are refused. */
const description = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or fewer`)
  .refine((v) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(v), 'Description contains invalid characters')
  .transform((v) => (v.length ? v : null))
  .nullable();

export const CreateTransactionInputSchema = z
  .object({
    clientId: z.uuid({ error: 'clientId must be a UUID' }),
    date: isoDate,
    categoryId: objectId,
    amountMinor,
    description: description.optional(),
  })
  .strict();
export type CreateTransactionInput = z.infer<typeof CreateTransactionInputSchema>;

export const UpdateTransactionInputSchema = z
  .object({
    date: isoDate.optional(),
    categoryId: objectId.optional(),
    amountMinor: amountMinor.optional(),
    description: description.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });
export type UpdateTransactionInput = z.infer<typeof UpdateTransactionInputSchema>;

/** A date that is too far ahead of "today" in Manila (checked server-side with the server's clock). */
export function isTooFarAhead(date: string, now: Date): boolean {
  return date > addDays(manilaDate(now), MAX_DAYS_AHEAD);
}

export const TransactionSchema = z.object({
  id: objectId,
  clientId: z.uuid(),
  date: z.string().refine(isValidIsoDate),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  categoryId: objectId,
  amountMinor: z.number().int().min(1),
  description: z.string().nullable(),
  /** Who entered it (user id) and whether that's the caller. */
  createdBy: objectId,
  isYours: z.boolean(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const TransactionResponseSchema = z.object({ transaction: TransactionSchema });
export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;
export const TransactionsResponseSchema = z.object({ transactions: z.array(TransactionSchema) });
export type TransactionsResponse = z.infer<typeof TransactionsResponseSchema>;
