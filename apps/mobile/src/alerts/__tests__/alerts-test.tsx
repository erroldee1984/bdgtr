/** Alerts tab, its unread badge, and alert toasts after adding a spend. */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { AlertsScreen } from '@/alerts/alerts-screen';
import { shiftMonth } from '@/components/month-switcher';
import { UnreadAlertsProvider, useUnreadAlerts } from '@/alerts/unread-alerts';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});
const mockSwitchTo = jest.fn();
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({
    active: { householdId: 'h1', householdName: 'Dela Cruz', role: 'member' },
    memberships: [
      { householdId: 'h1', householdName: 'Dela Cruz', role: 'member' },
      { householdId: 'h2', householdName: 'Parents', role: 'owner' },
    ],
    switchTo: mockSwitchTo,
  }),
}));

type A = { id: string; yearMonth: string; kind?: string; fixedTransactionId?: string | null; dueDate?: string | null; canAdd?: boolean; level: 'near' | 'over'; categoryId: string | null; title: string; body: string; triggeredBy: string | null; createdAt: string; unread: boolean };
let mockAlerts: A[];
let mockLastRead = '1970-01-01T00:00:00.000Z';
let mockFail = false;
const mockRead = jest.fn();
const mockFetch = jest.fn();
let mockBulk: jest.Mock;
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));
const mockToasts: unknown[] = [];
jest.mock('@/toast/toast', () => ({ useToast: () => ({ show: (t: unknown) => mockToasts.push(t) }) }));
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  bulkPostFixed: (...a: unknown[]) => mockBulk(...a),
  fetchAlerts: async (...a: unknown[]) => {
    mockFetch(...a);
    if (mockFail) throw new TypeError('Network request failed');
    const withFlags = mockAlerts.map((x) => ({ ...x, unread: x.createdAt > mockLastRead }));
    // Like the server: the last 7 days (it's 25 Nov), or one month if asked.
    const month = a[2] as string | undefined;
    const shown = month ? withFlags.filter((x) => x.yearMonth === month) : withFlags.filter((x) => x.createdAt >= '2026-11-18');
    return { alerts: shown, unreadCount: withFlags.filter((x) => x.unread).length };
  },
  markAlertsRead: async () => {
    mockRead();
    mockLastRead = '9999-01-01T00:00:00.000Z';
  },
}));

const alert = (id: string, level: 'near' | 'over', yearMonth = '2026-11', createdAt = '2026-11-24T05:00:00.000Z'): A => ({
  id, yearMonth, level, categoryId: 'c', title: level === 'over' ? 'Over budget · Groceries' : 'Nearly at budget · Groceries',
  body: `body ${id}`, triggeredBy: 'Mia Santos', createdAt, unread: true,
});

