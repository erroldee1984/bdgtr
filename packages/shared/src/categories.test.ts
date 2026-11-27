import { describe, expect, it } from 'vitest';

import {
  type Category,
  CATEGORY_COLOURS,
  CATEGORY_ICONS,
  categoriesForEntry,
  categoryNameKey,
  CreateCategoryInputSchema,
  UNBUDGETED_CATEGORY,
  QUICK_CATEGORY_DEFAULTS,
  UpdateCategoryInputSchema,
} from './categories.ts';
import { MAX_AMOUNT_MINOR } from './money.ts';

const OK = { name: 'Groceries', icon: 'cart', colour: '#4ADE80', defaultBudgetMinor: 1_000_000 };

describe('CreateCategoryInputSchema', () => {
  it('accepts a category, trimming the name; a ₱0 budget is fine (set later)', () => {
    expect(CreateCategoryInputSchema.parse({ ...OK, name: '  Groceries ' }).name).toBe('Groceries');
    expect(CreateCategoryInputSchema.safeParse({ ...OK, defaultBudgetMinor: 0 }).success).toBe(true);
  });

  it.each([
    ['blank name', { ...OK, name: '  ' }],
    ['name too long', { ...OK, name: 'x'.repeat(41) }],
    ['control characters', { ...OK, name: 'Food\u0007' }],
    ['unknown icon', { ...OK, icon: 'skull' }],
    ['colour not in the palette', { ...OK, colour: '#000000' }],
    ['negative budget', { ...OK, defaultBudgetMinor: -1 }],
    ['fractional centavos', { ...OK, defaultBudgetMinor: 1.5 }],
    ['budget too large', { ...OK, defaultBudgetMinor: MAX_AMOUNT_MINOR + 1 }],
    ['budget as text', { ...OK, defaultBudgetMinor: '100' }],
    ['missing icon', { name: 'X', colour: '#4ADE80', defaultBudgetMinor: 0 }],
    ['unknown field (e.g. householdId)', { ...OK, householdId: 'x' }],
    ['NoSQL operator', { ...OK, name: { $ne: null } }],
  ])('rejects %s', (_label, input) => {
    expect(CreateCategoryInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('UpdateCategoryInputSchema', () => {
  it('accepts any one field', () => {
    for (const patch of [{ name: 'Food' }, { icon: 'food' }, { colour: '#FF6B6B' }, { defaultBudgetMinor: 5 }]) {
      expect(UpdateCategoryInputSchema.safeParse(patch).success).toBe(true);
    }
  });

  it.each([
    ['empty update', {}],
    ['un-removing through an update (use restore)', { isRemoved: false }],
    ['bad icon', { icon: 'nope' }],
  ])('rejects %s', (_label, input) => {
    expect(UpdateCategoryInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('default category', () => {
  it('is Unbudgeted (owner’s decision, replacing Groceries), and a valid category', () => {
    expect(UNBUDGETED_CATEGORY).toEqual({ name: 'Unbudgeted', icon: 'dots-horizontal', colour: '#FF6B6B' });
    expect(CreateCategoryInputSchema.safeParse({ ...UNBUDGETED_CATEGORY, defaultBudgetMinor: 0 }).success).toBe(true);
  });

  it('quick-add defaults ("?" icon, neutral colour, no budget) make a valid category with any name', () => {
    expect(QUICK_CATEGORY_DEFAULTS).toEqual({ icon: 'help-circle-outline', colour: '#94A3B8', defaultBudgetMinor: 0 });
    expect(CreateCategoryInputSchema.safeParse({ name: 'Pet food', ...QUICK_CATEGORY_DEFAULTS }).success).toBe(true);
  });

  it('palette and icon lists have no duplicates', () => {
    expect(new Set(CATEGORY_COLOURS).size).toBe(CATEGORY_COLOURS.length);
    expect(new Set(CATEGORY_ICONS).size).toBe(CATEGORY_ICONS.length);
  });
});

describe('categoryNameKey', () => {
  it('ignores case and extra spaces, so "Dining  Out" and "dining out" clash', () => {
    expect(categoryNameKey('  Dining  Out ')).toBe(categoryNameKey('dining out'));
    expect(categoryNameKey('Food')).not.toBe(categoryNameKey('Foods'));
  });
});

describe('categoriesForEntry', () => {
  const c = (name: string, recentUseCount: number, isRemoved = false): Category => ({
    id: name.padEnd(24, '0').slice(0, 24).replace(/[^0-9a-f]/g, 'a'),
    name,
    icon: 'cart',
    colour: '#4ADE80',
    defaultBudgetMinor: 0,
    isRemoved,
    recentUseCount,
  });

  it('most used first, then A→Z; removed categories are not offered', () => {
    const out = categoriesForEntry([c('Zebra', 0), c('Food', 3), c('Apples', 0), c('Old', 9, true), c('Bus', 3)]);
    expect(out.map((x) => x.name)).toEqual(['Bus', 'Food', 'Apples', 'Zebra']);
  });
});
