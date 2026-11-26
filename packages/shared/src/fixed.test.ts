import { describe, expect, it } from 'vitest';

import { BulkPostInputSchema, CreateFixedInputSchema, isDueOn, ordinal, UpdateFixedInputSchema } from './fixed.ts';

const CAT = 'a'.repeat(24);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('CreateFixedInputSchema', () => {
  const ok = { name: ' Rent ', categoryId: CAT, amountMinor: 1_500_000, dayOfMonth: 5, autoPostEnabled: true };
  it('accepts a normal item, trims the name, empty description → null', () => {
    expect(CreateFixedInputSchema.parse({ ...ok, description: '  ' })).toEqual({ ...ok, name: 'Rent', description: null });
  });
  it.each([
    [{ dayOfMonth: 0 }, 'Day must be 1–31'],
    [{ dayOfMonth: 32 }, 'Day must be 1–31'],
    [{ dayOfMonth: 2.5 }, 'Day must be a whole number'],
    [{ amountMinor: 0 }, 'Amount must be more than ₱0'],
    [{ name: '' }, 'Name is required'],
    [{ name: 'x'.repeat(61) }, 'Name must be 60 characters or fewer'],
    [{ categoryId: 'nope' }, 'Invalid id'],
  ])('refuses %o', (patch, message) => {
    const r = CreateFixedInputSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(message);
  });
  it('refuses unknown fields (no injecting householdId etc.)', () => {
    expect(CreateFixedInputSchema.safeParse({ ...ok, householdId: CAT }).success).toBe(false);
  });
});

describe('UpdateFixedInputSchema', () => {
  it('needs at least one field', () => {
    expect(UpdateFixedInputSchema.safeParse({}).success).toBe(false);
    expect(UpdateFixedInputSchema.safeParse({ autoPostEnabled: false }).success).toBe(true);
  });
});

describe('BulkPostInputSchema', () => {
  it('a date and items with their own clientIds', () => {
    expect(BulkPostInputSchema.safeParse({ date: '2026-11-26', items: [{ id: CAT, clientId: uuid(1) }] }).success).toBe(true);
  });
  it.each([
    [{ date: '2026-11-26', items: [] }, 'Choose at least one item'],
    [{ date: '2026-02-30', items: [{ id: CAT, clientId: uuid(1) }] }, 'Use a real date (YYYY-MM-DD)'],
    [{ date: '2026-11-26', items: [{ id: CAT, clientId: uuid(1) }, { id: CAT, clientId: uuid(2) }] }, 'Each item only once'],
    [{ date: '2026-11-26', items: [{ id: CAT, clientId: uuid(1) }, { id: 'b'.repeat(24), clientId: uuid(1) }] }, 'Each clientId only once'],
  ])('refuses %o', (input, message) => {
    const r = BulkPostInputSchema.safeParse(input);
    expect(r.error?.issues[0]?.message).toBe(message);
  });
});

describe('isDueOn', () => {
  it('posts on its day', () => {
    expect(isDueOn(5, '2026-11-05')).toBe(true);
    expect(isDueOn(5, '2026-11-06')).toBe(false);
  });
  it('days 29–31 post on the last day of a shorter month, not before', () => {
    expect(isDueOn(31, '2027-02-28')).toBe(true);
    expect(isDueOn(29, '2027-02-28')).toBe(true);
    expect(isDueOn(28, '2027-02-28')).toBe(true);
    expect(isDueOn(31, '2027-02-27')).toBe(false);
    expect(isDueOn(30, '2028-02-29')).toBe(true); // leap year
    expect(isDueOn(31, '2026-11-30')).toBe(true);
    expect(isDueOn(31, '2026-12-30')).toBe(false); // December has a 31st
  });
});

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [31, '31st'],
  ])('%i → %s', (n, s) => expect(ordinal(n)).toBe(s));
});
