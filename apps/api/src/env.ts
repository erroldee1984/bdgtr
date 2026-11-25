import { z } from 'zod';

/**
 * Server configuration, validated at startup so a missing or malformed secret
 * fails fast with a clear message instead of at the first request.
 * Error messages name the variable but NEVER echo its value (it may be a secret).
 */
const EnvSchema = z.object({
  MONGODB_URI: z
    .string({ error: 'MONGODB_URI is required' })
    .min(1, 'MONGODB_URI is required')
    .refine((v) => /^mongodb(\+srv)?:\/\//.test(v), {
      message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
    })
    .refine((v) => !v.includes('<') && !v.includes('>'), {
      message: 'MONGODB_URI still contains a <placeholder> from .env.example',
    }),
  MONGODB_DB: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,63}$/, 'MONGODB_DB must be a simple database name')
    .default('bdgtr'),
  ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z.url({ protocol: /^https?$/, error: 'ALLOWED_ORIGINS must be http(s) URLs' }),
      ),
    ),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  // Clerk instance JWT public key (PEM). PUBLIC, not a secret. Optional so health
  // checks work before sign-in is configured; signed-in routes answer 503 without it.
  CLERK_JWT_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined))
    .refine((v) => v === undefined || /-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/.test(v.replace(/\\n/g, '\n')), {
      message: 'CLERK_JWT_KEY must be the PEM public key from Clerk (-----BEGIN PUBLIC KEY----- …)',
    }),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  override name = 'EnvError';
}

export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.message}`).join('\n');
    throw new EnvError(`Invalid API configuration:\n${problems}`);
  }
  return result.data;
}
