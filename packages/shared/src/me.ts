import { z } from 'zod';

import { ROLES } from './roles.ts';

/** Response of GET /me: the signed-in user and the households they belong to. */
export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.email().nullable(),
    /** Display name from the optional `name` sign-in claim; null/absent if unknown. */
    name: z.string().nullable().optional(),
  }),
  /** Filled in by M1b (households). Empty until the user creates or joins one. */
  memberships: z.array(
    z.object({
      householdId: z.string().min(1),
      householdName: z.string().min(1),
      role: z.enum(ROLES),
    }),
  ),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
