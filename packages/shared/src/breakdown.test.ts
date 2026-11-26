import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  arrangeBreakdown,
  type BreakdownFilter,
  DEFAULT_SORT,
  isValidRange,
  matchesFilter,
  NO_FILTER,
  prunePins,
} from './breakdown.ts';
import type { Transaction } from './transactions.ts';

const FOOD = 'a'.repeat(24);
const BILLS = 'b'.repeat(24);

function tx(id: number, date: string, amountMinor: number, categoryId = FOOD): Transaction {
  return {
    id: id.toString(16).padStart(24, '0'),
    clientId: '00000000-0000-4000-8000-' + id.toString().padStart(12, '0'),
    date,
    yearMonth: date.slice(0, 7),
    categoryId,
    amountMinor,
    description: null,
    createdBy: 'c'.repeat(24),
    isYours: true,
  };
}

const T1 = tx(1, '2026-11-03', 50_000);
const T2 = tx(2, '2026-11-10', 12_000, BILLS);
const T3 = tx(3, '2026-11-10', 90_000);
const T4 = tx(4, '2026-11-01', 12_000);
const ALL = [T1, T2, T3, T4];
const ids = (rows: { tx: Transaction }[]) => rows.map((r) => r.tx);
const none = new Set<string>();

describe('filters', () => {
  it('category and amount range combine with AND, inclusive', () => {
    const f: BreakdownFilter = { categoryIds: [FOOD], minMinor: 12_000, maxMinor: 50_000 };
    expect(ALL.filter((t) => matchesFilter(t, f))).toEqual([T1, T4]);
  });
  it('an empty category list means every category; open ends mean no limit', () => {
    expect(ALL.filter((t) => matchesFilter(t, NO_FILTER))).toEqual(ALL);
    expect(ALL.filter((t) => matchesFilter(t, { categoryIds: [], minMinor: 50_000, maxMinor: null }))).toEqual([T1, T3]);
  });
  it('counts active filters and validates min ≤ max', () => {
    expect(activeFilterCount(NO_FILTER)).toBe(0);
    expect(activeFilterCount({ categoryIds: [FOOD], minMinor: null, maxMinor: 1 })).toBe(2);
    expect(isValidRange(100, 100)).toBe(true);
    expect(isValidRange(null, 5)).toBe(true);
    expect(isValidRange(101, 100)).toBe(false);
  });
});

describe('arrangeBreakdown', () => {
  it('date, newest first by default; same date → newer entry first', () => {
    expect(ids(arrangeBreakdown(ALL, { filter: NO_FILTER, sort: DEFAULT_SORT, pinnedIds: none }))).toEqual([T3, T2, T1, T4]);
  });
  it('date ascending reverses it, ties included', () => {
    expect(ids(arrangeBreakdown(ALL, { filter: NO_FILTER, sort: { by: 'date', dir: 'asc' }, pinnedIds: none }))).toEqual([T4, T1, T2, T3]);
  });
  it('cost both ways; same cost → newest date first', () => {
    expect(ids(arrangeBreakdown(ALL, { filter: NO_FILTER, sort: { by: 'amount', dir: 'desc' }, pinnedIds: none }))).toEqual([T3, T1, T2, T4]);
    expect(ids(arrangeBreakdown(ALL, { filter: NO_FILTER, sort: { by: 'amount', dir: 'asc' }, pinnedIds: none }))).toEqual([T2, T4, T1, T3]);
  });
  it('pins come first, each group in the chosen order, and are marked', () => {
    const rows = arrangeBreakdown(ALL, { filter: NO_FILTER, sort: DEFAULT_SORT, pinnedIds: new Set([T4.id, T1.id]) });
    expect(ids(rows)).toEqual([T1, T4, T3, T2]);
    expect(rows.map((r) => r.pinned)).toEqual([true, true, false, false]);
  });
  it('filters still apply to pinned rows', () => {
    const rows = arrangeBreakdown(ALL, { filter: { categoryIds: [BILLS], minMinor: null, maxMinor: null }, sort: DEFAULT_SORT, pinnedIds: new Set([T1.id]) });
    expect(ids(rows)).toEqual([T2]);
  });
  it('does not reorder the input array', () => {
    const input = [...ALL];
    arrangeBreakdown(input, { filter: NO_FILTER, sort: { by: 'amount', dir: 'asc' }, pinnedIds: none });
    expect(input).toEqual(ALL);
  });
});

describe('prunePins', () => {
  it('drops this month’s pins that are gone, keeps other months', () => {
    const pins = { [T1.id]: '2026-11', [T2.id]: '2026-11', x: '2026-10' };
    expect(prunePins(pins, '2026-11', [T1.id, T3.id])).toEqual({ [T1.id]: '2026-11', x: '2026-10' });
  });
  it('re-files a pin whose spend moved into this month', () => {
    expect(prunePins({ [T1.id]: '2026-10' }, '2026-11', [T1.id])).toEqual({ [T1.id]: '2026-11' });
  });
  it('returns the same object when nothing changed', () => {
    const pins = { [T1.id]: '2026-11', x: '2026-10' };
    expect(prunePins(pins, '2026-11', [T1.id])).toBe(pins);
  });
});
