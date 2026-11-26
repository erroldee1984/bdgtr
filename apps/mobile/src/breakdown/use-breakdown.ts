import { type Category, CategorySchema, manilaDate, type PinMap, prunePins, type Transaction, TransactionSchema } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';

import { useHousehold } from '@/household/household-context';
import { deleteTransaction, fetchCategories, fetchTransactions } from '@/lib/api';
import { isCachedMonth } from '@/offline/cached';
import { useCachedLoader } from '@/offline/use-cached-loader';

import { loadPins, pinKey, savePins } from './pins';

type Loaded = { key: string; txs: Transaction[]; categories: Category[]; pins: PinMap; cachedAt: string | null; error: null };
type Failed = { key: string; error: unknown };

/**
 * One month of the active household's spends (whole, unfiltered), its
 * categories (removed ones too, so old rows keep their name) and this
 * device's pins. Re-read when the screen comes back into view. Pins for
 * spends no longer in the month are pruned on each load (docs/PLAN.md §6.8).
 */
export function useBreakdown(month: string) {
  const { getToken, userId } = useAuth();
  const { active } = useHousehold();
  const householdId = active?.householdId ?? null;
  const key = `${householdId}:${month}`;
  const storeKey = userId && householdId ? pinKey(userId, householdId) : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const loadCached = useCachedLoader();

  const load = useCallback(() => {
    if (!householdId || !storeKey) return () => {};
    let alive = true;
    const k = `${householdId}:${month}`;
    const token = () => getToken();
    // This month and last are kept on the phone for offline viewing (docs/PLAN.md §15).
    const keep = isCachedMonth(month, manilaDate(new Date()));
    Promise.all([
      loadCached(householdId, keep ? `transactions:${month}` : null, () => fetchTransactions(token, householdId, month), z.array(TransactionSchema)),
      loadCached(householdId, 'categories', () => fetchCategories(token, householdId), z.array(CategorySchema)),
      loadPins(storeKey),
    ])
      .then(async ([{ data: txs, cachedAt }, { data: categories }, stored]) => {
        const pins = prunePins(stored, month, txs.map((t) => t.id));
        if (pins !== stored) await savePins(storeKey, pins);
        if (!alive) return;
        setLoaded({ key: k, txs, categories, pins, cachedAt, error: null });
        setFailed(null);
      })
      .catch((error: unknown) => alive && setFailed({ key: k, error }));
    return () => {
      alive = false;
    };
  }, [householdId, storeKey, month, getToken, loadCached]);

  useFocusEffect(load);

  const current = loaded?.key === key ? loaded : null;

  const togglePin = useCallback(
    (tx: Transaction) => {
      if (!storeKey) return;
      setLoaded((prev) => {
        if (!prev) return prev;
        const pins = { ...prev.pins };
        if (pins[tx.id]) delete pins[tx.id];
        else pins[tx.id] = tx.yearMonth;
        void savePins(storeKey, pins);
        return { ...prev, pins };
      });
    },
    [storeKey],
  );

  /** Deletes on the server, then drops the row and its pin. Throws on failure. */
  const remove = useCallback(
    async (tx: Transaction) => {
      if (!householdId) return;
      await deleteTransaction(() => getToken(), householdId, tx.id);
      setLoaded((prev) => {
        if (!prev) return prev;
        const pins = { ...prev.pins };
        if (pins[tx.id]) {
          delete pins[tx.id];
          if (storeKey) void savePins(storeKey, pins);
        }
        return { ...prev, txs: prev.txs.filter((t) => t.id !== tx.id), pins };
      });
    },
    [householdId, storeKey, getToken],
  );

  const pinnedIds = useMemo(() => new Set(Object.keys(current?.pins ?? {})), [current?.pins]);

  return {
    transactions: current?.txs ?? null,
    categories: current?.categories ?? [],
    /** When showing the copy saved on the phone (offline): when it was saved. */
    cachedAt: current?.cachedAt ?? null,
    pinnedIds,
    error: failed?.key === key ? failed.error : null,
    reload: load,
    togglePin,
    remove,
  };
}
