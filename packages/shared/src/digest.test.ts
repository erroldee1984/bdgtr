import { describe, expect, it } from 'vitest';

import { formatDailySummary, monthName, summaryDay } from './digest.ts';

const base = { householdName: 'Dela Cruz', yesterday: '2026-11-22', monthBudgetMinor: 4_000_000 };

describe('formatDailySummary (docs/PLAN.md §6.11 examples)', () => {
  it('normal day', () => {
    expect(formatDailySummary({ ...base, yesterdaySpentMinor: 184_550, monthSpentMinor: 2_768_975 })).toEqual({
      title: 'Daily summary · Dela Cruz household',
      body: 'Yesterday (Sun, 22 Nov) Dela Cruz household spent ₱1,845.50. ₱12,310.25 left of ₱40,000.00 for November.',
      over: false,
    });
  });

  it('over budget → "Over budget by", sent as high priority', () => {
    expect(formatDailySummary({ ...base, yesterdaySpentMinor: 320_000, monthSpentMinor: 4_115_000 })).toEqual({
      title: 'Daily summary · Dela Cruz household',
      body: 'Yesterday (Sun, 22 Nov) Dela Cruz household spent ₱3,200.00. Over budget by ₱1,150.00 for November.',
      over: true,
    });
  });

  it('₱0 day still sends (D4)', () => {
    expect(formatDailySummary({ ...base, yesterdaySpentMinor: 0, monthSpentMinor: 2_768_975 }).body).toBe(
      'Yesterday (Sun, 22 Nov) Dela Cruz household had no spending recorded. ₱12,310.25 left of ₱40,000.00 for November.',
    );
  });

  it('1st of the month: last month’s close and the new budget (D3)', () => {
    const r = formatDailySummary({
      ...base,
      yesterday: '2026-11-30',
      yesterdaySpentMinor: 95_000,
      monthSpentMinor: 3_760_000,
      newMonth: { yearMonth: '2026-12', budgetMinor: 4_000_000 },
    });
    expect(r.body).toBe('Yesterday (Mon, 30 Nov) Dela Cruz household spent ₱950.00. November closed ₱2,400.00 under budget. December budget: ₱40,000.00.');
    expect(r.over).toBe(false);
  });

  it('1st of the month, closed over / exactly on / with no budget', () => {
    const first = { ...base, yesterday: '2026-11-30', yesterdaySpentMinor: 0, newMonth: { yearMonth: '2026-12', budgetMinor: 0 } };
    expect(formatDailySummary({ ...first, monthSpentMinor: 4_100_000 }).body).toContain('November closed ₱1,000.00 over budget. December budget: ₱0.00.');
    expect(formatDailySummary({ ...first, monthSpentMinor: 4_000_000 }).body).toContain('November closed exactly on budget.');
    expect(formatDailySummary({ ...first, monthBudgetMinor: 0, monthSpentMinor: 5_000 }).body).toContain('November closed with ₱50.00 spent and no budget set.');
  });

  it('exactly at the budget is ₱0 left, not over', () => {
    const r = formatDailySummary({ ...base, yesterdaySpentMinor: 100, monthSpentMinor: 4_000_000 });
    expect(r.body).toContain('₱0.00 left of ₱40,000.00 for November.');
    expect(r.over).toBe(false);
  });

  it('a household with no budget doesn’t crash', () => {
    expect(formatDailySummary({ ...base, monthBudgetMinor: 0, yesterdaySpentMinor: 5_000, monthSpentMinor: 5_000 }).body).toBe(
      'Yesterday (Sun, 22 Nov) Dela Cruz household spent ₱50.00. No budget is set for November.',
    );
  });

  it('a name ending in "Household" isn’t doubled; a 60-character name is shortened', () => {
    expect(formatDailySummary({ ...base, householdName: 'Dela Cruz Household', yesterdaySpentMinor: 0, monthSpentMinor: 0 }).title).toBe(
      'Daily summary · Dela Cruz Household',
    );
    const long = formatDailySummary({ ...base, householdName: 'x'.repeat(60), yesterdaySpentMinor: 0, monthSpentMinor: 0 });
    expect(long.title).toBe(`Daily summary · ${'x'.repeat(39)}… household`);
  });
});

describe('date words', () => {
  it('summaryDay and monthName', () => {
    expect(summaryDay('2026-11-22')).toBe('Sun, 22 Nov');
    expect(summaryDay('2027-01-01')).toBe('Fri, 1 Jan');
    expect(monthName('2026-12')).toBe('December');
  });
});
