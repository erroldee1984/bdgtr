import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { HouseholdProvider, useHousehold } from '../household-context';

let mockAuth = { isLoaded: true, isSignedIn: true, userId: 'user_ana', getToken: async () => 'tok' };
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));

const mockFetchMe = jest.fn();
jest.mock('@/lib/api', () => ({ fetchMe: (...args: unknown[]) => mockFetchMe(...args) }));

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  getItem: async (k: string) => mockStore.get(k) ?? null,
  setItem: async (k: string, v: string) => void mockStore.set(k, v),
  removeItem: async (k: string) => void mockStore.delete(k),
}));

const me = (email: string, names: string[]) => ({
  user: { id: email, email },
  memberships: names.map((n, i) => ({ householdId: `${email}-${i}`, householdName: n, role: 'owner' })),
});

function Probe() {
  const { state, active, memberships, switchTo } = useHousehold();
  return (
    <>
      <Text>status:{state.status}</Text>
      <Text>active:{active?.householdName ?? 'none'}</Text>
      <Text>count:{memberships.length}</Text>
      <Text onPress={() => memberships[1] && switchTo(memberships[1].householdId)}>switch</Text>
    </>
  );
}

beforeEach(() => {
  mockStore.clear();
  mockFetchMe.mockReset();
  mockAuth = { isLoaded: true, isSignedIn: true, userId: 'user_ana', getToken: async () => 'tok' };
});

describe('HouseholdProvider', () => {
  it('loads households and remembers the switched-to household per user', async () => {
    mockFetchMe.mockResolvedValue(me('ana', ['Home', 'Parents']));
    await render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    await waitFor(() => expect(screen.getByText('active:Home')).toBeTruthy());
    await act(async () => {
      screen.getByText('switch').props.onPress();
    });
    expect(screen.getByText('active:Parents')).toBeTruthy();
    expect([...mockStore.values()]).toContain('ana-1');
  });

  it("never shows the previous user's households after switching accounts", async () => {
    mockFetchMe.mockResolvedValueOnce(me('ana', ['Ana home']));
    let resolveBen: (v: unknown) => void = () => {};
    mockFetchMe.mockReturnValueOnce(new Promise((r) => (resolveBen = r)));
    const view = await render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    await waitFor(() => expect(screen.getByText('active:Ana home')).toBeTruthy());

    mockAuth = { ...mockAuth, userId: 'user_ben' };
    await view.rerender(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    // Ben's data hasn't arrived yet: show loading, NOT Ana's household.
    expect(screen.getByText('status:loading')).toBeTruthy();
    expect(screen.getByText('active:none')).toBeTruthy();

    await act(async () => resolveBen(me('ben', ['Ben home'])));
    await waitFor(() => expect(screen.getByText('active:Ben home')).toBeTruthy());
  });

  it('is idle (no API calls) when signed out', async () => {
    mockAuth = { ...mockAuth, isSignedIn: false };
    await render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    expect(screen.getByText('status:idle')).toBeTruthy();
    expect(mockFetchMe).not.toHaveBeenCalled();
  });
});
