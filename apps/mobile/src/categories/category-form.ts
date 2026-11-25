import {
  type CategoryColour,
  type CategoryIcon,
  type CreateCategoryInput,
  CreateCategoryInputSchema,
  parseAmountInput,
} from '@bdgtr/shared';

export interface CategoryFormValues {
  name: string;
  icon: CategoryIcon;
  colour: CategoryColour;
  /** As typed; empty or 0 means "no default budget" (₱0). */
  budget: string;
}

export type CategoryFormErrors = Partial<Record<'name' | 'budget', string>>;

const BUDGET_MESSAGES = {
  invalid: 'Enter an amount like 5,000 or 5000.50',
  too_many_decimals: 'Use at most 2 decimal places',
  too_large: 'That amount is too large',
} as const;

/** "" or "0" → 0 (no budget); otherwise a peso amount in centavos, or an error message. */
export function parseOptionalBudget(text: string): { ok: true; minor: number } | { ok: false; error: string } {
  const r = parseAmountInput(text);
  if (r.ok) return { ok: true, minor: r.amountMinor };
  if (r.error === 'empty' || r.error === 'not_positive') return { ok: true, minor: 0 };
  return { ok: false, error: BUDGET_MESSAGES[r.error] };
}

export function validateCategoryForm(
  values: CategoryFormValues,
): { ok: true; input: CreateCategoryInput } | { ok: false; errors: CategoryFormErrors } {
  const errors: CategoryFormErrors = {};
  const budget = parseOptionalBudget(values.budget);
  if (!budget.ok) errors.budget = budget.error;
  const parsed = CreateCategoryInputSchema.safeParse({
    name: values.name,
    icon: values.icon,
    colour: values.colour,
    defaultBudgetMinor: budget.ok ? budget.minor : 0,
  });
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.find((i) => i.path[0] === 'name');
    if (nameIssue) errors.name = nameIssue.message;
  }
  if (errors.name || errors.budget || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

/** Amount as typed back into the form, e.g. 500000 → "5000.00"; 0 → "". */
export function budgetText(minor: number): string {
  return minor > 0 ? (minor / 100).toFixed(2) : '';
}
