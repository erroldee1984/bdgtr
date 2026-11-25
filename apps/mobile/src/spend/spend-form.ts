import { addDays, CreateTransactionInputSchema, isTooFarAhead, manilaDate, parseAmountInput } from '@bdgtr/shared';

export interface SpendFormValues {
  date: string;
  categoryId: string | null;
  amount: string;
  description: string;
}

export type SpendFormErrors = Partial<Record<'category' | 'amount' | 'date' | 'description', string>>;

const AMOUNT_MESSAGES = {
  empty: 'Enter how much was spent',
  invalid: 'Enter an amount like 250 or 1,234.50',
  too_many_decimals: 'Use at most 2 decimal places',
  not_positive: 'Amount must be more than ₱0',
  too_large: 'That amount is too large',
} as const;

/** Today and yesterday in Manila (the quick date choices). */
export function quickDates(now: Date): { today: string; yesterday: string } {
  const today = manilaDate(now);
  return { today, yesterday: addDays(today, -1) };
}

/** Validates the Add spend form with the same rules as the server. */
export function validateSpendForm(
  values: SpendFormValues,
  clientId: string,
  now: Date,
):
  | { ok: true; input: { clientId: string; date: string; categoryId: string; amountMinor: number; description?: string | null } }
  | { ok: false; errors: SpendFormErrors } {
  const errors: SpendFormErrors = {};
  if (!values.categoryId) errors.category = 'Choose a category';
  const amount = parseAmountInput(values.amount);
  if (!amount.ok) errors.amount = AMOUNT_MESSAGES[amount.error];
  if (isTooFarAhead(values.date, now)) errors.date = 'Date is more than a year ahead';

  const parsed = CreateTransactionInputSchema.safeParse({
    clientId,
    date: values.date,
    categoryId: values.categoryId ?? '',
    amountMinor: amount.ok ? amount.amountMinor : 1,
    description: values.description,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'date' && !errors.date) errors.date = issue.message;
      if (field === 'description') errors.description = issue.message;
    }
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

const DAY = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "2026-11-25" → "Wed, Nov 25, 2026". */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return DAY.format(new Date(Date.UTC(y!, m! - 1, d!)));
}
