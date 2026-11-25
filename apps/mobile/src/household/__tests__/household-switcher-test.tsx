/** Household switcher (dashboard header) and the More screen. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import MoreScreen from '@/app/(tabs)/more';
import { HouseholdSwitcher } from '@/household/household-switcher';

const mockSwitchTo = jest.fn();
let mockHousehold: { active: unknown; memberships: unknown[] };
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ ...mockHousehold, switchTo: mockSwitchTo }),
}));
const mockSignOut = jest.fn();
jest.mock('@clerk/expo', () => ({ useClerk: () => ({ signOut: mockSignOut }) }));
// The Setup check card on More has its own tests (account-status-test.tsx).
jest.mock('@/components/setup-check', () => ({ SetupCheck: () => null }));

const HOME = { householdId: 'h1', householdName: 'Home', role: 'owner' };
const PARENTS = { householdId: 'h2', householdName: 'Parents', role: 'member' };

beforeEach(() => {
  mockSwitchTo.mockClear();
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockHousehold = { active: HOME, memberships: [HOME, PARENTS] };
});

const renderSwitcher = () =>
  renderRouter(
    { index: () => <HouseholdSwitcher />, onboarding: () => <Text>Create household screen</Text> },
    { initialUrl: '/' },
  );

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
  const renderMore = () =>
    renderRouter(
      { index: MoreScreen, household: () => <Text>Household screen</Text> },
      { initialUrl: '/' },
    );

  it('opens Household & members', async () => {
    await renderMore();
    await fireEvent.press(screen.getByLabelText('Household and members'));
    await screen.findByText('Household screen');
  });

  it('Sign out signs out', async () => {
    await renderMore();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed sign-out says so (instead of failing silently) and can be retried', async () => {
    mockSignOut.mockRejectedValueOnce(new TypeError('Network request failed'));
    await renderMore();
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() =>
      expect(screen.getByText("Couldn't sign out. Check your connection and try again.")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalledTimes(2);
  });
});
