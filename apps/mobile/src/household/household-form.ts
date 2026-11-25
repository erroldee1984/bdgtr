import { CreateHouseholdInputSchema, type CreateHouseholdInput, parseAmountInput } from '@bdgtr/shared';

export interface HouseholdFormValues {
  name: string;
  budget: string; // as typed, e.g. "40,000"
}

export type HouseholdFormErrors = Partial<Record<keyof HouseholdFormValues, string>>;

const AMOUNT_MESSAGES = {
  empty: 'Enter a monthly budget',
  invalid: 'Enter an amount like 40,000 or 40000.50',
  too_many_decimals: 'Use at most 2 decimal places',
  not_positive: 'Budget must be more than ₱0',
  too_large: 'That amount is too large',
} as const;

/** Validates the create-household form; messages are plain sentences for the UI. */
export function validateHouseholdForm(
  values: HouseholdFormValues,
): { ok: true; input: CreateHouseholdInput } | { ok: false; errors: HouseholdFormErrors } {
  const errors: HouseholdFormErrors = {};
  const amount = parseAmountInput(values.budget);
  if (!amount.ok) errors.budget = AMOUNT_MESSAGES[amount.error];

  const parsed = CreateHouseholdInputSchema.safeParse({
    name: values.name,
    defaultMonthlyBudgetMinor: amount.ok ? amount.amountMinor : 0,
  });
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.find((i) => i.path[0] === 'name');
    if (nameIssue) errors.name = nameIssue.message;
  }
  if (errors.name || errors.budget || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}
