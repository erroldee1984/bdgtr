import { describe, expect, it } from 'vitest';

import { formatPHP, MAX_AMOUNT_MINOR, parseAmountInput } from './money';

describe('formatPHP', () => {
  it.each([
    [123450, '₱1,234.50'],
    [6942000, '₱69,420.00'],
    [0, '₱0.00'],
    [5, '₱0.05'],
    [-115000, '-₱1,150.00'],
  ])('formats %i centavos as %s', (minor, expected) => {
    expect(formatPHP(minor)).toBe(expected);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    'rejects non-integer or unsafe input %s',
    (bad) => {
      expect(() => formatPHP(bad)).toThrow(RangeError);
    },
  );
});

describe('parseAmountInput', () => {
  it.each([
    ['250', 25000],
    ['1,234.5', 123450],
    ['₱ 99.99', 9999],
    ['PHP 10', 1000],
    ['0.29', 29], // classic float trap: 0.29 * 100 = 28.999999...
    ['.5', 50],
    ['12.', 1200],
    ['10000000', MAX_AMOUNT_MINOR],
  ])('parses %j as %i centavos', (input, expected) => {
    expect(parseAmountInput(input)).toEqual({ ok: true, amountMinor: expected });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'invalid'],
    ['-50', 'invalid'],
    ['1.2.3', 'invalid'],
    ['1e5', 'invalid'],
    ['12.345', 'too_many_decimals'],
    ['0', 'not_positive'],
    ['0.00', 'not_positive'],
    ['10000000.01', 'too_large'],
    ['99999999999999999999', 'too_large'],
  ])('rejects %j with %s', (input, error) => {
    expect(parseAmountInput(input)).toEqual({ ok: false, error });
  });
});
