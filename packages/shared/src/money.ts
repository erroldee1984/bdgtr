/**
 * Money helpers. All amounts are stored and computed as integer centavos
 * ("minor units", ₱1.00 = 100) to avoid floating-point rounding errors.
 * See docs/PLAN.md §4.
 */

export const CURRENCY = 'PHP' as const;
export const LOCALE = 'en-PH' as const;

/** Largest amount accepted for a single transaction or budget: ₱10,000,000.00 */
export const MAX_AMOUNT_MINOR = 1_000_000_000;

const formatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats centavos as pesos, e.g. 123450 → "₱1,234.50", -115000 → "-₱1,150.00". */
export function formatPHP(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amountMinor must be a safe integer, got ${amountMinor}`);
  }
  return formatter.format(amountMinor / 100);
}

export type ParseAmountResult =
  | { ok: true; amountMinor: number }
  | { ok: false; error: 'empty' | 'invalid' | 'too_many_decimals' | 'not_positive' | 'too_large' };

/**
 * Parses what a user typed into an amount field ("1,234.5", "₱ 99", "250")
 * into centavos. Only positive amounts with at most 2 decimal places are valid.
 */
export function parseAmountInput(input: string): ParseAmountResult {
  const cleaned = input.replace(/[₱,\s]/g, '').replace(/^PHP/i, '');
  if (cleaned === '') return { ok: false, error: 'empty' };
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(cleaned)) return { ok: false, error: 'invalid' };

  const [whole = '0', fraction = ''] = cleaned.split('.');
  if (fraction.length > 2) return { ok: false, error: 'too_many_decimals' };

  // Build the integer from strings so 0.29 never becomes 28.999999 centavos.
  const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amountMinor) || amountMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: 'too_large' };
  }
  if (amountMinor <= 0) return { ok: false, error: 'not_positive' };
  return { ok: true, amountMinor };
}
