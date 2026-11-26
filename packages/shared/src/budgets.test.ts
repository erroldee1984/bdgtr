import { describe, expect, it } from 'vitest';

import { allocation, buildMonthBudgets, effectiveBudget, isBudgetMonth, MonthBudgetsSchema, SetBudgetInputSchema } from './budgets.ts';
import { MAX_AMOUNT_MINOR } from './money.ts';

describe('effectiveBudget', () => {
  it('an override beats the default; no override falls back to the default', () => {
    expect(effectiveBudget(800_000, 500_000)).toBe(500_000);
    expect(effectiveBudget(800_000, null)).toBe(800_000);
    expect(effectiveBudget(800_000, undefined)).toBe(800_000);
  });
  it('a ₱0 override is still an override', () => {
    expect(effectiveBudget(800_000, 0)).toBe(0);
  });
});

describe('allocation', () => {
  it('allocated, unallocated and whole percent', () => {
    expect(allocation(1_000_000, [300_000, 200_000])).toEqual({ allocatedMinor: 500_000, unallocatedMinor: 500_000, percentAllocated: 50 });
  });
  it('over-allocated: unallocated goes negative and percent passes 100', () => {
    expect(allocation(100_000, [80_000, 70_000])).toEqual({ allocatedMinor: 150_000, unallocatedMinor: -50_000, percentAllocated: 150 });
  });
  it('no total budget: 0% (no division by zero)', () => {
    expect(allocation(0, [10_000])).toEqual({ allocatedMinor: 10_000, unallocatedMinor: -10_000, percentAllocated: 0 });
    expect(allocation(0, [])).toEqual({ allocatedMinor: 0, unallocatedMinor: 0, percentAllocated: 0 });
  });
  it('rounds the percent down (99.9% is not "100%")', () => {
    expect(allocation(100_000, [99_900]).percentAllocated).toBe(99);
  });
});

describe('buildMonthBudgets', () => {
  const cat = (id: string, name: string, defaultBudgetMinor: number, overrideMinor: number | null) =>
    ({ id, name, icon: 'cart', colour: '#5A94FF', defaultBudgetMinor, overrideMinor }) as const;

  it('works out this month and the defaults side by side, categories by name', () => {
    const b = buildMonthBudgets({
      month: '2026-12',
      defaultMonthlyBudgetMinor: 4_000_000,
      monthlyOverrideMinor: 5_000_000,
      categories: [cat('2', 'Transport', 500_000, null), cat('1', 'Groceries', 800_000, 1_200_000)],
    });
    expect(MonthBudgetsSchema.parse(b)).toEqual(b);
    expect(b.totalBudgetMinor).toBe(5_000_000);
    expect(b.categories.map((c) => [c.name, c.budgetMinor])).toEqual([['Groceries', 1_200_000], ['Transport', 500_000]]);
    expect(b.defaults).toEqual({ allocatedMinor: 1_300_000, unallocatedMinor: 2_700_000, percentAllocated: 32 });
    expect(b.thisMonth).toEqual({ allocatedMinor: 1_700_000, unallocatedMinor: 3_300_000, percentAllocated: 34 });
  });

  it('no overrides: this month equals the defaults', () => {
    const b = buildMonthBudgets({ month: '2026-12', defaultMonthlyBudgetMinor: 100, monthlyOverrideMinor: null, categories: [cat('1', 'A', 50, null)] });
    expect(b.thisMonth).toEqual(b.defaults);
    expect(b.totalBudgetMinor).toBe(100);
  });
});

describe('SetBudgetInputSchema', () => {
  it('accepts ₱0 up to the maximum', () => {
    expect(SetBudgetInputSchema.parse({ budgetMinor: 0 })).toEqual({ budgetMinor: 0 });
    expect(SetBudgetInputSchema.parse({ budgetMinor: MAX_AMOUNT_MINOR }).budgetMinor).toBe(MAX_AMOUNT_MINOR);
  });
  it.each([
    ['negative', { budgetMinor: -1 }],
    ['fractional centavos', { budgetMinor: 1.5 }],
    ['too large', { budgetMinor: MAX_AMOUNT_MINOR + 1 }],
    ['text', { budgetMinor: '100' }],
    ['missing', {}],
    ['extra fields', { budgetMinor: 1, householdId: 'x' }],
  ])('rejects %s', (_label, input) => {
    expect(SetBudgetInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('isBudgetMonth', () => {
  it.each(['2000-01', '2026-11', '2099-12'])('accepts %s', (m) => expect(isBudgetMonth(m)).toBe(true));
  it.each(['1999-12', '2100-01', '2026-13', '2026-00', '2026-1', 'default', ''])('refuses %s', (m) => expect(isBudgetMonth(m)).toBe(false));
});
