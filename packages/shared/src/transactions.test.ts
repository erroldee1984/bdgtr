import { describe, expect, it } from 'vitest';

import { MAX_AMOUNT_MINOR } from './money.ts';
import { CreateTransactionInputSchema, isTooFarAhead, UpdateTransactionInputSchema } from './transactions.ts';

const OK = {
  clientId: '0b7c6b8e-2f4e-4c8a-9d1e-3a5b7c9d1e2f',
  date: '2026-11-25',
  categoryId: 'a'.repeat(24),
  amountMinor: 25_000,
};

describe('CreateTransactionInputSchema', () => {
  it('accepts a spend; a blank description becomes null', () => {
    expect(CreateTransactionInputSchema.parse({ ...OK, description: '   ' }).description).toBeNull();
    expect(CreateTransactionInputSchema.parse({ ...OK, description: ' Lunch\nwith Ben ' }).description).toBe('Lunch\nwith Ben');
    expect(CreateTransactionInputSchema.parse(OK).description).toBeUndefined();
  });

  it('accepts the smallest and largest amounts', () => {
    expect(CreateTransactionInputSchema.safeParse({ ...OK, amountMinor: 1 }).success).toBe(true);
    expect(CreateTransactionInputSchema.safeParse({ ...OK, amountMinor: MAX_AMOUNT_MINOR }).success).toBe(true);
  });

  it.each([
    ['missing clientId', { ...OK, clientId: undefined }],
    ['clientId not a UUID', { ...OK, clientId: '123' }],
    ['zero amount', { ...OK, amountMinor: 0 }],
    ['negative amount', { ...OK, amountMinor: -100 }],
    ['fractional centavos (3 decimals)', { ...OK, amountMinor: 12.5 }],
    ['amount as text', { ...OK, amountMinor: '250' }],
    ['amount too large', { ...OK, amountMinor: MAX_AMOUNT_MINOR + 1 }],
    ['impossible date', { ...OK, date: '2026-02-30' }],
    ['wrong date format', { ...OK, date: '25/11/2026' }],
    ['date before 2000', { ...OK, date: '1999-12-31' }],
    ['malformed category id', { ...OK, categoryId: 'food' }],
    ['description too long', { ...OK, description: 'x'.repeat(501) }],
    ['description with control characters', { ...OK, description: 'a\u0000b' }],
    ['unknown field (e.g. createdBy)', { ...OK, createdBy: 'b'.repeat(24) }],
    ['NoSQL operator', { ...OK, categoryId: { $ne: null } }],
  ])('rejects %s', (_label, input) => {
    expect(CreateTransactionInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('UpdateTransactionInputSchema', () => {
  it('accepts a partial change, and clearing the description', () => {
    expect(UpdateTransactionInputSchema.parse({ amountMinor: 5 })).toEqual({ amountMinor: 5 });
    expect(UpdateTransactionInputSchema.parse({ description: null })).toEqual({ description: null });
  });

  it.each([
    ['empty update', {}],
    ['changing clientId', { clientId: OK.clientId }],
    ['zero amount', { amountMinor: 0 }],
  ])('rejects %s', (_label, input) => {
    expect(UpdateTransactionInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('isTooFarAhead', () => {
  const now = new Date('2026-11-25T02:00:00.000Z'); // 10:00 in Manila
  it('allows up to a year ahead in Manila time', () => {
    expect(isTooFarAhead('2027-11-25', now)).toBe(false);
    expect(isTooFarAhead('2027-11-26', now)).toBe(true);
  });
  it('uses Manila, not UTC: at 23:00 UTC it is already the next day in Manila', () => {
    expect(isTooFarAhead('2027-11-26', new Date('2026-11-25T23:00:00.000Z'))).toBe(false);
  });
});
