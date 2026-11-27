import {
  AlertsResponseSchema,
  CategorySchema,
  DashboardSchema,
  manilaDate,
  MonthBudgetsSchema,
  TransactionSchema,
  yearMonthOf,
} from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { useHousehold } from '@/household/household-context';
import { fetchAlerts, fetchBudgets, fetchCategories, fetchDashboard, fetchTransactions } from '@/lib/api';

import { cacheName, fetchWithCache } from './cached';
import { useOutbox } from './outbox-context';
import { OFFLINE_SUPPORTED } from './vault';

/**
 * Android app: whenever the app is online, quietly saves what the offline
 * screens need for the active household, so they work offline even if they
 * weren't opened first (docs/PLAN.md §15): categories (Add spend), the
 * dashboard, this month's spends, budgets and alerts. Same copies the screens keep. Runs once
 * per household each time the connection is (re)gained. Renders nothing.
 */
export function OfflineWarmup() {
  const { userId, getToken } = useAuth();
  const { active } = useHousehold();
  const { offline } = useOutbox();
  const householdId = active?.householdId ?? null;
  const done = useRef(new Set<string>());

  useEffect(() => {
    if (offline) done.current.clear(); // warm up again once back online
  }, [offline]);

  useEffect(() => {
    if (!OFFLINE_SUPPORTED || offline || !userId || !householdId) return;
    const month = yearMonthOf(manilaDate(new Date()));
    const key = `${householdId}:${month}`;
    if (done.current.has(key)) return;
    done.current.add(key);
    const token = () => getToken();
    const keep = <T,>(what: string, fetcher: () => Promise<T>, schema: z.ZodType<T>) =>
      fetchWithCache(cacheName(userId, householdId, what), fetcher, schema).catch(() => {});
    void Promise.all([
      keep('categories', () => fetchCategories(token, householdId), z.array(CategorySchema)),
      keep(`transactions:${month}`, () => fetchTransactions(token, householdId, month), z.array(TransactionSchema)),
      keep(`budgets:${month}`, () => fetchBudgets(token, householdId, month), MonthBudgetsSchema),
      keep('dashboard', () => fetchDashboard(token, householdId), DashboardSchema),
      keep('alerts', () => fetchAlerts(token, householdId), AlertsResponseSchema),
    ]);
  }, [offline, userId, householdId, getToken]);

  return null;
}
