import { type CreateFixedInput, CreateFixedInputSchema, type FixedTransaction, ordinal, parseAmountInput } from '@bdgtr/shared';

/** The add/edit form as typed (docs/PLAN.md §6.5). */
export interface FixedFormValues {
  name: string;
  amount: string;
  categoryId: string | null;
  day: string;
  autoPost: boolean;
  description: string;
}

export type FixedFormErrors = Partial<Record<'name' | 'amount' | 'category' | 'day' | 'description', string>>;

export const EMPTY_FIXED_FORM: FixedFormValues = { name: '', amount: '', categoryId: null, day: '', autoPost: true, description: '' };

const AMOUNT_MESSAGES = {
  empty: 'Enter an amount',
  not_positive: 'Amount must be more than ₱0',
  invalid: 'Enter an amount like 5,000 or 5000.50',
  too_many_decimals: 'Use at most 2 decimal places',
  too_large: 'That amount is too large',
} as const;

/** An existing item as form values (for Edit). */
export function formFromItem(item: FixedTransaction): FixedFormValues {
  const minor = item.amountMinor;
  return {
    name: item.name,
    amount: minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2),
    categoryId: item.categoryId,
    day: String(item.dayOfMonth),
    autoPost: item.autoPostEnabled,
    description: item.description ?? '',
  };
}

export function validateFixedForm(v: FixedFormValues): { ok: true; input: CreateFixedInput } | { ok: false; errors: FixedFormErrors } {
  const errors: FixedFormErrors = {};
  const amount = parseAmountInput(v.amount);
  if (!amount.ok) errors.amount = AMOUNT_MESSAGES[amount.error];
  if (!v.categoryId) errors.category = 'Choose a category';
  const day = /^\d{1,2}$/.test(v.day.trim()) ? Number(v.day.trim()) : NaN;
  if (!(day >= 1 && day <= 31)) errors.day = 'Enter a day from 1 to 31';

  const parsed = CreateFixedInputSchema.safeParse({
    name: v.name,
    categoryId: v.categoryId ?? '0'.repeat(24),
    amountMinor: amount.ok ? amount.amountMinor : 1,
    dayOfMonth: Number.isNaN(day) ? 1 : Math.min(Math.max(day, 1), 31),
    autoPostEnabled: v.autoPost,
    description: v.description,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'name' && !errors.name) errors.name = issue.message;
      if (field === 'description' && !errors.description) errors.description = issue.message;
    }
  }
  if (Object.keys(errors).length || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

/** "Every month on the 5th"; days 29–31 also say what happens in short months. */
export function scheduleText(day: number): string {
  const base = `Every month on the ${ordinal(day)}`;
  return day >= 29 ? `${base} (or the last day of shorter months)` : base;
}
