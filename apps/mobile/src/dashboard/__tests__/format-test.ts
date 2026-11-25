import type { DashboardCategory } from '@bdgtr/shared';

import { greetingName, monthLabel } from '../format';
import { describeCategory } from '../spend-chart';

describe('monthLabel', () => {
  it.each([
    ['2026-11', 'November 2026'],
    ['2027-01', 'January 2027'],
  ])('%s → %s', (ym, label) => expect(monthLabel(ym)).toBe(label));
});

describe('greetingName', () => {
  it.each([
    ['Ana Dela Cruz', 'Ana'],
    ['  José  ', 'José'],
  ])('%j → %j', (name, first) => expect(greetingName(name)).toBe(first));
  it.each([null, undefined, '', '   '])('%j → null (greeting falls back to "Hi there", never an email)', (name) => {
    expect(greetingName(name)).toBeNull();
  });
});

describe('describeCategory (screen-reader text for a bar)', () => {
  const c = (spentMinor: number, budgetMinor: number): DashboardCategory => ({
    id: 'a', name: 'Food', icon: 'food', colour: '#FFB547', spentMinor, budgetMinor, isRemoved: false,
  });
  it('under budget says what is left', () => expect(describeCategory(c(25_000, 100_000))).toBe('Food: spent ₱250.00 of ₱1,000.00, ₱750.00 left'));
  it('over budget says by how much', () => expect(describeCategory(c(150_000, 100_000))).toBe('Food: spent ₱1,500.00 of ₱1,000.00, over by ₱500.00'));
  it('no budget says so', () => expect(describeCategory(c(5_000, 0))).toBe('Food: spent ₱50.00, no budget set'));
});
