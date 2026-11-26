import type { z } from 'zod';

import { isRetryableNetworkError } from '@/lib/retry';

import { OFFLINE_SUPPORTED, vaultGet, vaultSet } from './vault';

/** Cache entry names: per signed-in person and household, so nothing crosses over. */
export function cacheName(userId: string, householdId: string, what: string): string {
  return `cache:${userId}:${householdId}:${what}`;
}

export interface Cached<T> {
  data: T;
  /** When the copy was saved, or null when it just came from the server. */
  cachedAt: string | null;
}

/**
 * Fetches from the server and keeps a copy (Android app only). Without a
 * connection it returns the last copy instead, with when it was saved. Server
 * errors (an answer, e.g. 403) are never hidden behind an old copy.
 */
export async function fetchWithCache<T>(
  name: string | null,
  fetcher: () => Promise<T>,
  schema: z.ZodType<T>,
  now: () => Date = () => new Date(),
): Promise<Cached<T>> {
  try {
    const data = await fetcher();
    if (OFFLINE_SUPPORTED && name) void vaultSet(name, { savedAt: now().toISOString(), data });
    return { data, cachedAt: null };
  } catch (err) {
    if (!OFFLINE_SUPPORTED || !name || !isRetryableNetworkError(err)) throw err;
    const stored = (await vaultGet(name)) as { savedAt?: unknown; data?: unknown } | null;
    const parsed = schema.safeParse(stored?.data);
    if (!parsed.success || typeof stored?.savedAt !== 'string') throw err;
    return { data: parsed.data, cachedAt: stored.savedAt };
  }
}
