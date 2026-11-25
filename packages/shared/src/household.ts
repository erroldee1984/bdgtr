import { z } from 'zod';

import { MAX_AMOUNT_MINOR } from './money.ts';
import { ROLES } from './roles.ts';

/** Most households a single person can belong to (abuse guard; far above real use). */
export const MAX_HOUSEHOLDS_PER_USER = 20;
export const HOUSEHOLD_NAME_MAX = 60;

const householdName = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(HOUSEHOLD_NAME_MAX, `Name must be ${HOUSEHOLD_NAME_MAX} characters or fewer`)
  // No control characters (they'd break notifications and layouts).
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Name contains invalid characters');

const budgetMinor = z
  .number({ error: 'Budget must be a number' })
  .int('Budget must be in whole centavos')
  .min(0, 'Budget cannot be negative')
  .max(MAX_AMOUNT_MINOR, 'Budget is too large');

/** POST /households. `.strict()` rejects unknown keys (incl. `$`-operators). */
export const CreateHouseholdInputSchema = z
  .object({
    name: householdName,
    defaultMonthlyBudgetMinor: budgetMinor,
  })
  .strict();
export type CreateHouseholdInput = z.infer<typeof CreateHouseholdInputSchema>;

/** PATCH /household: change any subset, but at least one field. */
export const UpdateHouseholdInputSchema = z
  .object({
    name: householdName.optional(),
    defaultMonthlyBudgetMinor: budgetMinor.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.defaultMonthlyBudgetMinor !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateHouseholdInput = z.infer<typeof UpdateHouseholdInputSchema>;

export const HouseholdSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  currency: z.literal('PHP'),
  timezone: z.literal('Asia/Manila'),
  defaultMonthlyBudgetMinor: z.number().int().min(0),
  /** The caller's role in this household. */
  role: z.enum(ROLES),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const HouseholdResponseSchema = z.object({ household: HouseholdSchema });
export type HouseholdResponse = z.infer<typeof HouseholdResponseSchema>;

/** Validation error body the API returns (field paths + messages, never the values). */
export const ValidationErrorSchema = z.object({
  error: z.literal('invalid_input'),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
