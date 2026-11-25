import { describe, expect, it } from 'vitest';

import {
  AcceptInviteInputSchema,
  ChangeRoleInputSchema,
  CreateInviteInputSchema,
  inviteUrl,
  sortMembers,
  TransferOwnershipInputSchema,
} from './members.ts';

const TOKEN = 'a'.repeat(43);

describe('CreateInviteInputSchema', () => {
  it.each(['co_owner', 'member'] as const)('accepts an invite as %s, normalising the email', (role) => {
    expect(CreateInviteInputSchema.parse({ email: '  Ana@Example.COM ', role })).toEqual({ email: 'ana@example.com', role });
  });

  it.each([
    ['inviting a House Owner (ownership is only transferred)', { email: 'a@b.co', role: 'owner' }],
    ['unknown role', { email: 'a@b.co', role: 'admin' }],
    ['missing role', { email: 'a@b.co' }],
    ['not an email', { email: 'ana', role: 'member' }],
    ['empty email', { email: '   ', role: 'member' }],
    ['overlong email', { email: `${'a'.repeat(250)}@b.co`, role: 'member' }],
    ['NoSQL operator', { email: { $ne: null }, role: 'member' }],
    ['extra field (e.g. choosing the household)', { email: 'a@b.co', role: 'member', householdId: 'x' }],
  ])('rejects %s', (_label, input) => {
    expect(CreateInviteInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('AcceptInviteInputSchema', () => {
  it('accepts a 43-character base64url token', () => {
    expect(AcceptInviteInputSchema.parse({ token: 'Ab-_' + 'x'.repeat(39) })).toBeTruthy();
  });

  it.each([
    ['too short', { token: 'a'.repeat(42) }],
    ['too long', { token: 'a'.repeat(44) }],
    ['padding/other characters', { token: `${'a'.repeat(42)}=` }],
    ['operator object', { token: { $gt: '' } }],
    ['missing', {}],
    ['extra field', { token: TOKEN, email: 'x@y.z' }],
  ])('rejects %s', (_label, input) => {
    expect(AcceptInviteInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('ChangeRoleInputSchema / TransferOwnershipInputSchema', () => {
  it('allows switching between Co-Owner and House Member only', () => {
    expect(ChangeRoleInputSchema.safeParse({ role: 'co_owner' }).success).toBe(true);
    expect(ChangeRoleInputSchema.safeParse({ role: 'member' }).success).toBe(true);
    expect(ChangeRoleInputSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('transfer needs a well-formed user id', () => {
    expect(TransferOwnershipInputSchema.safeParse({ userId: 'a'.repeat(24) }).success).toBe(true);
    for (const userId of ['', 'xyz', 'A'.repeat(24), { $ne: null }]) {
      expect(TransferOwnershipInputSchema.safeParse({ userId }).success).toBe(false);
    }
  });
});

describe('inviteUrl', () => {
  it('builds the shareable link, without double slashes', () => {
    expect(inviteUrl('https://bdgtr.erroldee.com/', TOKEN)).toBe(`https://bdgtr.erroldee.com/invite/${TOKEN}`);
  });
});

describe('sortMembers', () => {
  it('House Owner first, then Co-Owners, then House Members, each oldest first', () => {
    const m = (id: string, role: 'owner' | 'co_owner' | 'member', joinedAt: string) => ({ id, role, joinedAt });
    const sorted = sortMembers([
      m('mem-new', 'member', '2026-03-01T00:00:00.000Z'),
      m('co', 'co_owner', '2026-02-01T00:00:00.000Z'),
      m('mem-old', 'member', '2026-01-01T00:00:00.000Z'),
      m('owner', 'owner', '2026-05-01T00:00:00.000Z'), // became owner by transfer, joined later
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['owner', 'co', 'mem-old', 'mem-new']);
  });
});
