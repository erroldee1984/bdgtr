import { parseRange } from '@/breakdown/filter-form';
import { orderLabel } from '@/breakdown/filter-panel';

describe('parseRange', () => {
  it('blank ends are open', () => {
    expect(parseRange({ min: '', max: '  ' })).toEqual({ ok: true, minMinor: null, maxMinor: null });
  });
  it('pesos with ₱ and commas → centavos; 0 is a real limit', () => {
    expect(parseRange({ min: '₱1,000', max: '2500.50' })).toEqual({ ok: true, minMinor: 100_000, maxMinor: 250_050 });
    expect(parseRange({ min: '0', max: '' })).toEqual({ ok: true, minMinor: 0, maxMinor: null });
  });
  it('min equal to max is fine; above it is an error on Max', () => {
    expect(parseRange({ min: '5', max: '5' }).ok).toBe(true);
    expect(parseRange({ min: '6', max: '5' })).toEqual({ ok: false, maxError: 'Max must be at least the min amount' });
  });
  it('typing mistakes are reported on the field', () => {
    expect(parseRange({ min: 'abc', max: '1.234' })).toEqual({
      ok: false,
      minError: 'Enter an amount like 5,000 or 5000.50',
      maxError: 'Use at most 2 decimal places',
    });
  });
});

describe('orderLabel', () => {
  it('words for each sort', () => {
    expect(orderLabel({ by: 'date', dir: 'desc' })).toBe('Newest first');
    expect(orderLabel({ by: 'date', dir: 'asc' })).toBe('Oldest first');
    expect(orderLabel({ by: 'amount', dir: 'desc' })).toBe('Highest first');
    expect(orderLabel({ by: 'amount', dir: 'asc' })).toBe('Lowest first');
  });
});
