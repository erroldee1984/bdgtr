import { describe, expect, it } from 'vitest';

import { type Capability, can, canManageMember, isRole, type Role, ROLE_LABELS, ROLES } from './roles.ts';

// The full matrix from docs/PLAN.md §3. If a rule changes, this table changes with it.
const EXPECTED: Record<Capability, Record<Role, boolean>> = {
  view: { owner: true, co_owner: true, member: true },
  enter_transaction: { owner: true, co_owner: true, member: true },
  edit_any_transaction: { owner: true, co_owner: true, member: false },
  manage_budget_data: { owner: true, co_owner: true, member: false },
  manage_household: { owner: true, co_owner: true, member: false },
  manage_members: { owner: true, co_owner: true, member: false },
  transfer_ownership: { owner: true, co_owner: false, member: false },
  delete_household: { owner: true, co_owner: false, member: false },
};

describe('can (permission matrix)', () => {
  for (const [capability, byRole] of Object.entries(EXPECTED) as [Capability, Record<Role, boolean>][]) {
    for (const role of ROLES) {
      it(`${role} ${byRole[role] ? 'CAN' : 'cannot'} ${capability}`, () => {
        expect(can(role, capability)).toBe(byRole[role]);
      });
    }
  }
});

describe('canManageMember', () => {
  it.each([
    ['owner', 'co_owner', true],
    ['owner', 'member', true],
    ['co_owner', 'co_owner', true],
    ['co_owner', 'member', true],
    ['owner', 'owner', false], // the Owner hands over via transfer, not by being "managed"
    ['co_owner', 'owner', false], // "Co-Owner cannot remove House Owner"
    ['member', 'member', false],
    ['member', 'co_owner', false],
    ['member', 'owner', false],
  ] as const)('%s → %s: %s', (actor, target, expected) => {
    expect(canManageMember(actor, target)).toBe(expected);
  });
});

describe('roles', () => {
  it('has user-facing labels for every role', () => {
    expect(ROLE_LABELS).toEqual({ owner: 'House Owner', co_owner: 'Co-Owner', member: 'House Member' });
  });

  it.each([
    ['owner', true],
    ['co_owner', true],
    ['member', true],
    ['admin', false],
    ['OWNER', false],
    ['', false],
    [null, false],
    [{}, false],
  ])('isRole(%j) = %s', (value, expected) => {
    expect(isRole(value)).toBe(expected);
  });
});
