import { z } from 'zod';

import { MAX_AMOUNT_MINOR } from './money.ts';

/**
 * Categories (docs/PLAN.md §4, §6.4). Icons and colours come from fixed lists
 * so the server can validate them and every colour is legible on the app's
 * dark surfaces (checked in the app's contrast tests).
 */

export const CATEGORY_NAME_MAX = 40;
/** Abuse guard: categories (incl. removed ones) per household. */
export const MAX_CATEGORIES = 100;

/** Material Community Icons names (the icon set the app ships). */
export const CATEGORY_ICONS = [
  'cart',
  'food',
  'coffee',
  'car',
  'bus',
  'gas-station',
  'home',
  'flash',
  'water',
  'wifi',
  'cellphone',
  'medical-bag',
  'pill',
  'school',
  'baby-carriage',
  'paw',
  'tshirt-crew',
  'movie',
  'gamepad-variant',
  'gift',
  'airplane',
  'hammer-wrench',
  'piggy-bank',
  'cash',
  'credit-card',
  'hand-heart',
  'dots-horizontal',
  'help-circle-outline',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** Chart/chip colours; each is at least 3:1 against the app's surfaces (WCAG 1.4.11). */
export const CATEGORY_COLOURS = [
  '#5A94FF',
  '#4ADE80',
  '#FFB547',
  '#FF6B6B',
  '#C084FC',
  '#2DD4BF',
  '#F472B6',
  '#A3E635',
  '#FB923C',
  '#94A3B8',
] as const;
export type CategoryColour = (typeof CATEGORY_COLOURS)[number];

/**
 * Every household always has at least one active category. New households
 * start with this one, and it's added automatically to any household that has
 * none (e.g. one created before categories existed).
 */
export const DEFAULT_CATEGORY: { name: string; icon: CategoryIcon; colour: CategoryColour } = {
  name: 'Groceries',
  icon: 'cart',
  colour: '#4ADE80',
};

/**
 * "Quick add" from the Add spend screen asks only for a name; the rest starts
 * as a "?" icon, a neutral colour and no budget, to be set later in Categories.
 */
export const QUICK_CATEGORY_DEFAULTS: { icon: CategoryIcon; colour: CategoryColour; defaultBudgetMinor: number } = {
  icon: 'help-circle-outline',
  colour: '#94A3B8',
  defaultBudgetMinor: 0,
};

const categoryName = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(CATEGORY_NAME_MAX, `Name must be ${CATEGORY_NAME_MAX} characters or fewer`)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Name contains invalid characters');

const budgetMinor = z
  .number({ error: 'Budget must be a number' })
  .int('Budget must be in whole centavos')
  .min(0, 'Budget cannot be negative')
  .max(MAX_AMOUNT_MINOR, 'Budget is too large');

const icon = z.enum(CATEGORY_ICONS, { error: 'Choose an icon from the list' });
const colour = z.enum(CATEGORY_COLOURS, { error: 'Choose a colour from the list' });

export const CreateCategoryInputSchema = z
  .object({ name: categoryName, icon, colour, defaultBudgetMinor: budgetMinor })
  .strict();
export type CreateCategoryInput = z.infer<typeof CreateCategoryInputSchema>;

export const UpdateCategoryInputSchema = z
  .object({
    name: categoryName.optional(),
    icon: icon.optional(),
    colour: colour.optional(),
    defaultBudgetMinor: budgetMinor.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInputSchema>;

export const CategorySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{24}$/),
  name: z.string().min(1),
  icon: z.enum(CATEGORY_ICONS),
  colour: z.enum(CATEGORY_COLOURS),
  defaultBudgetMinor: z.number().int().min(0),
  isRemoved: z.boolean(),
  /** Transactions in the last 90 days; the entry screen lists most-used first. */
  recentUseCount: z.number().int().min(0),
});
export type Category = z.infer<typeof CategorySchema>;

export const CategoriesResponseSchema = z.object({ categories: z.array(CategorySchema) });
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;
export const CategoryResponseSchema = z.object({ category: CategorySchema });
export type CategoryResponse = z.infer<typeof CategoryResponseSchema>;

/** Case- and space-insensitive key for "is this name taken?". */
export function categoryNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-PH');
}

/** Order for the entry screen: active only, most used first, then A→Z. */
export function categoriesForEntry(categories: Category[]): Category[] {
  return categories
    .filter((c) => !c.isRemoved)
    .sort((a, b) => b.recentUseCount - a.recentUseCount || a.name.localeCompare(b.name, 'en-PH'));
}
