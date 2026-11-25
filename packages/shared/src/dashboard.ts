import { z } from 'zod';

import { CATEGORY_COLOURS, CATEGORY_ICONS } from './categories.ts';

/** GET /dashboard?month=YYYY-MM (docs/PLAN.md §6.2). */

export const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const DashboardCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.enum(CATEGORY_ICONS),
  colour: z.enum(CATEGORY_COLOURS),
  budgetMinor: z.number().int().min(0),
  spentMinor: z.number().int().min(0),
  isRemoved: z.boolean(),
});
export type DashboardCategory = z.infer<typeof DashboardCategorySchema>;

export const DashboardSchema = z.object({
  month: z.string().regex(YEAR_MONTH_PATTERN),
  totalBudgetMinor: z.number().int().min(0),
  spentMinor: z.number().int().min(0),
  /** Negative when over budget. */
  remainingMinor: z.number().int(),
  categories: z.array(DashboardCategorySchema),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

/**
 * Puts the dashboard together from the month's budget, the categories and the
 * amount spent per category. Shows active categories (even with ₱0 spent) and
 * removed ones only if something was spent in them this month. Most spent
 * first, then by name.
 */
export function buildDashboard(input: {
  month: string;
  totalBudgetMinor: number;
  categories: { id: string; name: string; icon: DashboardCategory['icon']; colour: DashboardCategory['colour']; budgetMinor: number; isRemoved: boolean }[];
  spentByCategory: Map<string, number>;
}): Dashboard {
  const categories = input.categories
    .map((c) => ({ ...c, spentMinor: input.spentByCategory.get(c.id) ?? 0 }))
    .filter((c) => !c.isRemoved || c.spentMinor > 0)
    .sort((a, b) => b.spentMinor - a.spentMinor || a.name.localeCompare(b.name, 'en-PH'));
  const spentMinor = [...input.spentByCategory.values()].reduce((sum, v) => sum + v, 0);
  return {
    month: input.month,
    totalBudgetMinor: input.totalBudgetMinor,
    spentMinor,
    remainingMinor: input.totalBudgetMinor - spentMinor,
    categories,
  };
}

/**
 * Bar widths for "Spent vs Remaining" (0–1 of the bar). Over budget: the bar
 * is all spent and `over` is how much past the budget. No budget: spent fills
 * the bar if anything was spent.
 */
export function barShares(spentMinor: number, budgetMinor: number): { spent: number; remaining: number; over: number } {
  if (budgetMinor <= 0) return { spent: spentMinor > 0 ? 1 : 0, remaining: 0, over: spentMinor };
  if (spentMinor >= budgetMinor) return { spent: 1, remaining: 0, over: spentMinor - budgetMinor };
  const spent = spentMinor / budgetMinor;
  return { spent, remaining: 1 - spent, over: 0 };
}
