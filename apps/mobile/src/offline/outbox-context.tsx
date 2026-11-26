import type { Alert, CreateTransactionInput } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError, createTransaction } from '@/lib/api';
import { isRetryableNetworkError } from '@/lib/retry';
import { useToast } from '@/toast/toast';

import { loadOutbox, type OutboxItem, retryDelayMs, saveOutbox } from './outbox';
import { OFFLINE_SUPPORTED } from './vault';

/** A save that doesn't answer in this long is treated as offline and queued. */
export const SAVE_TIMEOUT_MS = 15_000;

/** No answer in time: a network-type failure (so it's retried), but the request may have arrived. */
class TimeoutError extends TypeError {
  override name = 'TimeoutError';
}

export type EditResult = 'saved' | 'sending' | 'uncertain' | 'gone';

/** Why the server refused a queued spend, in words. */
export function refusalText(err: ApiError): string {
  if (err.code === 'category_removed' || err.code === 'category_not_found') return 'Its category was removed. Discard it and enter it again with another category.';
  if (err.status === 403) return "You're no longer allowed to add spends in this household.";
  if (err.status === 404) return "This household isn't available to you any more.";
  if (err.status === 400) return "The server didn't accept it (for example, a date too far ahead).";
  return "The server didn't accept it.";
}

interface OutboxValue {
  /** This person's queued spends (all households). Empty on the website. */
  items: OutboxItem[];
  /** The last attempt to reach the server failed for lack of a connection. */
  offline: boolean;
  /** Saves a spend: straight to the server, or queued on this phone when offline. */
  saveSpend: (householdId: string, input: CreateTransactionInput) => Promise<{ queued: boolean; alerts: Alert[] }>;
  syncNow: () => void;
  /**
   * Changes a spend that's still waiting (same clientId: the server never had
   * it). Refused while it's being sent, if it may already have arrived
   * ('uncertain'), or if it's no longer waiting.
   */
  editPending: (clientId: string, input: CreateTransactionInput) => Promise<EditResult>;
  /** Screens report what their last load found: showing a saved copy means offline. */
  noteNetwork: (online: boolean) => void;
  retry: (clientId: string) => void;
  discard: (clientId: string) => void;
}

const NONE: OutboxItem[] = [];
const Ctx = createContext<OutboxValue | null>(null);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError('Request timed out')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Offline entry (docs/PLAN.md §15), Android app only. Keeps the outbox,
 * sends it oldest first when the app starts, comes back to the front, after a
 * wait when the connection failed, and on request. A refused spend moves to
 * "Needs attention"; an expired sign-in pauses sending until it's fixed.
 */
