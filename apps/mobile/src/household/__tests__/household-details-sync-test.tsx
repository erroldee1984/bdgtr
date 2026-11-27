/**
 * Regression: editing the budget under More → Household saved, but the
 * dashboard (still mounted underneath) kept showing the old budget, because
 * each screen held its own copy of the household details.
 *
 * Renders the REAL dashboard and Household screens in a stack, the way the
 * app does, and follows the user's steps.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import DashboardScreen from '@/app/(tabs)/index';
import HouseholdScreen from '@/app/household';
import { HouseholdProvider } from '@/household/household-context';

// One stable object, like Clerk's real useAuth (a new getToken each render would refetch forever).
const mockAuth = { isLoaded: true, isSignedIn: true, userId: 'user_ana', getToken: async () => 'tok' };
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/storage', () => ({
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
}));

// A tiny fake server: one household whose saved details change on PATCH.
let mockServer: { id: string; name: string; currency: 'PHP'; timezone: string; defaultMonthlyBudgetMinor: number; role: 'owner' };
const mockUpdate = jest.fn();
jest.mock('@/lib/api', () => {
  class ApiError extends Error {}
  const loadMe = async () => ({ user: { id: 'u1', email: 'ana@example.com' }, memberships: [] }); // stable, like the real hook
  return {
    ApiError,
    fetchMe: async () => ({
      user: { id: 'u1', email: 'ana@example.com' },
      memberships: [{ householdId: mockServer.id, householdName: mockServer.name, role: 'owner' }],
    }),
    useFetchMe: () => loadMe,
    fetchHousehold: async () => ({ ...mockServer }),
    updateHousehold: async (_t: unknown, _id: string, input: { name: string; defaultMonthlyBudgetMinor: number }) => {
      mockUpdate(input);
      mockServer = { ...mockServer, ...input };
      return { ...mockServer };
    },
    deleteHousehold: async () => {},
    // The dashboard reads its budget from /dashboard, which follows the saved household.
    fetchDashboard: async () => ({
      month: '2026-11',
      totalBudgetMinor: mockServer.defaultMonthlyBudgetMinor,
      spentMinor: 0,
      remainingMinor: mockServer.defaultMonthlyBudgetMinor,
      categories: [],
    }),
    // Members & invites sections on the same screen (tested in members-invites-test.tsx).
    fetchMembers: async () => [],
    fetchInvites: async () => [],
  };
});

beforeEach(() => {
  mockUpdate.mockReset();
  mockServer = {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Dela Cruz',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    defaultMonthlyBudgetMinor: 4_000_000, // ₱40,000.00
    role: 'owner',
  };
});

function renderApp() {
  return renderRouter(
    {
      _layout: () => (
        <HouseholdProvider>
          <Stack />
        </HouseholdProvider>
      ),
      index: DashboardScreen,
      household: HouseholdScreen,
    },
    { initialUrl: '/' },
  );
}

describe('household details stay in sync across screens', () => {
  it('dashboard shows the new budget after saving it on the Household screen', async () => {
    await renderApp();
    await waitFor(() => expect(screen.getByLabelText('Total budget ₱40,000.00')).toBeTruthy());

    await act(async () => router.push('/household'));
    const field = await screen.findByDisplayValue('40000.00');
    await fireEvent.changeText(field, '55000');
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
    expect(mockUpdate).toHaveBeenCalledWith({ name: 'Dela Cruz', defaultMonthlyBudgetMinor: 5_500_000 });

    await act(async () => router.back());
    await waitFor(() => expect(screen.getByLabelText('Total budget ₱55,000.00')).toBeTruthy());
    expect(screen.queryByLabelText('Total budget ₱40,000.00')).toBeNull();
  });

  it('a rejected (invalid) budget is not saved and the dashboard keeps the old one', async () => {
    await renderApp();
    await waitFor(() => expect(screen.getByLabelText('Total budget ₱40,000.00')).toBeTruthy());

    await act(async () => router.push('/household'));
    await fireEvent.changeText(await screen.findByDisplayValue('40000.00'), 'abc');
    await fireEvent.press(screen.getByText('Save changes'));
    expect(screen.getByText('Enter an amount like 40,000 or 40000.50')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();

    await act(async () => router.back());
    expect(screen.getByLabelText('Total budget ₱40,000.00')).toBeTruthy();
  });
});
