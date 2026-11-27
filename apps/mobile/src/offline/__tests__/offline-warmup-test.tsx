/**
 * Offline warm-up (docs/PLAN.md §15). Regression §11: Add spend offline said
 * "Couldn't load the categories" because they were only saved once Add spend
 * had been opened online.
 */
import { act, render } from '@testing-library/react-native';

import { OfflineWarmup } from '@/offline/offline-warmup';

const mockSaved: string[] = [];
jest.mock('@/offline/cached', () => ({
  ...jest.requireActual('@/offline/cached'),
  fetchWithCache: async (name: string, fetcher: () => Promise<unknown>) => {
    mockSaved.push(name);
    return { data: await fetcher(), cachedAt: null };
  },
}));
jest.mock('@/lib/api', () => ({
  fetchCategories: async () => [],
  fetchTransactions: async () => [],
  fetchBudgets: async () => ({}),
  fetchAlerts: async () => ({}),
  fetchDashboard: async () => ({}),
}));
jest.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'user_a', getToken: async () => 't' }) }));
let mockHousehold: string | null = 'h1';
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: mockHousehold ? { householdId: mockHousehold } : null }),
}));
let mockOffline = false;
jest.mock('@/offline/outbox-context', () => ({ useOutbox: () => ({ offline: mockOffline }) }));

const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format(new Date());

beforeEach(() => {
  mockSaved.length = 0;
  mockOffline = false;
  mockHousehold = 'h1';
});

it('online: saves what the offline screens need, under the names they read', async () => {
  await render(<OfflineWarmup />);
  await act(async () => {});
  const m = month();
  expect(mockSaved.sort()).toEqual(
    ['alerts', `budgets:${m}`, 'categories', 'dashboard', `transactions:${m}`].map((w) => `cache:user_a:h1:${w}`).sort(),
  );
});

it('offline: does nothing', async () => {
  mockOffline = true;
  await render(<OfflineWarmup />);
  await act(async () => {});
  expect(mockSaved).toEqual([]);
});

it('no household yet: does nothing', async () => {
  mockHousehold = null;
  await render(<OfflineWarmup />);
  await act(async () => {});
  expect(mockSaved).toEqual([]);
});

it('saves once per household, and again after coming back online', async () => {
  const r = await render(<OfflineWarmup />);
  await act(async () => {});
  await r.rerender(<OfflineWarmup />);
  await act(async () => {});
  expect(mockSaved).toHaveLength(5);
  mockOffline = true;
  await r.rerender(<OfflineWarmup />);
  mockOffline = false;
  await r.rerender(<OfflineWarmup />);
  await act(async () => {});
  expect(mockSaved).toHaveLength(10);
});
