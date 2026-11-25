import type { Dashboard } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useHousehold } from '@/household/household-context';
import { fetchDashboard } from '@/lib/api';
import { withNetworkRetry } from '@/lib/retry';

type Result = { forId: string; data: Dashboard | null; error: unknown };

/**
 * This month's dashboard for the active household. Re-read whenever the
 * screen comes back into view (after adding a spend, editing a category or
 * the budget elsewhere), so it never shows stale numbers. The previous
 * numbers stay on screen while refreshing; only those of the active household.
 */
export function useDashboard() {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const householdId = active?.householdId ?? null;
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(() => {
    if (!householdId) return () => {};
    let alive = true;
    withNetworkRetry(() => fetchDashboard(() => getToken(), householdId))
      .then((data) => alive && setResult({ forId: householdId, data, error: null }))
      .catch((error: unknown) =>
        alive && setResult((prev) => ({ forId: householdId, data: prev?.forId === householdId ? prev.data : null, error })),
      );
    return () => {
      alive = false;
    };
  }, [householdId, getToken]);

  useFocusEffect(load);

  const current = result?.forId === householdId ? result : null;
  return { dashboard: current?.data ?? null, error: current?.error ?? null, reload: load };
}
