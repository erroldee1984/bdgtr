import { describe, expect, it } from 'vitest';

import { formatAlert, householdLabel, levelReached, percentUsed } from './alerts.ts';

describe('levelReached (threshold rule, docs/PLAN.md §6.3)', () => {
  const B = 100_000; // ₱1,000 budget
  it.each([
    ['below 90%', 89_999, null],
    ['exactly 90%', 90_000, 'near'],
    ['95%', 95_000, 'near'],
    ['exactly 100% is still "near", not over', 100_000, 'near'],
    ['just over 100%', 100_001, 'over'],
    ['far over', 1_000_000, 'over'],
    ['nothing spent', 0, null],
  ] as const)('%s → %s', (_label, spent, expected) => {
    expect(levelReached(spent, B)).toBe(expected);
  });

  it.each([0, -5])('a budget of %i never fires', (budget) => {
    expect(levelReached(9_999_999, budget)).toBeNull();
  });

  it('uses whole-centavo maths: 90% of ₱333.33 needs ₱300.00 (not a rounded float)', () => {
    expect(levelReached(29_999, 33_333)).toBeNull(); // 89.997%
    expect(levelReached(30_000, 33_333)).toBe('near'); // 90.0009%
  });
});

describe('percentUsed', () => {
  it('rounds down, so "90%" always means at least 90%', () => {
    expect(percentUsed(89_999, 100_000)).toBe(89);
    expect(percentUsed(92_500, 100_000)).toBe(92);
    expect(percentUsed(5, 0)).toBe(0);
  });
});

describe('householdLabel', () => {
  it.each([
    ['Dela Cruz', 'Dela Cruz household'],
    ['Dela Cruz Household', 'Dela Cruz Household'], // not doubled
    ['the santos household', 'the santos household'],
    ['  Reyes  ', 'Reyes household'],
  ])('%j → %j', (name, label) => expect(householdLabel(name)).toBe(label));

  it('caps long names at 40 characters so the amount stays visible', () => {
    const label = householdLabel('A'.repeat(60));
    expect(label).toBe(`${'A'.repeat(39)}… household`);
  });
});

describe('formatAlert (household-first wording, no descriptions)', () => {
  it('near, category', () => {
    expect(formatAlert({ householdName: 'Dela Cruz', categoryName: 'Groceries', level: 'near', budgetMinor: 800_000, spentMinor: 736_000 })).toEqual({
      title: 'Nearly at budget · Groceries',
      body: 'Dela Cruz household has used 92% of its ₱8,000 Groceries budget',
    });
  });

  it('over, household total', () => {
    expect(formatAlert({ householdName: 'Dela Cruz', categoryName: null, level: 'over', budgetMinor: 4_000_000, spentMinor: 4_115_000 })).toEqual({
      title: 'Over the monthly budget',
      body: 'Dela Cruz household is over its ₱40,000 monthly budget by ₱1,150',
    });
  });

  it('keeps centavos when there are some', () => {
    expect(formatAlert({ householdName: 'Reyes Household', categoryName: 'Bills', level: 'over', budgetMinor: 100_050, spentMinor: 100_100 }).body).toBe(
      'Reyes Household is over its ₱1,000.50 Bills budget by ₱0.50',
    );
  });
});
