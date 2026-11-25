import { budgetText, parseOptionalBudget, validateCategoryForm } from '../category-form';

const OK = { name: 'Pets', icon: 'paw' as const, colour: '#C084FC' as const, budget: '2,000' };

describe('parseOptionalBudget', () => {
  it.each([
    ['', 0],
    ['0', 0],
    ['0.00', 0],
    ['2,000', 200_000],
    ['1500.5', 150_050],
  ])('%j → %i centavos', (text, minor) => expect(parseOptionalBudget(text)).toEqual({ ok: true, minor }));

  it.each([
    ['abc', 'Enter an amount like 5,000 or 5000.50'],
    ['-5', 'Enter an amount like 5,000 or 5000.50'],
    ['1.234', 'Use at most 2 decimal places'],
    ['99999999', 'That amount is too large'],
  ])('%j → %j', (text, error) => expect(parseOptionalBudget(text)).toEqual({ ok: false, error }));
});

describe('validateCategoryForm', () => {
  it('builds the API input', () => {
    expect(validateCategoryForm({ ...OK, name: ' Pets ' })).toEqual({
      ok: true,
      input: { name: 'Pets', icon: 'paw', colour: '#C084FC', defaultBudgetMinor: 200_000 },
    });
  });
  it('blank name and bad budget are both reported', () => {
    expect(validateCategoryForm({ ...OK, name: ' ', budget: 'x' })).toEqual({
      ok: false,
      errors: { name: 'Name is required', budget: 'Enter an amount like 5,000 or 5000.50' },
    });
  });
});

describe('budgetText', () => {
  it('shows a budget for editing, and nothing for ₱0', () => {
    expect(budgetText(200_050)).toBe('2000.50');
    expect(budgetText(0)).toBe('');
  });
});
