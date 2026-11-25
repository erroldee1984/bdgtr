/**
 * Regression (M1b): the dashboard kept the old budget after it was edited on
 * the Household screen. Household details are now one shared copy; these
 * tests pin that down plus the edge cases around it.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { HouseholdProvider, useHousehold } from '../household-context';
import { useActiveHouseholdDetails } from '../use-active-household';

// Stable object like Clerk's real useAuth; tests swap it to change user.
let mockAuth = { isLoaded: true, isSignedIn: true, userId: 'user_ana', getToken: async () => 'tok' };
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/retry', () => ({ withNetworkRetry: (fn: () => Promise<unknown>) => fn() }));
jest.mock('@/lib/storage', () => ({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }));

const mockFetchMe = jest.fn();
const mockFetchHousehold = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchMe: (...a: unknown[]) => mockFetchMe(...a),
  fetchHousehold: (...a: unknown[]) => mockFetchHousehold(...a),
}));

const H1 = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const H2 = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const household = (id: string, budgetMinor: number, name = 'Home') => ({
  id,
  name,
  currency: 'PHP' as const,
  timezone: 'Asia/Manila',
  defaultMonthlyBudgetMinor: budgetMinor,
  role: 'owner' as const,
});
const me = (...ids: string[]) => ({
  user: { id: 'u', email: 'ana@example.com' },
  memberships: ids.map((id, i) => ({ householdId: id, householdName: `House ${i + 1}`, role: 'owner' })),
});

/** Shows what one screen sees; `tag` tells two screens apart. */
function Details({ tag }: { tag: string }) {
  const { household: h, error, reload, setHousehold } = useActiveHouseholdDetails();
  const label = error ? 'error' : h ? `${h.id.slice(0, 2)}:${h.defaultMonthlyBudgetMinor}` : 'loading';
  return (
    <>
      <Text>
        {tag}={label}
      </Text>
      <Text onPress={() => h && setHousehold({ ...h, defaultMonthlyBudgetMinor: 999 })}>{tag}-save</Text>
      <Text onPress={reload}>{tag}-reload</Text>
    </>
  );
}

function SwitchTo({ id }: { id: string }) {
  const { switchTo } = useHousehold();
  return <Text onPress={() => switchTo(id)}>switch</Text>;
}

/** A fresh element each call, so rerender() really re-renders (as Clerk does on a user change). */
const app = () => (
  <HouseholdProvider>
    <Details tag="dashboard" />
    <Details tag="settings" />
    <SwitchTo id={H2} />
  </HouseholdProvider>
);

beforeEach(() => {
  mockAuth = { isLoaded: true, isSignedIn: true, userId: 'user_ana', getToken: async () => 'tok' };
  mockFetchMe.mockReset().mockResolvedValue(me(H1, H2));
  mockFetchHousehold.mockReset().mockImplementation(async (_t: unknown, id: string) => household(id, 100));
});

describe('useActiveHouseholdDetails (shared across screens)', () => {
  it('a save on one screen shows on every other screen at once', async () => {
    await render(app());
    await waitFor(() => expect(screen.getByText('dashboard=aa:100')).toBeTruthy());

    await act(async () => screen.getByText('settings-save').props.onPress());

    expect(screen.getByText('settings=aa:999')).toBeTruthy();
    expect(screen.getByText('dashboard=aa:999')).toBeTruthy();
  });

  it("switching household never shows the previous household's budget", async () => {
    let resolveH2: (v: unknown) => void = () => {};
    await render(app());
    await waitFor(() => expect(screen.getByText('dashboard=aa:100')).toBeTruthy());

    const pendingH2 = new Promise((r) => (resolveH2 = r)); // one answer for every screen's request
    mockFetchHousehold.mockImplementation(() => pendingH2);
    await act(async () => screen.getByText('switch').props.onPress());
    expect(screen.getByText('dashboard=loading')).toBeTruthy(); // not aa:100

    await act(async () => resolveH2(household(H2, 200)));
    expect(screen.getByText('dashboard=bb:200')).toBeTruthy();
  });

  it('a failed refresh keeps showing the details already loaded (no error flash)', async () => {
    const view = await render(
      <HouseholdProvider>
        <Details tag="dashboard" />
      </HouseholdProvider>,
    );
    await waitFor(() => expect(screen.getByText('dashboard=aa:100')).toBeTruthy());

    // Opening another screen re-reads the server; this time it fails.
    mockFetchHousehold.mockRejectedValue(new Error('offline'));
    await view.rerender(
      <HouseholdProvider>
        <Details tag="dashboard" />
        <Details tag="reopened" />
      </HouseholdProvider>,
    );
    await waitFor(() => expect(mockFetchHousehold).toHaveBeenCalledTimes(2));
    expect(screen.getByText('reopened=aa:100')).toBeTruthy();
    expect(screen.getByText('dashboard=aa:100')).toBeTruthy();
  });

  it('shows an error when nothing is loaded yet, and Try again recovers', async () => {
    mockFetchHousehold.mockRejectedValue(new Error('offline'));
    await render(app());
    await waitFor(() => expect(screen.getByText('dashboard=error')).toBeTruthy());

    mockFetchHousehold.mockImplementation(async (_t: unknown, id: string) => household(id, 300));
    await act(async () => screen.getByText('dashboard-reload').props.onPress());
    await waitFor(() => expect(screen.getByText('dashboard=aa:300')).toBeTruthy());
  });

  it("after signing in as someone else, the previous user's details are never shown", async () => {
    const view = await render(app());
    await waitFor(() => expect(screen.getByText('dashboard=aa:100')).toBeTruthy());

    // Ben belongs to the same household id (e.g. invited); his load hasn't finished.
    let resolveBen: (v: unknown) => void = () => {};
    mockFetchMe.mockImplementation(() => new Promise((r) => (resolveBen = r)));
    mockAuth = { ...mockAuth, userId: 'user_ben' };
    await view.rerender(app());
    expect(screen.getByText('dashboard=loading')).toBeTruthy();

    mockFetchHousehold.mockImplementation(async (_t: unknown, id: string) => household(id, 500));
    await act(async () => resolveBen(me(H1)));
    await waitFor(() => expect(screen.getByText('dashboard=aa:500')).toBeTruthy());
  });
});
