import { type Household, type MeResponse, MeResponseSchema } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { fetchMe } from '@/lib/api';
import { withNetworkRetry } from '@/lib/retry';
import { getItem, setItem } from '@/lib/storage';
import { fetchWithCache } from '@/offline/cached';

import { activeHouseholdKey, chooseActiveHousehold } from './choose-active';

type Membership = MeResponse['memberships'][number];

type State =
  | { status: 'idle' } // signed out
  | { status: 'loading' }
  | { status: 'error'; error: unknown; forUser: string }
  | { status: 'ready'; me: MeResponse; activeId: string | null; forUser: string };

interface HouseholdContextValue {
  state: State;
  /** The household currently shown, or null if the user has none yet. */
  active: Membership | null;
  memberships: Membership[];
  /** Re-reads /me, e.g. after creating or leaving a household. */
  refresh: (preferId?: string) => Promise<void>;
  /** Switches the shown household and remembers it on this device. */
  switchTo: (householdId: string) => void;
  /**
   * Household details (budget etc.) by household id, shared by every screen.
   * One copy for the whole app, so a save on one screen shows everywhere
   * (e.g. the dashboard budget after editing it under More → Household).
   */
  details: Readonly<Record<string, Household>>;
  /** Stores fresh details (after a load or a save) for every screen to read. */
  rememberDetails: (household: Household) => void;
}

const NO_DETAILS: Readonly<Record<string, Household>> = Object.freeze({});

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

/**
 * Loads the signed-in user's households (/me) and tracks which one is active.
 * The choice is remembered per user on this device (docs/PLAN.md §3).
 */
export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [loaded, setLoaded] = useState<State>({ status: 'idle' });
  const [details, setDetails] = useState<{ forUser: string | null; byId: Record<string, Household> }>({
    forUser: null,
    byId: {},
  });

  /** Fetches /me and picks the active household. Resolves to the new state; never throws. */
  const fetchState = useCallback(
    async (forUser: string, preferId?: string): Promise<State> => {
      try {
        // The Android app keeps the last list, so an offline start still knows your
        // households (docs/PLAN.md §15). One quick retry only: offline it shouldn't wait.
        const { data: me } = await fetchWithCache(
          `cache:${forUser}:me`,
          () => withNetworkRetry(() => fetchMe(() => getToken()), { delaysMs: [1000] }),
          MeResponseSchema,
        );
        const stored = preferId ?? (await getItem(activeHouseholdKey(forUser)));
        const activeId = chooseActiveHousehold(me.memberships, stored);
        if (activeId) await setItem(activeHouseholdKey(forUser), activeId);
        return { status: 'ready', me, activeId, forUser };
      } catch (error) {
        return { status: 'error', error, forUser };
      }
    },
    [getToken],
  );

  // Initial load whenever the signed-in user changes (state is set only in the callback).
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    let alive = true;
    void fetchState(userId).then((next) => alive && setLoaded(next));
    return () => {
      alive = false;
    };
  }, [isLoaded, isSignedIn, userId, fetchState]);

  const load = useCallback(
    async (preferId?: string) => {
      if (userId) setLoaded(await fetchState(userId, preferId));
    },
    [userId, fetchState],
  );

  const switchTo = useCallback(
    (householdId: string) => {
      setLoaded((s) => {
        if (s.status !== 'ready' || !s.me.memberships.some((m) => m.householdId === householdId)) return s;
        return { ...s, activeId: householdId };
      });
      if (userId) void setItem(activeHouseholdKey(userId), householdId);
    },
    [userId],
  );

  const rememberDetails = useCallback(
    (household: Household) => {
      if (!userId) return;
      setDetails((d) => ({
        forUser: userId,
        // Another user's cached details are dropped, never mixed in.
        byId: { ...(d.forUser === userId ? d.byId : {}), [household.id]: household },
      }));
    },
    [userId],
  );

  const value = useMemo<HouseholdContextValue>(() => {
    // Results belong to the user they were loaded for: after a sign-out/sign-in as
    // someone else, the previous person's households are never shown, even briefly.
    const state: State = !isSignedIn
      ? { status: 'idle' }
      : (loaded.status === 'ready' || loaded.status === 'error') && loaded.forUser === userId
        ? loaded
        : { status: 'loading' };
    const memberships = state.status === 'ready' ? state.me.memberships : [];
    const activeId = state.status === 'ready' ? state.activeId : null;
    return {
      state,
      memberships,
      active: memberships.find((m) => m.householdId === activeId) ?? null,
      refresh: load,
      switchTo,
      details: isSignedIn && details.forUser === userId ? details.byId : NO_DETAILS,
      rememberDetails,
    };
  }, [isSignedIn, loaded, userId, load, switchTo, details, rememberDetails]);

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold must be used inside <HouseholdProvider>');
  return ctx;
}
