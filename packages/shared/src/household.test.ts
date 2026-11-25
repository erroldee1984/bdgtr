import { describe, expect, it } from 'vitest';

import { CreateHouseholdInputSchema, UpdateHouseholdInputSchema } from './household.ts';
import { MAX_AMOUNT_MINOR } from './money.ts';

describe('CreateHouseholdInputSchema', () => {
  it('accepts a name and a budget, trimming the name', () => {
    expect(CreateHouseholdInputSchema.parse({ name: '  Dela Cruz  ', defaultMonthlyBudgetMinor: 4_000_000 })).toEqual({
      name: 'Dela Cruz',
      defaultMonthlyBudgetMinor: 4_000_000,
    });
  });

  it('accepts a zero budget (set it later) and the maximum', () => {
    expect(CreateHouseholdInputSchema.safeParse({ name: 'A', defaultMonthlyBudgetMinor: 0 }).success).toBe(true);
    expect(CreateHouseholdInputSchema.safeParse({ name: 'A', defaultMonthlyBudgetMinor: MAX_AMOUNT_MINOR }).success).toBe(true);
  });

  it.each([
    ['missing name', { defaultMonthlyBudgetMinor: 100 }],
    ['blank name', { name: '   ', defaultMonthlyBudgetMinor: 100 }],
    ['name too long', { name: 'x'.repeat(61), defaultMonthlyBudgetMinor: 100 }],
    ['control characters', { name: 'Dela\u0000Cruz', defaultMonthlyBudgetMinor: 100 }],
    ['negative budget', { name: 'A', defaultMonthlyBudgetMinor: -1 }],
    ['fractional centavos', { name: 'A', defaultMonthlyBudgetMinor: 10.5 }],
    ['budget too large', { name: 'A', defaultMonthlyBudgetMinor: MAX_AMOUNT_MINOR + 1 }],
    ['budget as string', { name: 'A', defaultMonthlyBudgetMinor: '100' }],
    ['unknown field', { name: 'A', defaultMonthlyBudgetMinor: 100, ownerId: 'someone' }],
    ['NoSQL operator', { name: { $gt: '' }, defaultMonthlyBudgetMinor: 100 }],
    ['not an object', 'Dela Cruz'],
  ])('rejects %s', (_label, value) => {
    expect(CreateHouseholdInputSchema.safeParse(value).success).toBe(false);
  });
});

describe('UpdateHouseholdInputSchema', () => {
  it.each([
    [{ name: 'New name' }],
    [{ defaultMonthlyBudgetMinor: 500 }],
    [{ name: 'Both', defaultMonthlyBudgetMinor: 0 }],
  ])('accepts %j', (value) => {
    expect(UpdateHouseholdInputSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['empty update', {}],
    ['blank name', { name: '' }],
    ['unknown field', { role: 'owner' }],
    ['changing currency', { currency: 'USD' }],
  ])('rejects %s', (_label, value) => {
    expect(UpdateHouseholdInputSchema.safeParse(value).success).toBe(false);
  });
});
