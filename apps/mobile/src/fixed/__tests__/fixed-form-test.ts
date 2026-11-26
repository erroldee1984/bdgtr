import { EMPTY_FIXED_FORM, formFromItem, scheduleText, validateFixedForm } from '@/fixed/fixed-form';

const CAT = 'a'.repeat(24);

describe('validateFixedForm', () => {
  it('valid input → the API body', () => {
    const r = validateFixedForm({ name: ' Rent ', amount: '15,000', categoryId: CAT, day: '5', autoPost: true, description: '' });
    expect(r).toEqual({ ok: true, input: { name: 'Rent', amountMinor: 1_500_000, categoryId: CAT, dayOfMonth: 5, autoPostEnabled: true, description: null } });
  });

  it('every problem at once, in words', () => {
    const r = validateFixedForm({ ...EMPTY_FIXED_FORM, day: '32' });
    expect(r).toEqual({
      ok: false,
      errors: { name: 'Name is required', amount: 'Enter an amount', category: 'Choose a category', day: 'Enter a day from 1 to 31' },
    });
  });

  it.each(['0', '', 'x', '1.5', '-1'])('day %p is refused', (day) => {
    const r = validateFixedForm({ name: 'A', amount: '1', categoryId: CAT, day, autoPost: false, description: '' });
    expect(r.ok).toBe(false);
  });

  it('amount mistakes', () => {
    const base = { name: 'A', categoryId: CAT, day: '1', autoPost: false, description: '' };
    expect(validateFixedForm({ ...base, amount: '0' })).toMatchObject({ errors: { amount: 'Amount must be more than ₱0' } });
    expect(validateFixedForm({ ...base, amount: '1.234' })).toMatchObject({ errors: { amount: 'Use at most 2 decimal places' } });
  });
});

describe('formFromItem / scheduleText', () => {
  it('round-trips an item for editing', () => {
    const item = { id: CAT, name: 'Rent', categoryId: CAT, amountMinor: 1_500_050, description: null, dayOfMonth: 31, autoPostEnabled: false, postedOn: null };
    expect(formFromItem(item)).toEqual({ name: 'Rent', amount: '15000.50', categoryId: CAT, day: '31', autoPost: false, description: '' });
  });
  it('words for the day', () => {
    expect(scheduleText(1)).toBe('Every month on the 1st');
    expect(scheduleText(22)).toBe('Every month on the 22nd');
    expect(scheduleText(30)).toBe('Every month on the 30th (or the last day of shorter months)');
  });
});
