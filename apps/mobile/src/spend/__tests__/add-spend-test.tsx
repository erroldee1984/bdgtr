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
let mockOutbox: unknown = null; // set to stand in for the offline outbox in one test
jest.mock('@/offline/outbox-context', () => {
  const actual = jest.requireActual('@/offline/outbox-context');
  return { ...actual, useOutbox: () => mockOutbox ?? actual.useOutbox() };
});
const mockShow = jest.fn();
jest.mock('@/toast/toast', () => ({ useToast: () => ({ show: mockShow }) }));
const mockCategories = jest.fn();
const mockCreate = jest.fn();
const mockCreateCategory = jest.fn();
const mockFetchTxs = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchTransactions: (...a: unknown[]) => mockFetchTxs(...a),
  updateTransaction: (...a: unknown[]) => mockUpdate(...a),
  createCategory: (...a: unknown[]) => mockCreateCategory(...a),
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
  mockCreateCategory.mockReset().mockImplementation(async (_t: unknown, _h: string, input: { name: string }) => ({
    ...cat('e', input.name, 0),
    icon: 'help-circle-outline',
    colour: '#94A3B8',
  }));
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
  describe('editing a saved spend (/add?edit=…&month=…)', () => {
    const saved = {
      id: 'f'.repeat(24),
      clientId: '00000000-0000-4000-8000-0000000000ff',
      date: '2026-11-20',
      yearMonth: '2026-11',
      categoryId: 'c'.repeat(24), // "Old": removed since
      amountMinor: 120_000,
      description: 'Rice',
      createdBy: 'u'.repeat(24),
      isYours: true,
    };
    const openEdit = (id = saved.id) =>
      renderRouter(
        { index: () => <Text>Dashboard</Text>, add: () => <AddSpendForm now={now} /> },
        { initialUrl: `/add?edit=${id}&month=2026-11` },
      );
    beforeEach(() => {
      mockFetchTxs.mockReset().mockResolvedValue([saved]);
      mockUpdate.mockReset().mockResolvedValue({ transaction: saved, alerts: [{ level: 'over', title: 'Over budget · Old', body: 'b' }] });
    });

    it('opens filled in (its removed category still offered); saving changes it on the server', async () => {
      await openEdit();
      const amount = await screen.findByPlaceholderText('0.00');
      expect(amount.props.value).toBe('1200');
      expect(screen.getByLabelText('Old')).toBeChecked();
      expect(screen.getByDisplayValue('Rice')).toBeTruthy();
      await fireEvent.changeText(amount, '1,350');
      await fireEvent.press(screen.getByText('Save spend'));
      await screen.findByText('Dashboard');
      expect(mockFetchTxs).toHaveBeenCalledWith(expect.any(Function), 'h1', '2026-11');
      expect(mockUpdate).toHaveBeenCalledWith(expect.any(Function), 'h1', saved.id, {
        date: '2026-11-20',
        categoryId: 'c'.repeat(24),
        amountMinor: 135_000,
        description: 'Rice',
      });
      expect(mockShow.mock.calls.map((c) => c[0].title)).toEqual(['Spend updated', 'Over budget · Old']);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it.each([
      [new (jest.requireActual('@/lib/api-error').ApiError)(403, 'forbidden'), 'You can only edit spends you entered.'],
      [new (jest.requireActual('@/lib/api-error').ApiError)(404, 'not_found'), 'That spend was deleted.'],
      [new TypeError('Network request failed'), "Couldn't save the change. Check your connection and try again."],
    ])('a refused or failed save explains (%s) and stays', async (err, text) => {
      mockUpdate.mockRejectedValueOnce(err);
      await openEdit();
      await screen.findByPlaceholderText('0.00');
      await fireEvent.press(screen.getByText('Save spend'));
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByText('Dashboard')).toBeNull();
    });

    it('gone meanwhile, or no connection: says so instead of an empty form', async () => {
      await openEdit('e'.repeat(24));
      expect(await screen.findByText('That spend was deleted, or moved to another month.')).toBeTruthy();
      mockFetchTxs.mockRejectedValueOnce(new TypeError('Network request failed'));
      await openEdit();
      expect(await screen.findByText("Couldn't load that spend. Check your connection and try again.")).toBeTruthy();
    });
  });

  describe('editing a spend still waiting to be sent (/add?pending=…)', () => {
    const waiting = {
      clientId: '00000000-0000-4000-8000-00000000abcd',
      householdId: 'h1',
      input: { clientId: '00000000-0000-4000-8000-00000000abcd', date: '2026-11-24', categoryId: 'b'.repeat(24), amountMinor: 50_000, description: 'Jeep' },
      savedAt: '',
      attempts: 0,
      state: 'pending',
      problem: null,
    };
    const openEdit = () =>
      renderRouter(
        { index: () => <Text>Dashboard</Text>, add: () => <AddSpendForm now={now} />, categories: () => <Text>Categories screen</Text> },
        { initialUrl: `/add?pending=${waiting.clientId}` },
      );
    const outboxWith = (editPending: jest.Mock) => ({
      items: [waiting],
      offline: true,
      saveSpend: jest.fn(),
      editPending,
      syncNow: () => {},
      noteNetwork: () => {},
      retry: () => {},
      discard: () => {},
    });

    it('opens filled in; saving keeps its clientId and changes it on the phone only', async () => {
      const editPending = jest.fn(async () => 'saved');
      mockOutbox = outboxWith(editPending);
      try {
        await openEdit();
        const amount = await screen.findByPlaceholderText('0.00');
        expect(amount.props.value).toBe('500');
        expect(screen.getByLabelText('Transport')).toBeChecked();
        expect(screen.getByDisplayValue('Jeep')).toBeTruthy();
        await fireEvent.changeText(amount, '650');
        await fireEvent.press(screen.getByText('Save spend'));
        await screen.findByText('Dashboard');
        expect(editPending).toHaveBeenCalledWith(waiting.clientId, expect.objectContaining({ clientId: waiting.clientId, amountMinor: 65_000, date: '2026-11-24' }));
        expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changes saved on this phone' }));
        expect(mockCreate).not.toHaveBeenCalled();
      } finally {
        mockOutbox = null;
      }
    });

    it.each([
      ['sending', "It's being sent right now. Try again in a moment."],
      ['uncertain', 'This one may already have reached the server'],
      ['gone', 'It has already been sent or removed.'],
    ])('refused (%s): explains and stays on the form', async (outcome, text) => {
      mockOutbox = outboxWith(jest.fn(async () => outcome));
      try {
        await openEdit();
        await screen.findByPlaceholderText('0.00');
        await fireEvent.press(screen.getByText('Save spend'));
        expect(await screen.findByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
        expect(screen.queryByText('Dashboard')).toBeNull();
      } finally {
        mockOutbox = null;
      }
    });
  });

  it('offline (Android): saved on this phone, says so, and goes back like a normal save', async () => {
    const saveSpend = jest.fn(async () => ({ queued: true, alerts: [] }));
    mockOutbox = { items: [], offline: true, saveSpend, syncNow: () => {}, retry: () => {}, discard: () => {} };
    try {
      await open();
      await fillAndSave();
      await screen.findByText('Dashboard');
      expect(saveSpend).toHaveBeenCalledWith('h1', expect.objectContaining({ amountMinor: 123_450 }));
      expect(mockShow).toHaveBeenCalledWith({ level: 'near', title: 'Saved on this phone', body: "You're offline. It will be sent when you're back online." });
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      mockOutbox = null;
    }
  });

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

  it('Yesterday, and a description in a single-line field shown straight away', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Yesterday'));
    expect(screen.getByText('Tue, Nov 24, 2026')).toBeTruthy();
    const field = screen.getByLabelText('Description (optional)');
    expect(field.props.multiline).toBeFalsy();
    await fireEvent.changeText(field, 'Bus to Makati');
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

describe('Add spend: quick add a category', () => {
  async function quickAdd(name: string) {
    await fireEvent.press(await screen.findByLabelText('New category'));
    await fireEvent.changeText(screen.getByLabelText('New category name'), name);
    await fireEvent.press(screen.getByText('Add'));
  }

  it('House Owner / Co-Owner: asks only for a name, adds it with the "?" icon, selects it and saves the spend in it', async () => {
    mockRole = 'co_owner';
    await open();
    await quickAdd('  Pet food ');
    expect(mockCreateCategory).toHaveBeenCalledWith(expect.any(Function), 'h1', {
      name: 'Pet food',
      icon: 'help-circle-outline',
      colour: '#94A3B8',
      defaultBudgetMinor: 0,
    });
    expect(await screen.findByText('Pet food added and selected.')).toBeTruthy();
    expect(screen.getByLabelText('Pet food')).toBeChecked();
    await fireAmountAndSave();
    expect(mockCreate.mock.calls[0][2].categoryId).toBe('e'.repeat(24));
  });

  it('a name that already exists (any case or spacing) selects that category instead of making a duplicate', async () => {
    mockRole = 'owner';
    await open();
    await quickAdd('  GROCERIES ');
    expect(mockCreateCategory).not.toHaveBeenCalled();
    expect(await screen.findByText("Groceries already exists, so it's selected.")).toBeTruthy();
    expect(screen.getByLabelText('Groceries')).toBeChecked();
  });

  it('a removed category\'s name can be reused (it is not offered, so a new one is made)', async () => {
    mockRole = 'owner';
    await open();
    await quickAdd('Old');
    expect(mockCreateCategory).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['blank', '   ', 'Name is required'],
    ['too long', 'x'.repeat(41), 'Name must be 40 characters or fewer'],
  ])('a %s name is explained and nothing is sent', async (_label, name, message) => {
    mockRole = 'owner';
    await open();
    await fireEvent.press(await screen.findByLabelText('New category'));
    // maxLength stops typing past 40 on a device; the check still guards pasted text.
    await fireEvent(screen.getByLabelText('New category name'), 'changeText', name);
    await fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText(message)).toBeTruthy();
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(409, 'category_exists'), 'A category with this name already exists. Pick it from the list.', 2],
    [new ApiError(409, 'category_limit'), 'This household has too many categories. Remove or reuse one in Categories.', 1],
    [new TypeError('Network request failed'), "Couldn't add the category. Check your connection and try again.", 1],
  ])('server says %s → explains it (a name clash reloads the list)', async (err, message, loads) => {
    mockRole = 'owner';
    mockCreateCategory.mockRejectedValueOnce(err);
    await open();
    await quickAdd('Pet food');
    expect(await screen.findByText(message)).toBeTruthy();
    await waitFor(() => expect(mockCategories).toHaveBeenCalledTimes(loads));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('Cancel closes it without adding anything', async () => {
    mockRole = 'owner';
    await open();
    await fireEvent.press(await screen.findByLabelText('New category'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByLabelText('New category name')).toBeNull();
    expect(screen.getByLabelText('New category')).toBeTruthy();
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });

  it('House Member: no "New category" (only Owners and Co-Owners manage categories)', async () => {
    mockRole = 'member';
    await open();
    await screen.findByLabelText('Category');
    expect(screen.queryByLabelText('New category')).toBeNull();
  });
});

async function fireAmountAndSave() {
  await fireEvent.changeText(screen.getByPlaceholderText('0.00'), '250');
  await fireEvent.press(screen.getByText('Save spend'));
  await screen.findByText('Dashboard');
}
