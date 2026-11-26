import type { MonthBudgets } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useHousehold } from '@/household/household-context';
import { fetchBudgets } from '@/lib/api';
import { withNetworkRetry } from '@/lib/retry';

type Result = { key: string; data: MonthBudgets | null; error: unknown };

/**
 * The active household's budgets for `month`. Re-read when the screen comes
 * back into view (a default may have changed elsewhere). Saves hand back the
 * fresh numbers through `update`. Only this household and month are shown.
 */
export function useMonthBudgets(month: string) {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const householdId = active?.householdId ?? null;
  const key = `${householdId}:${month}`;
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(() => {
    if (!householdId) return () => {};
    let alive = true;
    const k = `${householdId}:${month}`;
    withNetworkRetry(() => fetchBudgets(() => getToken(), householdId, month))
      .then((data) => alive && setResult({ key: k, data, error: null }))
      .catch((error: unknown) => alive && setResult((prev) => ({ key: k, data: prev?.key === k ? prev.data : null, error })));
    return () => {
      alive = false;
    };
  }, [householdId, month, getToken]);

  useFocusEffect(load);

  const update = useCallback((data: MonthBudgets) => setResult({ key: `${householdId}:${data.month}`, data, error: null }), [householdId]);
  const current = result?.key === key ? result : null;
  return { budgets: current?.data ?? null, error: current?.error ?? null, reload: load, update, householdId };
}
