import type { Household } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { useCallback, useEffect, useState } from 'react';

import { fetchHousehold } from '@/lib/api';
import { withNetworkRetry } from '@/lib/retry';

import { useHousehold } from './household-context';

type Result = { forId: string; household: Household | null; error: unknown };

/** Details (name, budget, your role) of the active household, reloaded when it changes. */
export function useActiveHouseholdDetails() {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const householdId = active?.householdId ?? null;
  const [result, setResult] = useState<Result | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    withNetworkRetry(() => fetchHousehold(() => getToken(), householdId))
      .then((household) => alive && setResult({ forId: householdId, household, error: null }))
      .catch((error: unknown) => alive && setResult({ forId: householdId, household: null, error }));
    return () => {
      alive = false;
    };
  }, [householdId, getToken, version]);

  const reload = useCallback(() => {
    setResult(null);
    setVersion((v) => v + 1);
  }, []);
  const setHousehold = useCallback(
    (household: Household) => setResult({ forId: household.id, household, error: null }),
    [],
  );

  // Only show a result for the household that's active now (never the previous one).
  const current = result && result.forId === householdId ? result : null;
  return { household: current?.household ?? null, error: current?.error ?? null, reload, setHousehold };
}
