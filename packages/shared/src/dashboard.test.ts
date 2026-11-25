import { describe, expect, it } from 'vitest';

import { barShares, buildDashboard } from './dashboard.ts';

const cat = (id: string, name: string, budgetMinor = 0, isRemoved = false) => ({
  id,
  name,
  icon: 'cart' as const,
  colour: '#4ADE80' as const,
  budgetMinor,
  isRemoved,
});

describe('buildDashboard', () => {
  it('totals spending, shows remaining, most spent first', () => {
    const d = buildDashboard({
      month: '2026-11',
      totalBudgetMinor: 1_000_000,
      categories: [cat('a', 'Food', 300_000), cat('b', 'Bus', 100_000), cat('c', 'Gifts')],
      spentByCategory: new Map([
        ['a', 120_000],
        ['b', 150_000],
      ]),
    });
    expect(d).toMatchObject({ spentMinor: 270_000, remainingMinor: 730_000 });
    expect(d.categories.map((c) => [c.name, c.spentMinor])).toEqual([
      ['Bus', 150_000],
      ['Food', 120_000],
      ['Gifts', 0], // active with nothing spent: still listed
    ]);
  });

  it('over budget → negative remaining', () => {
    const d = buildDashboard({ month: '2026-11', totalBudgetMinor: 100, categories: [cat('a', 'Food')], spentByCategory: new Map([['a', 250]]) });
    expect(d.remainingMinor).toBe(-150);
  });

  it('removed categories appear only if something was spent in them this month', () => {
    const d = buildDashboard({
      month: '2026-11',
      totalBudgetMinor: 0,
      categories: [cat('a', 'Old, used', 0, true), cat('b', 'Old, unused', 0, true)],
      spentByCategory: new Map([['a', 5]]),
    });
    expect(d.categories.map((c) => c.name)).toEqual(['Old, used']);
  });

  it('nothing spent and no categories: all zero, no crash', () => {
    expect(buildDashboard({ month: '2026-11', totalBudgetMinor: 0, categories: [], spentByCategory: new Map() })).toEqual({
      month: '2026-11',
      totalBudgetMinor: 0,
      spentMinor: 0,
      remainingMinor: 0,
      categories: [],
    });
  });
});

describe('barShares', () => {
  it.each([
    [0, 1000, { spent: 0, remaining: 1, over: 0 }],
    [250, 1000, { spent: 0.25, remaining: 0.75, over: 0 }],
    [1000, 1000, { spent: 1, remaining: 0, over: 0 }], // exactly on budget is not "over"
    [1500, 1000, { spent: 1, remaining: 0, over: 500 }],
    [300, 0, { spent: 1, remaining: 0, over: 300 }], // no budget but spent
    [0, 0, { spent: 0, remaining: 0, over: 0 }],
  ])('spent %i of %i → %j', (spent, budget, expected) => {
    expect(barShares(spent, budget)).toEqual(expected);
  });
});
