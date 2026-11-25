import { useAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { useHousehold } from '@/household/household-context';
import { fetchAlerts } from '@/lib/api';

interface UnreadAlerts {
  /** Unread alerts in the active household (0 while unknown). */
  count: number;
  refresh: () => void;
  /** After the Alerts screen marks them read. */
  clear: () => void;
}

const Ctx = createContext<UnreadAlerts>({ count: 0, refresh: () => {}, clear: () => {} });

/**
 * Unread alert count for the Alerts tab badge. Re-read whenever the tabs come
 * back into view (e.g. after adding a spend) and when the household changes;
 * only the active household's count is ever shown.
 */
export function UnreadAlertsProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const householdId = active?.householdId ?? null;
  const [state, setState] = useState<{ forId: string; count: number } | null>(null);

  const refresh = useCallback(() => {
    if (!householdId) return () => {};
    let alive = true;
    fetchAlerts(() => getToken(), householdId)
      .then((r) => alive && setState({ forId: householdId, count: r.unreadCount }))
      .catch(() => {}); // the badge is a hint; the Alerts screen shows errors
    return () => {
      alive = false;
    };
  }, [getToken, householdId]);

  useFocusEffect(refresh);

  const value = useMemo<UnreadAlerts>(
    () => ({
      count: state?.forId === householdId ? state.count : 0,
      refresh: () => void refresh(),
      clear: () => householdId && setState({ forId: householdId, count: 0 }),
    }),
    [state, householdId, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnreadAlerts(): UnreadAlerts {
  return useContext(Ctx);
}
