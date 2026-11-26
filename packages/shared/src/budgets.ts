import { z } from 'zod';

import { CATEGORY_COLOURS, CATEGORY_ICONS } from './categories.ts';
import { YEAR_MONTH_PATTERN } from './dashboard.ts';
import { MAX_AMOUNT_MINOR } from './money.ts';

/**
 * Budgets for a month (docs/PLAN.md §4 "Effective-budget resolution", §6.6, §6.7).
 * Defaults live on the household and each category; a month can override
 * either. Overrides are stored only when they differ from the default, so
 * editing a default flows into every month without an override.
 */

/** Months a budget can be set for (abuse guard; far wider than real use). */
export function isBudgetMonth(yearMonth: string): boolean {
  const m = YEAR_MONTH_PATTERN.exec(yearMonth);
  if (!m) return false;
  const year = Number(m[1]);
  return year >= 2000 && year <= 2099;
}

/** PUT /budgets/monthly/:yearMonth and /budgets/categories/:yearMonth/:categoryId. */
export const SetBudgetInputSchema = z
  .object({
    budgetMinor: z
      .number({ error: 'Budget must be a number' })
      .int('Budget must be in whole centavos')
      .min(0, 'Budget cannot be negative')
      .max(MAX_AMOUNT_MINOR, 'Budget is too large'),
  })
  .strict();
export type SetBudgetInput = z.infer<typeof SetBudgetInputSchema>;

/** The month's value: the override if there is one, else the default. */
export function effectiveBudget(defaultMinor: number, overrideMinor: number | null | undefined): number {
  return overrideMinor ?? defaultMinor;
}

export interface Allocation {
  allocatedMinor: number;
  /** Negative when more is allocated to categories than the total (over-allocated). */
  unallocatedMinor: number;
  /** Whole percent of the total allocated (0 with no total); can pass 100. */
  percentAllocated: number;
}

/** How much of the total the categories take (the donut, §6.7). */
export function allocation(totalMinor: number, categoryBudgetsMinor: number[]): Allocation {
  const allocatedMinor = categoryBudgetsMinor.reduce((sum, v) => sum + v, 0);
  return {
    allocatedMinor,
    unallocatedMinor: totalMinor - allocatedMinor,
    percentAllocated: totalMinor > 0 ? Math.floor((allocatedMinor * 100) / totalMinor) : 0,
  };
}

const minor = z.number().int().min(0);
const AllocationSchema = z.object({
  allocatedMinor: minor,
  unallocatedMinor: z.number().int(),
  percentAllocated: minor,
});

export const MonthBudgetCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.enum(CATEGORY_ICONS),
  colour: z.enum(CATEGORY_COLOURS),
  defaultBudgetMinor: minor,
  /** This month's override, or null when the default applies. */
  overrideMinor: minor.nullable(),
  /** What applies this month. */
  budgetMinor: minor,
});
export type MonthBudgetCategory = z.infer<typeof MonthBudgetCategorySchema>;

/** GET /budgets?month=YYYY-MM (active categories only). */
export const MonthBudgetsSchema = z.object({
  month: z.string().regex(YEAR_MONTH_PATTERN),
  defaultMonthlyBudgetMinor: minor,
  monthlyOverrideMinor: minor.nullable(),
  totalBudgetMinor: minor,
  categories: z.array(MonthBudgetCategorySchema),
  /** The defaults: default total vs category defaults. */
  defaults: AllocationSchema,
  /** This month: the month's total vs the month's category budgets. */
  thisMonth: AllocationSchema,
});
export type MonthBudgets = z.infer<typeof MonthBudgetsSchema>;

export function buildMonthBudgets(input: {
  month: string;
  defaultMonthlyBudgetMinor: number;
  monthlyOverrideMinor: number | null;
  categories: { id: string; name: string; icon: MonthBudgetCategory['icon']; colour: MonthBudgetCategory['colour']; defaultBudgetMinor: number; overrideMinor: number | null }[];
}): MonthBudgets {
  const categories = input.categories
    .map((c) => ({ ...c, budgetMinor: effectiveBudget(c.defaultBudgetMinor, c.overrideMinor) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-PH'));
  const totalBudgetMinor = effectiveBudget(input.defaultMonthlyBudgetMinor, input.monthlyOverrideMinor);
  return {
    month: input.month,
    defaultMonthlyBudgetMinor: input.defaultMonthlyBudgetMinor,
    monthlyOverrideMinor: input.monthlyOverrideMinor,
    totalBudgetMinor,
    categories,
    defaults: allocation(input.defaultMonthlyBudgetMinor, categories.map((c) => c.defaultBudgetMinor)),
    thisMonth: allocation(totalBudgetMinor, categories.map((c) => c.budgetMinor)),
  };
}
