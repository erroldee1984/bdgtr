import type { Household } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { useCallback, useEffect, useState } from 'react';

import { fetchHousehold } from '@/lib/api';
import { withNetworkRetry } from '@/lib/retry';

import { useHousehold } from './household-context';

type Failure = { forId: string; error: unknown };

/**
 * Details (name, budget, your role) of the active household.
 *
 * The details live in HouseholdProvider, shared by every screen, so a save on
 * one screen (setHousehold) shows on all of them, including screens that stay
 * mounted in the background like the dashboard. Each screen that uses this
 * also re-reads the server when it mounts or the active household changes,
 * showing the shared copy meanwhile.
 */
export function useActiveHouseholdDetails() {
  const { getToken } = useAuth();
  const { active, details, rememberDetails } = useHousehold();
  const householdId = active?.householdId ?? null;
  const [failure, setFailure] = useState<Failure | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    withNetworkRetry(() => fetchHousehold(() => getToken(), householdId))
      .then((household) => {
        if (!alive) return;
        rememberDetails(household);
        setFailure(null);
      })
      .catch((error: unknown) => alive && setFailure({ forId: householdId, error }));
    return () => {
      alive = false;
    };
  }, [householdId, getToken, version, rememberDetails]);

  const reload = useCallback(() => {
    setFailure(null);
    setVersion((v) => v + 1);
  }, []);

  // Only ever the household that's active now (never the previous one).
  const household = householdId ? (details[householdId] ?? null) : null;
  // A failed refresh keeps showing the copy we have; an error shows only with nothing to show.
  const error = !household && failure?.forId === householdId ? failure.error : null;
  return { household, error, reload, setHousehold: rememberDetails as (household: Household) => void };
}
