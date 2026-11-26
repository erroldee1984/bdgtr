import type { Db } from 'mongodb';

/**
 * Per-person request limits (docs/PLAN.md §10, OWASP API4). Fixed 5-minute
 * windows counted in MongoDB, because Vercel runs many short-lived instances
 * that share no memory. Far above real use (a household enters a few spends
 * a day); it stops scripted floods with a stolen session.
 */
export const RATE_WINDOW_MS = 5 * 60 * 1000;
export const MAX_WRITES_PER_WINDOW = 120;
export const MAX_READS_PER_WINDOW = 1200;
export const RATE_LIMITS = 'rateLimits';

interface RateLimitDoc {
  _id: string; // `${clerkUserId}:${windowStart}`
  reads: number;
  writes: number;
  expiresAt: Date;
}

export async function ensureRateLimitIndexes(db: Db): Promise<void> {
  await db.collection<RateLimitDoc>(RATE_LIMITS).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl' });
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Counts this request. Returns null when it's allowed, otherwise the seconds
 * until the window resets (for Retry-After). A plain number rather than a
 * tagged union: Vercel compiles without strictNullChecks, where those don't narrow.
 */
export async function takeRequest(
  db: Db,
  clerkUserId: string,
  method: string,
  now: Date,
): Promise<number | null> {
  const start = Math.floor(now.getTime() / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const write = WRITE_METHODS.has(method.toUpperCase());
  const field = write ? 'writes' : 'reads';
  const doc = await db.collection<RateLimitDoc>(RATE_LIMITS).findOneAndUpdate(
    { _id: `${clerkUserId}:${start}` },
    { $inc: { [field]: 1 }, $setOnInsert: { expiresAt: new Date(start + 2 * RATE_WINDOW_MS) } },
    { upsert: true, returnDocument: 'after' },
  );
  const count = (doc?.[field] as number | undefined) ?? 1;
  if (count <= (write ? MAX_WRITES_PER_WINDOW : MAX_READS_PER_WINDOW)) return null;
  return Math.max(1, Math.ceil((start + RATE_WINDOW_MS - now.getTime()) / 1000));
}
