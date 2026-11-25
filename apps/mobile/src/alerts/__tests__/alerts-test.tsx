/** Alerts tab, its unread badge, and alert toasts after adding a spend. */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { AlertsScreen, shiftMonth } from '@/alerts/alerts-screen';
import { UnreadAlertsProvider, useUnreadAlerts } from '@/alerts/unread-alerts';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: { householdId: 'h1', householdName: 'Dela Cruz', role: 'member' } }),
}));

type A = { id: string; yearMonth: string; level: 'near' | 'over'; categoryId: string | null; title: string; body: string; triggeredBy: string | null; createdAt: string; unread: boolean };
let mockAlerts: A[];
let mockLastRead = '1970-01-01T00:00:00.000Z';
let mockFail = false;
const mockRead = jest.fn();
const mockFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchAlerts: async (...a: unknown[]) => {
    mockFetch(...a);
    if (mockFail) throw new TypeError('Network request failed');
    const month = (a[2] as string | undefined) ?? '2026-11';
    const withFlags = mockAlerts.map((x) => ({ ...x, unread: x.createdAt > mockLastRead }));
    return { alerts: withFlags.filter((x) => x.yearMonth === month), unreadCount: withFlags.filter((x) => x.unread).length };
  },
  markAlertsRead: async () => {
    mockRead();
    mockLastRead = '9999-01-01T00:00:00.000Z';
  },
}));

const NOW = () => new Date('2026-11-25T02:00:00.000Z');
const alert = (id: string, level: 'near' | 'over', yearMonth = '2026-11', createdAt = '2026-11-24T05:00:00.000Z'): A => ({
  id, yearMonth, level, categoryId: 'c', title: level === 'over' ? 'Over budget · Groceries' : 'Nearly at budget · Groceries',
  body: `body ${id}`, triggeredBy: 'Mia Santos', createdAt, unread: true,
});

beforeEach(() => {
  mockFail = false;
  mockLastRead = '1970-01-01T00:00:00.000Z';
  mockRead.mockClear();
  mockFetch.mockClear();
  mockAlerts = [alert('a2', 'over', '2026-11', '2026-11-24T06:00:00.000Z'), alert('a1', 'near'), alert('old', 'near', '2026-10', '2026-10-30T01:00:00.000Z')];
});

function Badge() {
  return <Text>badge:{useUnreadAlerts().count}</Text>;
}

const open = () =>
  renderRouter(
    {
      _layout: () => (
        <UnreadAlertsProvider>
          <Badge />
          <Stack />
        </UnreadAlertsProvider>
      ),
      index: () => <Text>Home</Text>,
      alerts: () => <AlertsScreen now={NOW} />,
    },
    { initialUrl: '/' },
  );

describe('unread badge', () => {
  it('shows the unread count across months; opening Alerts clears it (marked read on the server)', async () => {
    await open();
    expect(await screen.findByText('badge:3')).toBeTruthy();
    await act(async () => router.push('/alerts'));
    expect(await screen.findByText('badge:0')).toBeTruthy();
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it('nothing unread: no request to mark read', async () => {
    mockLastRead = '9999-01-01T00:00:00.000Z';
    await open();
    await act(async () => router.push('/alerts'));
    await screen.findAllByTestId('alert-row');
    expect(mockRead).not.toHaveBeenCalled();
  });
});

describe('Alerts screen', () => {
  it("lists this month's alerts newest first with who triggered them, new ones marked", async () => {
    await open();
    await act(async () => router.push('/alerts'));
    const rows = await screen.findAllByTestId('alert-row');
    expect(rows.map((r) => within(r).getByText(/^body/).props.children)).toEqual(['body a2', 'body a1']);
    expect(within(rows[0]!).getByText('Over budget · Groceries')).toBeTruthy();
    expect(within(rows[0]!).getByText(/after a spend by Mia Santos/)).toBeTruthy();
    expect(within(rows[0]!).getByText('New')).toBeTruthy(); // still marked while you look
  });

  it('previous month via the arrow; next is disabled at the current month', async () => {
    await open();
    await act(async () => router.push('/alerts'));
    await screen.findAllByTestId('alert-row');
    expect(screen.getByLabelText('Next month')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Previous month'));
    expect(await screen.findByText('October 2026')).toBeTruthy();
    expect(await screen.findByText('body old')).toBeTruthy();
    expect(screen.queryByText('body a2')).toBeNull();
  });

  it('a month with none says so', async () => {
    mockAlerts = [];
    await open();
    await act(async () => router.push('/alerts'));
    expect(await screen.findByText('No budget alerts this month.')).toBeTruthy();
  });

  it('a load failure offers Try again, which recovers', async () => {
    mockFail = true;
    await open();
    await act(async () => router.push('/alerts'));
    await screen.findByText("Couldn't load the alerts.");
    mockFail = false;
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findAllByTestId('alert-row')).toHaveLength(2);
  });
});

describe('shiftMonth', () => {
  it.each([
    ['2026-11', -1, '2026-10'],
    ['2026-01', -1, '2025-12'],
    ['2026-12', 1, '2027-01'],
  ])('%s %+i → %s', (ym, by, out) => expect(shiftMonth(ym, by)).toBe(out));
});