beforeEach(() => {
  mockBulk = jest.fn(async () => ({ transactions: [], alerts: [{ level: 'over', title: 'Over budget · Groceries', body: 'over' }] }));
  mockToasts.length = 0;
  mockSwitchTo.mockClear();
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
      alerts: () => <AlertsScreen />,
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

  it('fixed-transaction notices show with their own wording and no "after a spend by"', async () => {
    mockAlerts = [
      { ...alert('n1', 'near', '2026-11', '2026-11-25T23:00:00.000Z'), kind: 'fixed_added', title: 'Added automatically · Rent', body: 'body rent', triggeredBy: null },
      { ...alert('n2', 'near', '2026-11', '2026-11-25T23:00:00.000Z'), kind: 'fixed_due', title: 'Due today · Tuition', body: 'body tuition', triggeredBy: null },
    ];
    await open();
    await act(async () => router.push('/alerts'));
    const rows = await screen.findAllByTestId('alert-row');
    expect(rows.map((r) => within(r).getByText(/·/).props.children)).toEqual(['Added automatically · Rent', 'Due today · Tuition']);
    expect(screen.queryByText(/after a spend by/)).toBeNull();
  });

  describe('"Add it now" on a due-today reminder', () => {
    const due = (canAdd: boolean): A => ({
      ...alert('d1', 'near', '2026-11', '2026-11-24T23:00:00.000Z'),
      kind: 'fixed_due',
      title: 'Due today · Tuition',
      body: 'body tuition',
      triggeredBy: null,
      fixedTransactionId: 'f'.repeat(24),
      dueDate: '2026-11-25',
      canAdd,
    });
    async function openAlerts() {
      await open();
      await act(async () => router.push('/alerts'));
      await screen.findAllByTestId('alert-row');
    }

    it('adds the item as a spend on its due day, then the button goes; budget alerts show as toasts', async () => {
      mockAlerts = [due(true)];
      await openAlerts();
      await fireEvent.press(screen.getByRole('button', { name: 'Add Tuition now' }));
      expect(mockBulk).toHaveBeenCalledWith(expect.any(Function), 'h1', {
        date: '2026-11-25',
        items: [{ id: 'f'.repeat(24), clientId: expect.stringMatching(/^[0-9a-f-]{36}$/) }],
      });
      expect(await screen.findByText("Tuition added as today's spend.")).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Add Tuition now' })).toBeNull();
      expect(mockToasts).toEqual([{ level: 'over', title: 'Over budget · Groceries', body: 'over' }]);
    });

    it('no button once the day has passed or it was added (the server says canAdd: false)', async () => {
      mockAlerts = [due(false)];
      await openAlerts();
      expect(screen.getByText('Due today · Tuition')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /now$/ })).toBeNull();
    });

    it('never on other alerts, even if canAdd were set', async () => {
      mockAlerts = [{ ...due(true), kind: 'fixed_added', title: 'Added automatically · Rent' }];
      await openAlerts();
      expect(screen.queryByRole('button', { name: /now$/ })).toBeNull();
    });

    it('a failure says so, keeps the button, and a retry reuses the same clientId (no double add)', async () => {
      mockAlerts = [due(true)];
      mockBulk.mockRejectedValueOnce(new TypeError('Network request failed'));
      await openAlerts();
      await fireEvent.press(screen.getByRole('button', { name: 'Add Tuition now' }));
      expect(await screen.findByText("Couldn't add Tuition. Check your connection and try again.")).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Add Tuition now' }));
      const ids = mockBulk.mock.calls.map((c) => (c[2] as { items: { clientId: string }[] }).items[0]!.clientId);
      expect(ids[0]).toBe(ids[1]);
      expect(await screen.findByText("Tuition added as today's spend.")).toBeTruthy();
    });
  });

  it('shows the last 7 days (older alerts are deleted), with no month switcher', async () => {
    await open();
    await act(async () => router.push('/alerts'));
    await screen.findAllByTestId('alert-row');
    expect(mockFetch).toHaveBeenLastCalledWith(expect.any(Function), 'h1'); // no month: the server's last 7 days
    expect(screen.queryByText('body old')).toBeNull();
    expect(screen.queryByLabelText('Previous month')).toBeNull();
    expect(screen.getByText(/from the last 7 days/)).toBeTruthy();
  });

  it('none in the last 7 days says so', async () => {
    mockAlerts = [];
    await open();
    await act(async () => router.push('/alerts'));
    expect(await screen.findByText('No alerts in the last 7 days.')).toBeTruthy();
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

describe('opening from a notification (/alerts?household=…)', () => {
  const openAt = (url: string) =>
    renderRouter(
      { _layout: () => (<UnreadAlertsProvider><Stack /></UnreadAlertsProvider>), alerts: () => <AlertsScreen /> },
      { initialUrl: url },
    );

  it('switches to that household when you belong to it', async () => {
    await openAt('/alerts?household=h2');
    await screen.findAllByTestId('alert-row');
    expect(mockSwitchTo).toHaveBeenCalledWith('h2');
  });

  it('ignores a household you are not in, and the one already shown', async () => {
    await openAt('/alerts?household=someone-elses');
    await screen.findAllByTestId('alert-row');
    await openAt('/alerts?household=h1');
    await screen.findAllByTestId('alert-row');
    expect(mockSwitchTo).not.toHaveBeenCalled();
  });
});

describe('shiftMonth (month switcher)', () => {
  it.each([
    ['2026-11', -1, '2026-10'],
    ['2026-01', -1, '2025-12'],
    ['2026-12', 1, '2027-01'],
  ])('%s %+i → %s', (ym, by, out) => expect(shiftMonth(ym, by)).toBe(out));
});
