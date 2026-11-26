import type { Dashboard } from '@bdgtr/shared';

import type { OutboxItem } from './outbox';

/**
 * The dashboard with spends still waiting to be sent added in, so "remaining"
 * stays honest offline (docs/PLAN.md §15). Only this household's pending
 * spends dated in the dashboard's month; refused ones ("needs attention") aren't counted.
 */
export function withPending(dashboard: Dashboard, items: OutboxItem[], householdId: string): { dashboard: Dashboard; pendingMinor: number } {
  const mine = items.filter((i) => i.state === 'pending' && i.householdId === householdId && i.input.date.startsWith(dashboard.month));
  if (mine.length === 0) return { dashboard, pendingMinor: 0 };
  const byCategory = new Map<string, number>();
  for (const i of mine) byCategory.set(i.input.categoryId, (byCategory.get(i.input.categoryId) ?? 0) + i.input.amountMinor);
  const pendingMinor = mine.reduce((s, i) => s + i.input.amountMinor, 0);
  return {
    pendingMinor,
    dashboard: {
      ...dashboard,
      spentMinor: dashboard.spentMinor + pendingMinor,
      remainingMinor: dashboard.remainingMinor - pendingMinor,
      categories: dashboard.categories.map((c) => ({ ...c, spentMinor: c.spentMinor + (byCategory.get(c.id) ?? 0) })),
    },
  };
}
