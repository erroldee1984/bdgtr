/**
 * More → Household: what each role can see and do, and every failure path.
 * Real screen + real HouseholdProvider; only the network is faked.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import HouseholdScreen from '@/app/household';
import { HouseholdProvider } from '@/household/household-context';

const mockAuth = { isLoaded: true, isSignedIn: true, userId: 'user_ana', getToken: async () => 'tok' };
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/retry', () => ({ withNetworkRetry: (fn: () => Promise<unknown>) => fn() }));
jest.mock('@/lib/storage', () => ({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }));

type Role = 'owner' | 'co_owner' | 'member';
let mockRole: Role;
let mockDeleted: boolean;
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockFetchHousehold = jest.fn();
const HOUSE = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Dela Cruz', currency: 'PHP', timezone: 'Asia/Manila', defaultMonthlyBudgetMinor: 4_000_000 };
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  fetchMe: async () => ({
    user: { id: 'u1', email: 'ana@example.com' },
    memberships: mockDeleted ? [] : [{ householdId: HOUSE.id, householdName: HOUSE.name, role: mockRole }],
  }),
  fetchHousehold: (...a: unknown[]) => mockFetchHousehold(...a),
  updateHousehold: (...a: unknown[]) => mockUpdate(...a),
  deleteHousehold: (...a: unknown[]) => mockDelete(...a),
  // Members & invites sections on the same screen (tested in members-invites-test.tsx).
  fetchMembers: async () => [],
  fetchInvites: async () => [],
}));

beforeEach(() => {
  mockRole = 'owner';
  mockDeleted = false;
  mockFetchHousehold.mockReset().mockImplementation(async () => ({ ...HOUSE, role: mockRole }));
  mockUpdate.mockReset().mockImplementation(async (_t: unknown, _id: string, input: object) => ({ ...HOUSE, ...input, role: mockRole }));
  mockDelete.mockReset().mockImplementation(async () => {
    mockDeleted = true;
  });
});

async function open(role: Role = 'owner') {
  mockRole = role;
  await renderRouter(
    {
      _layout: () => (
        <HouseholdProvider>
          <Stack />
        </HouseholdProvider>
      ),
      index: () => <Text>Home screen</Text>,
      onboarding: () => <Text>Create your household</Text>,
      household: HouseholdScreen,
    },
    { initialUrl: '/household' },
  );
  await screen.findByText(/Your role:/);
}

describe('Household screen: what each role can do', () => {
  it('House Owner can edit and sees the delete section', async () => {
    await open('owner');
    expect(screen.getByText('Your role: House Owner')).toBeTruthy();
    expect(screen.getByText('Save changes')).toBeTruthy();
    expect(screen.getByLabelText('Household name to confirm')).toBeTruthy();
  });

  it('Co-Owner can edit but cannot delete the household', async () => {
    await open('co_owner');
    expect(screen.getByText('Save changes')).toBeTruthy();
    expect(screen.queryByLabelText('Household name to confirm')).toBeNull();
  });

  it('House Member sees the budget read-only: no editing, no delete', async () => {
    await open('member');
    expect(screen.getByText('₱40,000.00')).toBeTruthy();
    expect(screen.getByText('Only the House Owner or a Co-Owner can change these.')).toBeTruthy();
    expect(screen.queryByText('Save changes')).toBeNull();
    expect(screen.queryByDisplayValue('40000.00')).toBeNull();
    expect(screen.queryByLabelText('Household name to confirm')).toBeNull();
  });
});

describe('Household screen: saving', () => {
  it('saves a new name and budget in centavos', async () => {
    await open();
    await fireEvent.changeText(screen.getByDisplayValue('Dela Cruz'), 'Dela Cruz Family');
    await fireEvent.changeText(screen.getByDisplayValue('40000.00'), '45,500.50');
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
    expect(mockUpdate).toHaveBeenCalledWith(expect.any(Function), HOUSE.id, {
      name: 'Dela Cruz Family',
      defaultMonthlyBudgetMinor: 4_550_050,
    });
  });

  it.each([
    ['blank name', 'name', '   ', /Name is required/],
    ['budget of zero', 'budget', '0', /more than ₱0/],
    ['3 decimal places', 'budget', '12.345', /at most 2 decimal places/],
    ['letters', 'budget', 'abc', /Enter an amount like/],
    ['empty budget', 'budget', '', /Enter a monthly budget/],
  ])('%s: shows a specific message and does not call the server', async (_label, field, value, message) => {
    await open();
    const input = screen.getByDisplayValue(field === 'name' ? 'Dela Cruz' : '40000.00');
    await fireEvent.changeText(input, value);
    await fireEvent.press(screen.getByText('Save changes'));
    expect(screen.getByText(message)).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('a failed save says so and keeps what was typed', async () => {
    mockUpdate.mockRejectedValue(new TypeError('Network request failed'));
    await open();
    await fireEvent.changeText(screen.getByDisplayValue('40000.00'), '50000');
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(screen.getByText("Couldn't save. Check your connection and try again.")).toBeTruthy());
    expect(screen.getByDisplayValue('50000')).toBeTruthy();
    expect(screen.getByText('Save changes')).toBeTruthy(); // can try again
  });
});

describe('Household screen: deleting (House Owner)', () => {
  const confirmField = () => screen.getByLabelText('Household name to confirm');

  it('stays disabled until the exact household name is typed', async () => {
    await open();
    await fireEvent.changeText(confirmField(), 'dela cruz'); // wrong case
    await fireEvent.press(screen.getAllByText('Delete household').at(-1)!);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Your role: House Owner')).toBeTruthy();
  });

  it('deletes after the exact name is typed, then leaves the screen', async () => {
    await open();
    await fireEvent.changeText(confirmField(), '  Dela Cruz ');
    await act(async () => fireEvent.press(screen.getAllByText('Delete household').at(-1)!));
    expect(mockDelete).toHaveBeenCalledWith(expect.any(Function), HOUSE.id);
    await waitFor(() => expect(screen.queryByText(/Your role:/)).toBeNull());
  });

  it('a failed delete says so and the household stays', async () => {
    mockDelete.mockRejectedValue(new TypeError('Network request failed'));
    await open();
    await fireEvent.changeText(confirmField(), 'Dela Cruz');
    await fireEvent.press(screen.getAllByText('Delete household').at(-1)!);
    await waitFor(() => expect(screen.getByText("Couldn't delete the household. Try again.")).toBeTruthy());
    expect(screen.getByText('Your role: House Owner')).toBeTruthy();
  });
});

describe('Household screen: loading', () => {
  it('a load failure shows Try again, which recovers', async () => {
    mockFetchHousehold.mockRejectedValueOnce(new TypeError('Network request failed'));
    mockRole = 'owner';
    await renderRouter(
      {
        _layout: () => (
          <HouseholdProvider>
            <Stack />
          </HouseholdProvider>
        ),
        household: HouseholdScreen,
      },
      { initialUrl: '/household' },
    );
    await screen.findByText("Couldn't load this household.");
    await fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Your role: House Owner');
  });
});
