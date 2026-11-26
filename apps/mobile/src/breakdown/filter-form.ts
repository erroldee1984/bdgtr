import { isValidRange } from '@bdgtr/shared';

import { parseOptionalBudget } from '@/categories/category-form';

export interface RangeText {
  min: string;
  max: string;
}

export type RangeResult =
  | { ok: true; minMinor: number | null; maxMinor: number | null }
  | { ok: false; minError?: string; maxError?: string };

/** "" → no limit; otherwise a peso amount (₱, commas fine). Min must not exceed max. */
export function parseRange({ min, max }: RangeText): RangeResult {
  const lo = min.trim() === '' ? ({ ok: true, minor: null } as const) : parseOptionalBudget(min);
  const hi = max.trim() === '' ? ({ ok: true, minor: null } as const) : parseOptionalBudget(max);
  if (!lo.ok || !hi.ok) {
    return { ok: false, ...(lo.ok ? {} : { minError: lo.error }), ...(hi.ok ? {} : { maxError: hi.error }) };
  }
  if (!isValidRange(lo.minor, hi.minor)) return { ok: false, maxError: 'Max must be at least the min amount' };
  return { ok: true, minMinor: lo.minor, maxMinor: hi.minor };
}
