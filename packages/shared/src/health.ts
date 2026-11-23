import { z } from 'zod';

/** Response of the API's GET /health endpoint, validated by the app. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('bdgtr-api'),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Response of GET /health/ready, which also checks the database connection. */
export const ReadyResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  database: z.enum(['ok', 'unreachable']),
});

export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
