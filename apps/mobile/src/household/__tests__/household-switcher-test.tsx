/** Household switcher (dashboard header) and the More screen. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import MoreScreen from '@/app/(tabs)/more';
import { HouseholdSwitcher } from '@/household/household-switcher';

const mockSwitchTo = jest.fn();
let mockHousehold: { active: unknown; memberships: unknown[]; state?: unknown };
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ state: { status: 'loading' }, ...mockHousehold, switchTo: mockSwitchTo }),
}));
const mockSignOut = jest.fn();
const mockAuth = { getToken: async () => 't' };
jest.mock('@clerk/expo', () => ({ useClerk: () => ({ signOut: mockSignOut }), useAuth: () => mockAuth }));
const mockOrder: string[] = [];
jest.mock('@/notifications/device-push', () => ({
  forgetPushOnSignOut: async () => void mockOrder.push('forget-this-browser'),
}));
let mockUnsent: unknown[] = [];
jest.mock('@/offline/outbox-context', () => ({ useOutbox: () => ({ items: mockUnsent }) }));
const mockVaultClear = jest.fn(async () => {});
jest.mock('@/offline/vault', () => ({ vaultClear: () => mockVaultClear() }));

const HOME = { householdId: 'h1', householdName: 'Home', role: 'owner' };
const PARENTS = { householdId: 'h2', householdName: 'Parents', role: 'member' };

beforeEach(() => {
  mockSwitchTo.mockClear();
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockHousehold = { active: HOME, memberships: [HOME, PARENTS] };
});

const renderSwitcher = () =>
  renderRouter({ index: () => <HouseholdSwitcher />, onboarding: () => <Text>Create household screen</Text> }, { initialUrl: '/' });

describe('HouseholdSwitcher', () => {
  it('shows the active household and lists every household with its role, the active one checked', async () => {
    await renderSwitcher();
    await fireEvent.press(screen.getByLabelText('Household: Home. Switch household'));
    expect(screen.getByLabelText('Home, House Owner')).toBeChecked();
    expect(screen.getByLabelText('Parents, House Member')).not.toBeChecked();
  });

  it('choosing another household switches to it and closes the list', async () => {
    await renderSwitcher();
    await fireEvent.press(screen.getByLabelText('Household: Home. Switch household'));
    await fireEvent.press(screen.getByLabelText('Parents, House Member'));
    expect(mockSwitchTo).toHaveBeenCalledWith('h2');
    expect(screen.queryByLabelText('Parents, House Member')).toBeNull();
  });

  it('"Create another household" opens the create screen', async () => {
    await renderSwitcher();
    await fireEvent.press(screen.getByLabelText('Household: Home. Switch household'));
    await fireEvent.press(screen.getByText('Create another household'));
    await screen.findByText('Create household screen');
  });

  it('renders nothing when there is no active household', async () => {
    mockHousehold = { active: null, memberships: [] };
    await renderSwitcher();
    expect(screen.queryByLabelText(/Switch household/)).toBeNull();
  });
});

describe('More screen', () => {
  const renderMore = () => renderRouter({ index: MoreScreen, household: () => <Text>Household screen</Text> }, { initialUrl: '/' });

  it('says which account is signed in, just above Sign out (was in the old Setup check)', async () => {
    mockHousehold = { ...mockHousehold, state: { status: 'ready', me: { user: { id: 'u', email: 'ana@example.com' }, memberships: [] } } };
    await renderMore();
    expect(screen.getByText('Signed in as ana@example.com')).toBeTruthy();
    expect(screen.queryByText('Setup check')).toBeNull();
  });

  it('an account with no email shows no "Signed in as" line', async () => {
    mockHousehold = { ...mockHousehold, state: { status: 'ready', me: { user: { id: 'u', email: null }, memberships: [] } } };
    await renderMore();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it('opens Settings', async () => {
    await renderRouter({ index: MoreScreen, settings: () => <Text>Settings screen</Text> }, { initialUrl: '/' });
    await fireEvent.press(screen.getByLabelText('Settings'));
    await screen.findByText('Settings screen');
  });

  it('opens Budgets', async () => {
    await renderRouter({ index: MoreScreen, 'budgets/index': () => <Text>Budgets screen</Text> }, { initialUrl: '/' });
    expect(screen.getAllByText('Budgets')).toHaveLength(1); // the link, no longer a "coming later" card
    await fireEvent.press(screen.getByLabelText('Budgets'));
    await screen.findByText('Budgets screen');
  });

  it('opens Fixed transactions (no longer a "coming later" card)', async () => {
    await renderRouter({ index: MoreScreen, fixed: () => <Text>Fixed screen</Text> }, { initialUrl: '/' });
    expect(screen.queryByText('Coming in a later milestone')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Fixed transactions'));
    await screen.findByText('Fixed screen');
  });

  it('opens Household & members', async () => {
    await renderMore();
    await fireEvent.press(screen.getByLabelText('Household and members'));
    await screen.findByText('Household screen');
  });

  it("Sign out first stops this browser getting the account's notifications, then signs out", async () => {
    mockOrder.length = 0;
    mockSignOut.mockImplementation(async () => void mockOrder.push('sign-out'));
    await renderMore();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockOrder).toEqual(['forget-this-browser', 'sign-out']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Sign out forgets every pin on this device (shared computers, PLAN §6.8) and nothing else', async () => {
    await AsyncStorage.multiSet([
      ['pins:u1:h1', '{"a":"2026-11"}'],
      ['pins:u2:h2', '{"b":"2026-10"}'],
      ['other', 'kept'],
    ]);
    await renderMore();
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(await AsyncStorage.getAllKeys()).toEqual(['other']);
  });

  it('Sign out also wipes this phone’s offline copies', async () => {
    mockUnsent = [];
    mockVaultClear.mockClear();
    await renderMore();
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockVaultClear).toHaveBeenCalled();
  });

  it('spends not yet sent: warns first; Cancel keeps you signed in, "Sign out anyway" goes ahead', async () => {
    mockUnsent = [{}, {}];
    await renderMore();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(screen.getByText('2 spends haven’t been sent')).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockSignOut).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Sign out'));
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out anyway' }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    mockUnsent = [];
  });

  it('a failed sign-out says so (instead of failing silently) and can be retried', async () => {
    mockSignOut.mockRejectedValueOnce(new TypeError('Network request failed'));
    await renderMore();
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() => expect(screen.getByText("Couldn't sign out. Check your connection and try again.")).toBeTruthy());
    await fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalledTimes(2);
  });
});
