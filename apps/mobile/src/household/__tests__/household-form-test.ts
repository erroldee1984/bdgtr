import { validateHouseholdForm } from '../household-form';

describe('validateHouseholdForm', () => {
  it('accepts a name and a peso amount with commas, converting to centavos', () => {
    expect(validateHouseholdForm({ name: ' Dela Cruz ', budget: '40,000' })).toEqual({
      ok: true,
      input: { name: 'Dela Cruz', defaultMonthlyBudgetMinor: 4_000_000 },
    });
    expect(validateHouseholdForm({ name: 'A', budget: '1234.5' })).toMatchObject({
      ok: true,
      input: { defaultMonthlyBudgetMinor: 123_450 },
    });
  });

  it.each([
    [{ name: '', budget: '40000' }, { name: 'Name is required' }],
    [{ name: 'A', budget: '' }, { budget: 'Enter a monthly budget' }],
    [{ name: 'A', budget: 'abc' }, { budget: 'Enter an amount like 40,000 or 40000.50' }],
    [{ name: 'A', budget: '10.555' }, { budget: 'Use at most 2 decimal places' }],
    [{ name: 'A', budget: '0' }, { budget: 'Budget must be more than ₱0' }],
    [{ name: 'x'.repeat(61), budget: '1' }, { name: 'Name must be 60 characters or fewer' }],
    [{ name: '', budget: '' }, { name: 'Name is required', budget: 'Enter a monthly budget' }],
  ])('%j → errors %j', (values, errors) => {
    expect(validateHouseholdForm(values)).toEqual({ ok: false, errors });
  });
});
