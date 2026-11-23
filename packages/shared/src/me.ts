import { z } from 'zod';

/** Response of GET /me: the signed-in user and the households they belong to. */
export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.email().nullable(),
  }),
  /** Filled in by M1b (households). Empty until the user creates or joins one. */
  memberships: z.array(
    z.object({
      householdId: z.string().min(1),
      householdName: z.string().min(1),
      role: z.enum(['owner', 'co_owner', 'member']),
    }),
  ),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
