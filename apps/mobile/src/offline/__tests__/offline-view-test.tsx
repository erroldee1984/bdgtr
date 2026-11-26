/** Offline viewing (docs/PLAN.md §15): saved copies, the notice, pending totals. */
import type { Dashboard } from '@bdgtr/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { z } from 'zod';

import { isCachedMonth } from '@/offline/cached';
import { CachedNotice, savedAtText } from '@/offline/cached-notice';
import type { OutboxItem } from '@/offline/outbox';
import { OutboxProvider, useOutbox } from '@/offline/outbox-context';
import { withPending } from '@/offline/pending';
import { useCachedLoader } from '@/offline/use-cached-loader';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('crypto').randomBytes(n)) }));
const mockGetToken = async () => 't';
jest.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true, userId: 'user_a', getToken: mockGetToken }) }));
const mockToast = { show: () => {} };
jest.mock('@/toast/toast', () => ({ useToast: () => mockToast }));
jest.mock('@/lib/api', () => ({ ApiError: jest.requireActual('@/lib/api-error').ApiError, createTransaction: jest.fn() }));

beforeEach(() => AsyncStorage.clear());

describe('wording and scope', () => {
  it('"Showing data saved at …" in Manila time, today or with the date', () => {
    const now = new Date('2026-11-27T05:00:00.000Z'); // 1 PM Manila
    expect(savedAtText('2026-11-26T23:42:00.000Z', now)).toBe('Showing data saved at 7:42 AM today');
    expect(savedAtText('2026-11-25T23:42:00.000Z', now)).toBe('Showing data saved on Nov 26, 7:42 AM');
  });

  it('only this month and last month are kept on the phone', () => {
    expect(isCachedMonth('2026-11', '2026-11-27')).toBe(true);
    expect(isCachedMonth('2026-10', '2026-11-27')).toBe(true);
    expect(isCachedMonth('2026-09', '2026-11-27')).toBe(false);
    expect(isCachedMonth('2025-12', '2026-01-05')).toBe(true); // across the year
    expect(isCachedMonth('2026-12', '2026-11-27')).toBe(false);
  });

  it('no notice when the data is fresh', async () => {
    await render(<CachedNotice cachedAt={null} />);
    expect(screen.queryByTestId('cached-notice')).toBeNull();
  });
});

describe('withPending', () => {
  const dash: Dashboard = {
    month: '2026-11',
    totalBudgetMinor: 4_000_000,
    spentMinor: 1_000_000,
    remainingMinor: 3_000_000,
    categories: [
      { id: 'g', name: 'Groceries', icon: 'cart', colour: '#5A94FF', budgetMinor: 0, spentMinor: 600_000, isRemoved: false },
      { id: 'b', name: 'Bills', icon: 'flash', colour: '#4ADE80', budgetMinor: 0, spentMinor: 400_000, isRemoved: false },
    ],
  };
  const item = (amountMinor: number, extra: Partial<OutboxItem> = {}, date = '2026-11-26', categoryId = 'g'): OutboxItem => ({
    clientId: String(amountMinor),
    householdId: 'h1',
    input: { clientId: 'x', date, categoryId, amountMinor },
    savedAt: '',
    attempts: 0,
    state: 'pending',
    problem: null,
    ...extra,
  });

  it('adds this household’s pending spends in the month to the totals and their category', () => {
    const { dashboard, pendingMinor } = withPending(dash, [item(50_000), item(20_000, {}, '2026-11-02', 'b')], 'h1');
    expect(pendingMinor).toBe(70_000);
    expect(dashboard.spentMinor).toBe(1_070_000);
    expect(dashboard.remainingMinor).toBe(2_930_000);
    expect(dashboard.categories.map((c) => c.spentMinor)).toEqual([650_000, 420_000]);
  });

  it('leaves out other households, other months and refused spends', () => {
    const { dashboard, pendingMinor } = withPending(
      dash,
      [item(1, { householdId: 'h2' }), item(2, {}, '2026-10-31'), item(3, { state: 'needs_attention' })],
      'h1',
    );
    expect(pendingMinor).toBe(0);
    expect(dashboard).toBe(dash);
  });
});

describe('useCachedLoader', () => {
  const schema = z.object({ n: z.number() });
  let loader: ReturnType<typeof useCachedLoader>;
  let outbox: ReturnType<typeof useOutbox>;
  const keepLoader = (l: typeof loader, o: typeof outbox) => {
    loader = l;
    outbox = o;
  };
  function Probe() {
    const l = useCachedLoader();
    const o = useOutbox();
    useEffect(() => keepLoader(l, o));
    return <Text>{`offline:${o.offline}`}</Text>;
  }
  async function mount() {
    await render(
      <OutboxProvider>
        <Probe />
      </OutboxProvider>,
    );
    await act(async () => {});
  }

  it('online: fresh data and a saved copy; offline: the copy, with when, and the banner state says offline', async () => {
    await mount();
    expect(await loader('h1', 'dashboard', async () => ({ n: 1 }), schema)).toEqual({ data: { n: 1 }, cachedAt: null });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    let r!: Awaited<ReturnType<typeof loader>>;
    const fetcher = jest.fn(async () => Promise.reject(new TypeError('Network request failed')));
    await act(async () => void (r = await loader('h1', 'dashboard', fetcher, schema)));
    expect(r.data).toEqual({ n: 1 });
    expect(r.cachedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(screen.getByText('offline:true')).toBeTruthy();

    // Already offline: no waiting on retries; the copy comes straight away.
    fetcher.mockClear();
    await act(async () => void (r = await loader('h1', 'dashboard', fetcher, schema)));
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Back online: fresh data clears "offline".
    await act(async () => void (await loader('h1', 'dashboard', async () => ({ n: 2 }), schema)));
    expect(screen.getByText('offline:false')).toBeTruthy();
    expect(outbox.offline).toBe(false);
  });

  it('offline with no copy: the error comes through and "offline" is shown', async () => {
    await mount();
    await act(async () => outbox.noteNetwork(false));
    await expect(loader('h1', 'alerts', async () => Promise.reject(new TypeError('offline')), schema)).rejects.toThrow('offline');
  });

  it('copies are per household (another household’s copy is never shown)', async () => {
    await mount();
    await loader('h1', 'dashboard', async () => ({ n: 1 }), schema);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => outbox.noteNetwork(false));
    await expect(loader('h2', 'dashboard', async () => Promise.reject(new TypeError('offline')), schema)).rejects.toThrow('offline');
  });
});