export function OutboxProvider({ children, timeoutMs = SAVE_TIMEOUT_MS }: { children: ReactNode; timeoutMs?: number }) {
  const { isSignedIn, userId, getToken } = useAuth();
  const toast = useToast();
  const [loaded, setLoaded] = useState<{ userId: string; items: OutboxItem[] } | null>(null);
  const [offline, setOffline] = useState(false);
  const user = OFFLINE_SUPPORTED && isSignedIn && userId ? userId : null;
  const itemsRef = useRef<OutboxItem[]>(NONE);
  const syncing = useRef(false);
  /** The spend being sent right now (not editable until that finishes). */
  const inFlight = useRef<string | null>(null);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const items = loaded?.userId === user ? loaded.items : NONE;
  // Read through refs so the sender doesn't restart (and reload the outbox)
  // whenever the auth helper or toasts get a new identity.
  const getTokenRef = useRef(getToken);
  const toastRef = useRef(toast);
  useEffect(() => {
    getTokenRef.current = getToken;
    toastRef.current = toast;
  }, [getToken, toast]);
  // The sender reads the latest list between awaits; writes update it straight away too.
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const write = useCallback(
    async (next: OutboxItem[]) => {
      if (!user) return;
      itemsRef.current = next;
      setLoaded({ userId: user, items: next });
      await saveOutbox(user, next);
    },
    [user],
  );

  const sync = useCallback(async () => {
    if (!user || syncing.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    syncing.current = true;
    let sent = 0;
    const alerts: Alert[] = [];
    try {
      for (;;) {
        const next = [...itemsRef.current].filter((i) => i.state === 'pending').sort((a, b) => a.savedAt.localeCompare(b.savedAt))[0];
        if (!next) break;
        inFlight.current = next.clientId;
        try {
          const res = await withTimeout(createTransaction(() => getTokenRef.current(), next.householdId, next.input), timeoutMs);
          alerts.push(...res.alerts);
          sent++;
          failures.current = 0;
          setOffline(false);
          await write(itemsRef.current.filter((i) => i.clientId !== next.clientId));
        } catch (err) {
          // Any answer from the server means the connection works (Regression, M6 offline dev:
          // a refused spend left "You're offline" showing).
          if (err instanceof ApiError) setOffline(false);
          if (err instanceof ApiError && err.status === 401) break; // signed out or expired: wait for sign-in
          if (err instanceof ApiError && err.status < 500) {
            await write(
              itemsRef.current.map((i) =>
                i.clientId === next.clientId ? { ...i, state: 'needs_attention' as const, attempts: i.attempts + 1, problem: refusalText(err) } : i,
              ),
            );
            continue;
          }
          // No connection (or the server is struggling): try again later.
          if (isRetryableNetworkError(err)) setOffline(true);
          failures.current++;
          await write(itemsRef.current.map((i) => (i.clientId === next.clientId ? { ...i, attempts: i.attempts + 1 } : i)));
          timer.current = setTimeout(() => void sync(), retryDelayMs(failures.current));
          break;
        }
      }
    } finally {
      syncing.current = false;
      inFlight.current = null;
    }
    if (sent > 0) {
      toastRef.current.show({ level: 'near', title: `${sent} ${sent === 1 ? 'spend' : 'spends'} sent`, body: 'Saved while offline, now added for everyone.' });
      for (const a of alerts) toastRef.current.show({ level: a.level, title: a.title, body: a.body });
    }
  }, [user, write, timeoutMs]);

  // Load this person's outbox, then send what's waiting.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void loadOutbox(user).then((stored) => {
      if (!alive) return;
      itemsRef.current = stored;
      setLoaded({ userId: user, items: stored });
      void sync();
    });
    return () => {
      alive = false;
    };
  }, [user, sync]);

  // Coming back to the app is a good moment to try again.
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void sync());
    return () => sub.remove();
  }, [user, sync]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const saveSpend = useCallback<OutboxValue['saveSpend']>(
    async (householdId, input) => {
      if (!user) {
        const { alerts } = await createTransaction(() => getTokenRef.current(), householdId, input);
        return { queued: false, alerts };
      }
      try {
        const { alerts } = await withTimeout(createTransaction(() => getTokenRef.current(), householdId, input), timeoutMs);
        setOffline(false);
        return { queued: false, alerts };
      } catch (err) {
        if (!isRetryableNetworkError(err)) throw err;
        const item: OutboxItem = {
          clientId: input.clientId,
          householdId,
          input,
          savedAt: new Date().toISOString(),
          attempts: 0,
          state: 'pending',
          problem: null,
          uncertain: err instanceof TimeoutError,
        };
        await write([...itemsRef.current.filter((i) => i.clientId !== input.clientId), item]);
        setOffline(true);
        failures.current++;
        if (!timer.current) timer.current = setTimeout(() => void sync(), retryDelayMs(failures.current));
        return { queued: true, alerts: [] };
      }
    },
    [user, timeoutMs, write, sync],
  );

  const retry = useCallback(
    (clientId: string) => {
      void write(itemsRef.current.map((i) => (i.clientId === clientId ? { ...i, state: 'pending' as const, problem: null } : i))).then(() => sync());
    },
    [write, sync],
  );
  const editPending = useCallback<OutboxValue['editPending']>(
    async (clientId, input) => {
      if (inFlight.current === clientId) return 'sending';
      const item = itemsRef.current.find((i) => i.clientId === clientId);
      if (!item) return 'gone';
      if (item.uncertain) return 'uncertain';
      await write(
        itemsRef.current.map((i) =>
          i.clientId === clientId ? { ...i, input: { ...input, clientId }, state: 'pending' as const, problem: null } : i,
        ),
      );
      void sync();
      return 'saved';
    },
    [write, sync],
  );
  const discard = useCallback((clientId: string) => void write(itemsRef.current.filter((i) => i.clientId !== clientId)), [write]);
  const syncNow = useCallback(() => void sync(), [sync]);
  const noteNetwork = useCallback(
    (online: boolean) => {
      if (!user) return;
      setOffline(!online);
      if (online && itemsRef.current.some((i) => i.state === 'pending')) void sync(); // back online: send what's waiting
    },
    [user, sync],
  );

  const value = useMemo(
    () => ({ items, offline, saveSpend, syncNow, editPending, noteNetwork, retry, discard }),
    [items, offline, saveSpend, syncNow, editPending, noteNetwork, retry, discard],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The outbox; outside the provider (e.g. some tests) it saves straight to the server. */
export function useOutbox(): OutboxValue {
  const { getToken } = useAuth();
  const ctx = useContext(Ctx);
  const fallback = useMemo<OutboxValue>(
    () => ({
      items: NONE,
      offline: false,
      saveSpend: async (householdId, input) => ({ queued: false, alerts: (await createTransaction(() => getToken(), householdId, input)).alerts }),
      syncNow: () => {},
      editPending: async () => 'gone' as const,
      noteNetwork: () => {},
      retry: () => {},
      discard: () => {},
    }),
    [getToken],
  );
  return ctx ?? fallback;
}
