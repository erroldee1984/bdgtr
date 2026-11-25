import { activeHouseholdKey, chooseActiveHousehold } from '../choose-active';

const M = (id: string) => ({ householdId: id, householdName: `H${id}`, role: 'owner' as const });

describe('chooseActiveHousehold', () => {
  it('keeps the household remembered on this device', () => {
    expect(chooseActiveHousehold([M('a'), M('b')], 'b')).toBe('b');
  });

  it('falls back to the first household when nothing is remembered', () => {
    expect(chooseActiveHousehold([M('a'), M('b')], null)).toBe('a');
  });

  it('ignores a remembered household the user no longer belongs to (removed, left or deleted)', () => {
    expect(chooseActiveHousehold([M('a')], 'gone')).toBe('a');
  });

  it('returns null when the user has no households yet (→ onboarding)', () => {
    expect(chooseActiveHousehold([], 'anything')).toBeNull();
    expect(chooseActiveHousehold([], null)).toBeNull();
  });
});

describe('activeHouseholdKey', () => {
  it('is per user and only uses characters secure storage allows', () => {
    expect(activeHouseholdKey('user_2RfWKJ')).toBe('bdgtr.activeHousehold.user_2RfWKJ');
    expect(activeHouseholdKey('weird/id:with spaces')).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(activeHouseholdKey('user_a')).not.toBe(activeHouseholdKey('user_b'));
  });
});
