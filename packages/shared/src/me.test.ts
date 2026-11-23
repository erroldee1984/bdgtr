import { describe, expect, it } from 'vitest';

import { MeResponseSchema } from './me';

describe('MeResponseSchema', () => {
  it('accepts a user with no households yet', () => {
    const value = { user: { id: '665f1c2e9b1d4a0012345678', email: 'ana@example.com' }, memberships: [] };
    expect(MeResponseSchema.parse(value)).toEqual(value);
  });

  it('accepts a missing email (claim not configured) and memberships with roles', () => {
    const value = {
      user: { id: 'u1', email: null },
      memberships: [{ householdId: 'h1', householdName: 'Dela Cruz', role: 'co_owner' }],
    };
    expect(MeResponseSchema.parse(value)).toEqual(value);
  });

  it.each([
    { user: { id: '', email: null }, memberships: [] },
    { user: { id: 'u1', email: 'not-an-email' }, memberships: [] },
    { user: { id: 'u1', email: null }, memberships: [{ householdId: 'h1', householdName: 'X', role: 'admin' }] },
    { user: { id: 'u1', email: null } },
  ])('rejects %j', (value) => {
    expect(MeResponseSchema.safeParse(value).success).toBe(false);
  });
});
