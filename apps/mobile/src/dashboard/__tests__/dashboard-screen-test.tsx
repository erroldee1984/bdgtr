/** Dashboard (docs/PLAN.md §6.2) with the real screen and a fake /dashboard. */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import DashboardScreen from '@/app/(tabs)/index';

let mockName: string | null = 'Ana Dela Cruz';
jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({
    active: { householdId: 'h1', householdName: 'Dela Cruz', role: 'member' },
    memberships: [{ householdId: 'h1', householdName: 'Dela Cruz', role: 'member' }],
    switchTo: () => {},
    state: { status: 'ready', me: { user: { id: 'u', email: 'ana@example.com', name: mockName }, memberships: [] } },
  }),
}));
jest.mock('@/lib/retry', () => ({ withNetworkRetry: (fn: () => Promise<unknown>) => fn() }));
const mockFetch = jest.fn();
jest.mock('@/lib/api', () => ({ fetchDashboard: (...a: unknown[]) => mockFetch(...a) }));

const DASH = {
  month: '2026-11',
  totalBudgetMinor: 4_000_000,
  spentMinor: 750_000,
  remainingMinor: 3_250_000,
  categories: [
    { id: 'a', name: 'Dining out', icon: 'food', colour: '#FFB547', budgetMinor: 500_000, spentMinor: 600_000, isRemoved: false },
    { id: 'b', name: 'Transport', icon: 'car', colour: '#5A94FF', budgetMinor: 200_000, spentMinor: 150_000, isRemoved: false },
    { id: 'c', name: 'Gifts', icon: 'gift', colour: '#F472B6', budgetMinor: 0, spentMinor: 0, isRemoved: false },
  ],
};

beforeEach(() => {
  mockName = 'Ana Dela Cruz';
  mockFetch.mockReset().mockResolvedValue(DASH);
});

const open = () =>
  renderRouter(
    { _layout: () => <Stack />, index: DashboardScreen, add: () => <Text>Add spend screen</Text> },
    { initialUrl: '/' },
  );

describe('Dashboard', () => {
  it('greets by first name and shows household, month, remaining, budget and spent', async () => {
    await open();
    expect(await screen.findByText('Hi, Ana')).toBeTruthy();
    expect(screen.getByText('Dela Cruz · November 2026')).toBeTruthy();
    expect(screen.getByLabelText('Remaining ₱32,500.00')).toBeTruthy();
    expect(screen.getByLabelText('Total budget ₱40,000.00')).toBeTruthy();
    expect(screen.getByLabelText('Spent ₱7,500.00')).toBeTruthy();
  });

  it('without a name: "Hi there" (never the email)', async () => {
    mockName = null;
    await open();
    expect(await screen.findByText('Hi there')).toBeTruthy();
    expect(screen.queryByText(/ana@example.com/)).toBeNull();
  });

  it('over budget: "Over by ₱X" in words with an icon, not just red', async () => {
    mockFetch.mockResolvedValue({ ...DASH, spentMinor: 4_100_050, remainingMinor: -100_050 });
    await open();
    expect(await screen.findByText('Over by ₱1,000.50')).toBeTruthy();
    expect(screen.getByLabelText('Over budget by ₱1,000.50')).toBeTruthy();
    expect(screen.queryByLabelText(/^Remaining/)).toBeNull();
  });

  it('exactly on budget (₱0 left) is not "over"', async () => {
    mockFetch.mockResolvedValue({ ...DASH, spentMinor: 4_000_000, remainingMinor: 0 });
    await open();
    expect(await screen.findByLabelText('Remaining ₱0.00')).toBeTruthy();
    expect(screen.queryByLabelText(/^Over budget by/)).toBeNull(); // the total; a category may still be over
  });

  it('bars describe each category in words, including over budget and no budget', async () => {
    await open();
    expect(await screen.findByLabelText('Dining out: spent ₱6,000.00 of ₱5,000.00, over by ₱1,000.00')).toBeTruthy();
    expect(screen.getByLabelText('Transport: spent ₱1,500.00 of ₱2,000.00, ₱500.00 left')).toBeTruthy();
    expect(screen.getByLabelText('Gifts: spent ₱0.00, no budget set')).toBeTruthy();
    expect(screen.getByText('Over by ₱1,000.00')).toBeTruthy();
  });

  it('"View as table" shows the same numbers as a table, and back', async () => {
    await open();
    await fireEvent.press(await screen.findByText('View as table'));
    expect(screen.getByText('Over ₱1,000.00')).toBeTruthy();
    expect(screen.getByText('₱500.00')).toBeTruthy(); // Transport left
    await fireEvent.press(screen.getByText('View as chart'));
    expect(screen.getByLabelText(/^Transport: spent/)).toBeTruthy();
  });

  it('Add spend opens the entry screen; coming back re-reads the numbers', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Add spend'));
    await screen.findByText('Add spend screen');
    mockFetch.mockResolvedValue({ ...DASH, spentMinor: 800_000, remainingMinor: 3_200_000 });
    await act(async () => router.back());
    expect(await screen.findByLabelText('Remaining ₱32,000.00')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('a load failure offers Try again, which recovers', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await open();
    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByLabelText('Remaining ₱32,500.00')).toBeTruthy();
  });

  it('a household with no categories yet still shows the totals', async () => {
    mockFetch.mockResolvedValue({ ...DASH, spentMinor: 0, remainingMinor: 4_000_000, categories: [] });
    await open();
    expect(await screen.findByText('No categories yet.')).toBeTruthy();
    expect(screen.getByLabelText('Remaining ₱40,000.00')).toBeTruthy();
  });
});
