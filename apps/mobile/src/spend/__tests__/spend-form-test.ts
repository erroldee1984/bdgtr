import { isoToLocalDate, localDateToIso } from '../date-convert';
import { dateLabel, quickDates, validateSpendForm } from '../spend-form';

const NOW = new Date('2026-11-25T02:00:00.000Z'); // 10:00 Manila
const CID = '0b7c6b8e-2f4e-4c8a-9d1e-3a5b7c9d1e2f';
const OK = { date: '2026-11-25', categoryId: 'a'.repeat(24), amount: '1,234.50', description: '' };

describe('quickDates', () => {
  it('today and yesterday in Manila', () => expect(quickDates(NOW)).toEqual({ today: '2026-11-25', yesterday: '2026-11-24' }));
  it('late evening UTC is already tomorrow in Manila', () => {
    expect(quickDates(new Date('2026-11-30T17:00:00.000Z'))).toEqual({ today: '2026-12-01', yesterday: '2026-11-30' });
  });
});

describe('validateSpendForm', () => {
  it('turns the form into the API input (centavos, blank description → null)', () => {
    expect(validateSpendForm(OK, CID, NOW)).toEqual({
      ok: true,
      input: { clientId: CID, date: '2026-11-25', categoryId: 'a'.repeat(24), amountMinor: 123_450, description: null },
    });
  });

  it.each([
    ['no category', { categoryId: null }, { category: 'Choose a category' }],
    ['no amount', { amount: '' }, { amount: 'Enter how much was spent' }],
    ['₱0', { amount: '0' }, { amount: 'Amount must be more than ₱0' }],
    ['letters', { amount: 'abc' }, { amount: 'Enter an amount like 250 or 1,234.50' }],
    ['3 decimals', { amount: '1.234' }, { amount: 'Use at most 2 decimal places' }],
    ['too large', { amount: '99999999' }, { amount: 'That amount is too large' }],
    ['more than a year ahead', { date: '2027-11-26' }, { date: 'Date is more than a year ahead' }],
    ['description too long', { description: 'x'.repeat(501) }, { description: 'Description must be 500 characters or fewer' }],
  ])('%s → explains it', (_label, patch, errors) => {
    expect(validateSpendForm({ ...OK, ...patch }, CID, NOW)).toEqual({ ok: false, errors });
  });

  it('several problems at once are all reported', () => {
    const r = validateSpendForm({ ...OK, categoryId: null, amount: '' }, CID, NOW);
    expect(r.ok ? {} : Object.keys(r.errors).sort()).toEqual(['amount', 'category']);
  });
});

describe('dates', () => {
  it('dateLabel reads naturally', () => expect(dateLabel('2026-11-25')).toBe('Wed, Nov 25, 2026'));
  it('ISO ↔ local Date round-trips (no time-zone drift)', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2028-02-29', '2026-12-31']) expect(localDateToIso(isoToLocalDate(iso))).toBe(iso);
  });
});
