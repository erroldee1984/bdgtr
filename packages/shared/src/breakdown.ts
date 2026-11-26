import type { Transaction } from './transactions.ts';

/**
 * Monthly Spend Breakdown (docs/PLAN.md §6.8). The app fetches a month whole
 * and filters, sorts and pins on the device, so these are pure functions.
 */

export interface BreakdownFilter {
  /** Empty = every category. */
  categoryIds: readonly string[];
  /** Inclusive, in centavos; null = no limit. */
  minMinor: number | null;
  maxMinor: number | null;
}

export type BreakdownSortKey = 'date' | 'amount';
export type SortDirection = 'asc' | 'desc';
export interface BreakdownSort {
  by: BreakdownSortKey;
  dir: SortDirection;
}

export const NO_FILTER: BreakdownFilter = Object.freeze({ categoryIds: [], minMinor: null, maxMinor: null });
export const DEFAULT_SORT: BreakdownSort = Object.freeze({ by: 'date', dir: 'desc' });

/** How many filters are switched on (for a "Filters (2)" label). */
export function activeFilterCount(f: BreakdownFilter): number {
  return (f.categoryIds.length > 0 ? 1 : 0) + (f.minMinor !== null || f.maxMinor !== null ? 1 : 0);
}

/** A min–max range is valid when min ≤ max (either may be open). */
export function isValidRange(minMinor: number | null, maxMinor: number | null): boolean {
  return minMinor === null || maxMinor === null || minMinor <= maxMinor;
}

/** Category AND amount range. */
export function matchesFilter(tx: Transaction, f: BreakdownFilter): boolean {
  if (f.categoryIds.length > 0 && !f.categoryIds.includes(tx.categoryId)) return false;
  if (f.minMinor !== null && tx.amountMinor < f.minMinor) return false;
  if (f.maxMinor !== null && tx.amountMinor > f.maxMinor) return false;
  return true;
}

/**
 * Ties (same date, or same amount) are broken by id, which grows with the
 * time a spend was saved: newer first when descending, older first when
 * ascending. That keeps the order stable between loads.
 */
export function compareTransactions(a: Transaction, b: Transaction, sort: BreakdownSort): number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const primary = sort.by === 'date' ? a.date.localeCompare(b.date) : a.amountMinor - b.amountMinor;
  if (primary !== 0) return sign * primary;
  if (sort.by === 'amount') {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return -byDate; // same amount: newest date first
  }
  return sign * a.id.localeCompare(b.id);
}

export interface BreakdownRow {
  tx: Transaction;
  pinned: boolean;
}

/**
 * The list as shown: filtered, then the member's own pins first (each group
 * in the chosen order). Pins are still subject to the filters.
 */
export function arrangeBreakdown(
  txs: readonly Transaction[],
  opts: { filter: BreakdownFilter; sort: BreakdownSort; pinnedIds: ReadonlySet<string> },
): BreakdownRow[] {
  const sorted = txs.filter((t) => matchesFilter(t, opts.filter)).sort((a, b) => compareTransactions(a, b, opts.sort));
  const pinned = sorted.filter((t) => opts.pinnedIds.has(t.id));
  const rest = sorted.filter((t) => !opts.pinnedIds.has(t.id));
  return [...pinned.map((tx) => ({ tx, pinned: true })), ...rest.map((tx) => ({ tx, pinned: false }))];
}

/** Pins as stored on a device: transaction id → the month it was in when pinned. */
export type PinMap = Readonly<Record<string, string>>;

/**
 * Drops pins for `month` whose transaction is no longer there (deleted, or
 * moved to another month), and re-files any pinned id found in `month`.
 * Pins for other months are untouched. Returns the same object when nothing changed.
 */
export function prunePins(pins: PinMap, month: string, presentIds: readonly string[]): PinMap {
  const present = new Set(presentIds);
  let changed = false;
  const next: Record<string, string> = {};
  for (const [id, m] of Object.entries(pins)) {
    if (present.has(id)) {
      next[id] = month;
      if (m !== month) changed = true;
    } else if (m === month) {
      changed = true;
    } else {
      next[id] = m;
    }
  }
  return changed ? next : pins;
}
