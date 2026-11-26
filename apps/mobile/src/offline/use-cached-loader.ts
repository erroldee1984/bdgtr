import { useAuth } from '@clerk/expo';
import { useCallback, useEffect, useRef } from 'react';
import type { z } from 'zod';

import { isRetryableNetworkError, withNetworkRetry } from '@/lib/retry';

import { type Cached, cacheName, fetchWithCache } from './cached';
import { useOutbox } from './outbox-context';

/**
 * Loads a screen's data, keeping a copy on the phone for offline viewing
 * (docs/PLAN.md §15, Android app only). `what` names the copy (e.g.
 * "dashboard", "transactions:2026-11"); null means don't keep one. Already
 * offline: no retries, so the saved copy shows at once. Reports what it found
 * to the offline banner. Stable across renders (safe in effect dependencies).
 */
export function useCachedLoader() {
  const { userId } = useAuth();
  const outbox = useOutbox();
  const outboxRef = useRef(outbox);
  useEffect(() => {
    outboxRef.current = outbox;
  }, [outbox]);

  return useCallback(
    async <T>(householdId: string, what: string | null, fetcher: () => Promise<T>, schema: z.ZodType<T>): Promise<Cached<T>> => {
      const name = userId && what ? cacheName(userId, householdId, what) : null;
      const delaysMs = outboxRef.current.offline ? [] : undefined;
      try {
        const result = await fetchWithCache(name, () => withNetworkRetry(fetcher, delaysMs ? { delaysMs } : {}), schema);
        outboxRef.current.noteNetwork(result.cachedAt === null);
        return result;
      } catch (err) {
        if (isRetryableNetworkError(err)) outboxRef.current.noteNetwork(false);
        throw err;
      }
    },
    [userId],
  );
}
