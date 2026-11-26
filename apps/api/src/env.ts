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
  // Web Push (VAPID). Optional: without them browser notifications are off.
  // The private key is a secret (Vercel env var / local .env only).
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{87}$/, 'VAPID_PUBLIC_KEY must be a base64url P-256 public key').optional(),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'VAPID_PRIVATE_KEY must be a base64url P-256 private key').optional(),
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/)\S+$/, 'VAPID_SUBJECT must be a mailto: or https:// contact')
    .optional(),
  // Expo push access token: only needed if "enhanced security for push" is
  // turned on for the Expo project. A secret (Vercel env var only).
  EXPO_ACCESS_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined))
    .refine((v) => v === undefined || /^[A-Za-z0-9_-]{20,200}$/.test(v), { message: 'EXPO_ACCESS_TOKEN must be an Expo access token' }),
  // Shared with the Cloudflare Worker that runs the scheduled jobs. A secret.
  CRON_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined))
    .refine((v) => v === undefined || /^[A-Za-z0-9_-]{32,256}$/.test(v), { message: 'CRON_SECRET must be at least 32 letters, digits, - or _' }),
}).refine(
  (e) => [e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY, e.VAPID_SUBJECT].every((v) => v === undefined) ||
    [e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY, e.VAPID_SUBJECT].every((v) => v !== undefined),
  { message: 'Set all three of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none' },
);

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
