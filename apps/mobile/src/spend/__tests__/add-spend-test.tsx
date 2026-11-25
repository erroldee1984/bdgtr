/** Add spend (docs/PLAN.md §6.3): the real form against a fake server. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { ApiError } from '@/lib/api-error';
import { AddSpendForm } from '@/spend/add-spend-form';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});
let mockRole = 'member';
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: { householdId: 'h1', householdName: 'Home', role: mockRole } }),
}));
jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));
const mockShow = jest.fn();
jest.mock('@/toast/toast', () => ({ useToast: () => ({ show: mockShow }) }));
const mockCategories = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  fetchCategories: (...a: unknown[]) => mockCategories(...a),
  createTransaction: (...a: unknown[]) => mockCreate(...a),
}));

const cat = (id: string, name: string, recentUseCount: number, isRemoved = false) => ({
  id: id.repeat(24), name, icon: 'cart', colour: '#4ADE80', defaultBudgetMinor: 0, isRemoved, recentUseCount,
});
const NOW = new Date('2026-11-25T02:00:00.000Z'); // Wed 25 Nov, 10:00 Manila
const now = () => NOW;

beforeEach(() => {
  mockRole = 'member';
  mockCategories.mockReset().mockResolvedValue([cat('a', 'Groceries', 1), cat('b', 'Transport', 5), cat('c', 'Old', 9, true), cat('d', 'Bills', 1)]);
  mockCreate.mockReset().mockResolvedValue({ transaction: {}, alerts: [] });
  mockShow.mockClear();
  jest.mocked(DateTimePickerAndroid.open).mockReset();
});

const open = () =>
  renderRouter(
    { index: () => <Text>Dashboard</Text>, add: () => <AddSpendForm now={now} />, categories: () => <Text>Categories screen</Text> },
    { initialUrl: '/add' },
  );

async function fillAndSave(amount = '1,234.50', category = 'Transport') {
  await fireEvent.changeText(await screen.findByPlaceholderText('0.00'), amount);
  if (category) await fireEvent.press(screen.getByLabelText(category));
  await fireEvent.press(screen.getByText('Save spend'));
}

describe('Add spend', () => {
  it('categories: most used first, removed ones not offered', async () => {
    await open();
    const group = await screen.findByLabelText('Category');
    expect(within(group).getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual(['Transport', 'Bills', 'Groceries']);
  });

  it('saves today, in centavos, with a UUID clientId, then goes back', async () => {
    await open();
    await fillAndSave();
    await screen.findByText('Dashboard');
    expect(mockCreate).toHaveBeenCalledWith(expect.any(Function), 'h1', {
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      date: '2026-11-25',
      categoryId: 'b'.repeat(24),
      amountMinor: 123_450,
      description: null,
    });
  });

  it('Yesterday, and a description when opened', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Yesterday'));
    expect(screen.getByText('Tue, Nov 24, 2026')).toBeTruthy();
    await fireEvent.press(screen.getByText('Add a description'));
    await fireEvent.changeText(screen.getByLabelText('Description (optional)'), 'Bus to Makati');
    await fillAndSave('50');
    expect(mockCreate.mock.calls[0][2]).toMatchObject({ date: '2026-11-24', amountMinor: 5_000, description: 'Bus to Makati' });
  });

  it('Pick date opens the Android date picker, limited to a year ahead; choosing a date uses it', async () => {
    await open();
    await fireEvent.press(await screen.findByLabelText('Pick date'));
    const opts = jest.mocked(DateTimePickerAndroid.open).mock.calls[0]![0];
    expect(opts.maximumDate).toEqual(new Date(2027, 10, 25));
    opts.onChange!({ type: 'set', nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(2026, 10, 3));
    expect(await screen.findByText('Tue, Nov 3, 2026')).toBeTruthy();
    // Cancelling the picker changes nothing.
    opts.onChange!({ type: 'dismissed', nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(2026, 0, 1));
    await fillAndSave('10');
    expect(mockCreate.mock.calls[0][2].date).toBe('2026-11-03');
  });

  it('missing category and amount: both explained, nothing sent', async () => {
    await open();
    await screen.findByLabelText('Category');
    await fireEvent.press(screen.getByText('Save spend'));
    expect(screen.getByText('Choose a category')).toBeTruthy();
    expect(screen.getByText('Enter how much was spent')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 'Amount must be more than ₱0'],
    ['12.345', 'Use at most 2 decimal places'],
    ['abc', 'Enter an amount like 250 or 1,234.50'],
  ])('amount %j → "%s"', async (amount, message) => {
    await open();
    await fillAndSave(amount);
    expect(screen.getByText(message)).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a failed save keeps the form and retrying reuses the same clientId (never saved twice)', async () => {
    mockCreate.mockRejectedValueOnce(new TypeError('Network request failed'));
    await open();
    await fillAndSave();
    expect(await screen.findByText(/Couldn't save\. .*won't be saved twice/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Save spend'));
    await screen.findByText('Dashboard');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][2].clientId).toBe(mockCreate.mock.calls[0][2].clientId);
  });

  it('a category removed meanwhile: explains, clears the choice and reloads the list', async () => {
    mockCreate.mockRejectedValueOnce(new ApiError(409, 'category_removed'));
    await open();
    mockCategories.mockResolvedValue([cat('a', 'Groceries', 1)]);
    await fillAndSave();
    expect(await screen.findByText('That category was just removed. Choose another one.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Transport')).toBeNull());
  });

  it('no categories: House Member is told to ask; Owner gets a way to Categories', async () => {
    mockCategories.mockResolvedValue([]);
    await open();
    expect(await screen.findByText('Ask the House Owner or a Co-Owner to add categories first.')).toBeTruthy();
    expect(screen.queryByText('Go to Categories')).toBeNull();
  });

  it('no categories as House Owner → Go to Categories', async () => {
    mockRole = 'owner';
    mockCategories.mockResolvedValue([]);
    await open();
    await fireEvent.press(await screen.findByText('Go to Categories'));
    await screen.findByText('Categories screen');
  });

  it('categories fail to load → Try again recovers', async () => {
    mockCategories.mockRejectedValueOnce(new TypeError('Network request failed'));
    await open();
    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByLabelText('Category')).toBeTruthy();
  });

  it('alerts set off by the spend appear as toasts for the person who entered it', async () => {
    mockCreate.mockResolvedValue({
      transaction: {},
      alerts: [
        { id: 'x', yearMonth: '2026-11', level: 'over', categoryId: 'c', title: 'Over budget · Transport', body: 'Home household is over its ₱2,000 Transport budget by ₱100', triggeredBy: null, createdAt: '2026-11-25T02:00:00.000Z', unread: true },
        { id: 'y', yearMonth: '2026-11', level: 'near', categoryId: null, title: 'Nearly at the monthly budget', body: 'Home household has used 91% of its ₱40,000 monthly budget', triggeredBy: null, createdAt: '2026-11-25T02:00:00.000Z', unread: true },
      ],
    });
    await open();
    await fillAndSave();
    await screen.findByText('Dashboard');
    expect(mockShow.mock.calls.map((c) => c[0].level)).toEqual(['over', 'near']);
    expect(mockShow).toHaveBeenCalledWith({ level: 'over', title: 'Over budget · Transport', body: 'Home household is over its ₱2,000 Transport budget by ₱100' });
  });

  it('no alerts: no toast', async () => {
    await open();
    await fillAndSave();
    await screen.findByText('Dashboard');
    expect(mockShow).not.toHaveBeenCalled();
  });
});
