/** "Create your household": the happy path and every way it can go wrong. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import OnboardingScreen from '@/app/onboarding';
import { ApiError } from '@/lib/api-error';

const mockAuth = { isLoaded: true, isSignedIn: true, userId: 'user_ana', getToken: async () => 'tok' };
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));

const mockRefresh = jest.fn(async () => {});
let mockMemberships: unknown[] = [];
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ refresh: mockRefresh, memberships: mockMemberships, state: { status: 'ready' }, active: null }),
}));

const mockCreate = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  createHousehold: (...a: unknown[]) => mockCreate(...a),
}));

beforeEach(() => {
  mockMemberships = [];
  mockRefresh.mockClear();
  mockCreate.mockReset().mockResolvedValue({ id: 'h-new', name: 'Dela Cruz', role: 'owner' });
});

async function open(url = '/onboarding') {
  await renderRouter(
    { index: () => <Text>Home screen</Text>, onboarding: OnboardingScreen },
    { initialUrl: url },
  );
}

async function fill(name: string, budget: string) {
  await fireEvent.changeText(screen.getByPlaceholderText('e.g. Dela Cruz'), name);
  await fireEvent.changeText(screen.getByPlaceholderText('40,000'), budget);
  await fireEvent.press(screen.getByText('Create household'));
}

describe('Create your household', () => {
  it('creates the household (budget in centavos), selects it and opens the app', async () => {
    await open();
    await fill('  Dela Cruz ', '40,000');
    await screen.findByText('Home screen');
    expect(mockCreate).toHaveBeenCalledWith(expect.any(Function), { name: 'Dela Cruz', defaultMonthlyBudgetMinor: 4_000_000 });
    expect(mockRefresh).toHaveBeenCalledWith('h-new');
  });

  it('first household: no Cancel (there is nowhere to go back to)', async () => {
    await open();
    expect(screen.getByText('Create your household')).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('another household: different title and a Cancel button', async () => {
    mockMemberships = [{ householdId: 'h1', householdName: 'Home', role: 'owner' }];
    await open('/onboarding?mode=new');
    expect(screen.getByText('Create another household')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('empty form: both fields explain what is missing; nothing is sent', async () => {
    await open();
    await fill('', '');
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(screen.getByText('Enter a monthly budget')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['-500', 'Enter an amount like 40,000 or 40000.50'],
    ['0', 'Budget must be more than ₱0'],
    ['1.234', 'Use at most 2 decimal places'],
    ['99999999', 'That amount is too large'],
  ])('budget %j → "%s"; nothing is sent', async (budget, message) => {
    await open();
    await fill('Dela Cruz', budget);
    expect(screen.getByText(message)).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('at the household limit: explains it and stays on the form', async () => {
    mockCreate.mockRejectedValue(new ApiError(409, 'household_limit'));
    await open();
    await fill('Dela Cruz', '40000');
    await screen.findByText("You've reached the maximum number of households.");
    expect(screen.queryByText('Home screen')).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('network failure: says so, keeps what was typed, and can be retried', async () => {
    mockCreate.mockRejectedValueOnce(new TypeError('Network request failed'));
    await open();
    await fill('Dela Cruz', '40000');
    await screen.findByText("Couldn't create the household. Check your connection and try again.");
    expect(screen.getByDisplayValue('Dela Cruz')).toBeTruthy();
    expect(screen.getByDisplayValue('40000')).toBeTruthy();

    await fireEvent.press(screen.getByText('Create household'));
    await waitFor(() => expect(screen.getByText('Home screen')).toBeTruthy());
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
