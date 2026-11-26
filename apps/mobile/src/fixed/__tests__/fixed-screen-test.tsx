/** More → Fixed transactions (docs/PLAN.md §6.5). */
import type { BulkPostInput, Category, CreateFixedInput, FixedTransaction } from '@bdgtr/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { View } from 'react-native';

import { addLabel, FixedScreen, fixedProblem } from '@/fixed/fixed-screen';
import { ApiError } from '@/lib/api-error';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});

let mockRole = 'owner';
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: { householdId: 'h1', householdName: 'Dela Cruz', role: mockRole } }),
}));

let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));

const mockToasts: unknown[] = [];
jest.mock('@/toast/toast', () => ({ useToast: () => ({ show: (t: unknown) => mockToasts.push(t) }) }));

/** The native picker can't open in Jest: a button that picks 3 Dec 2026. */
jest.mock('@/spend/date-picker-button', () => {
  const RN = jest.requireActual('react-native');
  return {
    DatePickerButton: ({ onChange }: { onChange: (d: string) => void }) => (
      <RN.Pressable role="button" accessibilityLabel="Pick date" onPress={() => onChange('2026-12-03')}>
        <RN.Text>Pick date</RN.Text>
      </RN.Pressable>
    ),
  };
});

const id = (n: number) => n.toString(16).padStart(24, '0');
const mockGroceries: Category = { id: id(100), name: 'Groceries', icon: 'cart', colour: '#5A94FF', defaultBudgetMinor: 0, isRemoved: false, recentUseCount: 0 };
const mockBills: Category = { id: id(101), name: 'Bills', icon: 'flash', colour: '#4ADE80', defaultBudgetMinor: 0, isRemoved: true, recentUseCount: 0 };

let mockItems: FixedTransaction[];
let mockPosted: Record<string, Record<string, string>>; // month → id → date
let mockFail: Error | null;
let mockCategoryError: Error | null;
const mockCalls: { op: string; body?: unknown; month?: string }[] = [];
jest.mock('@/lib/api', () => {
  const { ApiError: E } = jest.requireActual('@/lib/api-error');
  return {
    ApiError: E,
    fetchCategories: async () => {
      mockCalls.push({ op: 'categories' });
      return [mockGroceries, mockBills];
    },
    createCategory: async (_t: unknown, _h: string, input: { name: string }) => {
      mockCalls.push({ op: 'createCategory', body: input });
      if (mockCategoryError) throw mockCategoryError;
      return { ...mockGroceries, id: 'e'.repeat(24), name: input.name, icon: 'help-circle-outline', colour: '#94A3B8' };
    },
    fetchFixed: async (_t: unknown, _h: string, month: string) => {
      mockCalls.push({ op: 'list', month });
      return mockItems.map((i) => ({ ...i, postedOn: mockPosted[month]?.[i.id] ?? null }));
    },
    createFixed: async (_t: unknown, _h: string, input: CreateFixedInput) => {
      mockCalls.push({ op: 'create', body: input });
      if (mockFail) throw mockFail;
      const item = { ...input, id: id(mockItems.length + 1), description: input.description ?? null, autoPostEnabled: input.autoPostEnabled, postedOn: null };
      mockItems.push(item);
      return item;
    },
    updateFixed: async (_t: unknown, _h: string, fid: string, input: Partial<FixedTransaction>) => {
      mockCalls.push({ op: 'update', body: { fid, ...input } });
      mockItems = mockItems.map((i) => (i.id === fid ? { ...i, ...input } : i));
      return mockItems.find((i) => i.id === fid);
    },
    removeFixed: async (_t: unknown, _h: string, fid: string) => {
      mockCalls.push({ op: 'remove', body: fid });
      mockItems = mockItems.filter((i) => i.id !== fid);
    },
    bulkPostFixed: async (_t: unknown, _h: string, input: BulkPostInput) => {
      mockCalls.push({ op: 'bulk', body: input });
      if (mockFail) throw mockFail;
      const month = input.date.slice(0, 7);
      for (const it of input.items) (mockPosted[month] ??= {})[it.id] ??= input.date;
      return { transactions: [], alerts: [{ level: 'over', title: 'Over', body: 'Groceries over' }] };
    },
  };
});

const RENT: FixedTransaction = { id: id(1), name: 'Rent', categoryId: mockGroceries.id, amountMinor: 1_500_000, description: null, dayOfMonth: 5, autoPostEnabled: true, postedOn: null };
const NET: FixedTransaction = { id: id(2), name: 'Internet', categoryId: mockGroceries.id, amountMinor: 150_000, description: null, dayOfMonth: 31, autoPostEnabled: false, postedOn: null };
const POWER: FixedTransaction = { id: id(3), name: 'Power', categoryId: mockBills.id, amountMinor: 300_000, description: null, dayOfMonth: 15, autoPostEnabled: true, postedOn: null };

const NOW = () => new Date('2026-11-26T02:00:00.000Z'); // 26 Nov Manila

beforeEach(() => {
  mockRole = 'owner';
  mockItems = [RENT, NET];
  mockPosted = { '2026-11': { [RENT.id]: '2026-11-05' } };
  mockFail = null;
  mockCategoryError = null;
  mockCalls.length = 0;
  mockToasts.length = 0;
});

function Screen() {
  return <FixedScreen now={NOW} />;
}
async function open() {
  await renderRouter({ fixed: Screen, index: () => <View /> }, { initialUrl: '/fixed' });
  await waitFor(() => expect(screen.queryByLabelText('Loading fixed transactions')).toBeNull());
}
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

describe('the list', () => {
  it('each item: name, amount, category, day, how it’s added, and whether it’s in this month', async () => {
    await open();
    expect(screen.getByText('Rent')).toBeTruthy();
    expect(screen.getByText('₱15,000.00')).toBeTruthy();
    expect(screen.getByText('Groceries · Every month on the 5th')).toBeTruthy();
    expect(screen.getByText('Added automatically · Added Nov 5')).toBeTruthy();
    expect(screen.getByText('Groceries · Every month on the 31st (or the last day of shorter months)')).toBeTruthy();
    expect(screen.getByText('Added by hand · Not added in November 2026')).toBeTruthy();
  });

  it('an item whose category was removed says it won’t be added automatically', async () => {
    mockItems = [POWER];
    await open();
    expect(screen.getByText('Not added automatically: its category was removed · Not added in November 2026')).toBeTruthy();
  });

  it('empty: an invitation to add one', async () => {
    mockItems = [];
    await open();
    expect(screen.getByText(/No fixed transactions yet\. Add rent/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select to add' })).toBeNull();
  });

  it('House Members: read-only (no add, select or edit)', async () => {
    mockRole = 'member';
    await open();
    expect(screen.getByText('Only the House Owner or a Co-Owner can change these.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add fixed transaction' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select to add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Rent' })).toBeNull();
  });
});

describe('add, edit, remove', () => {
  // Regression (M5a dev): a field's error stayed after it was corrected, hiding its hint
  // ("Every month on the 12th") until the next Save.
  it('add: validates, a corrected field drops its error, then saves and lists it', async () => {
    await open();
    await press('Add fixed transaction');
    await press('Save');
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(screen.getByText('Choose a category')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Water');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '800');
    await fireEvent.press(screen.getByRole('radio', { name: 'Groceries' }));
    await fireEvent.changeText(screen.getByLabelText('Day of the month'), '12');
    expect(screen.getByText('Every month on the 12th')).toBeTruthy(); // the error cleared, the hint is back
    expect(screen.queryByRole('radio', { name: /Bills/ })).toBeNull(); // removed categories aren't offered
    await press('Save');
    await waitFor(() => expect(screen.getByText('Water saved.')).toBeTruthy());
    expect(mockCalls.find((c) => c.op === 'create')?.body).toEqual({
      name: 'Water',
      amountMinor: 80_000,
      categoryId: mockGroceries.id,
      dayOfMonth: 12,
      autoPostEnabled: true,
      description: null,
    });
    expect(await screen.findByText('Water')).toBeTruthy();
  });

  it('edit: prefilled; switching auto-add off saves', async () => {
    await open();
    await press('Edit Rent');
    expect(screen.getByLabelText('Name').props.value).toBe('Rent');
    expect(screen.getByLabelText('Amount').props.value).toBe('15000');
    await fireEvent(screen.getByLabelText('Add automatically on its day'), 'valueChange', false);
    await press('Save');
    await waitFor(() => expect(mockCalls.find((c) => c.op === 'update')?.body).toMatchObject({ fid: RENT.id, autoPostEnabled: false }));
  });

  it('a refused save keeps the form open with the reason', async () => {
    mockFail = new ApiError(409, 'category_removed');
    await open();
    await press('Add fixed transaction');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Water');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '800');
    await fireEvent.press(screen.getByRole('radio', { name: 'Groceries' }));
    await fireEvent.changeText(screen.getByLabelText('Day of the month'), '12');
    await press('Save');
    expect(await screen.findByText('That category was removed. Choose another one.')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('remove asks first and explains past spends stay', async () => {
    await open();
    await press('Edit Rent');
    await press('Remove');
    expect(screen.getByText('Remove Rent?')).toBeTruthy();
    expect(screen.getByText(/Spends already added from it stay as they are/)).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!); // the dialog's
    await waitFor(() => expect(mockCalls.some((c) => c.op === 'remove' && c.body === RENT.id)).toBe(true));
    expect(await screen.findByText('Rent removed. Spends already added from it stay.')).toBeTruthy();
  });
});

describe('quick add a category (same as Add spend)', () => {
  async function startForm() {
    await open();
    await press('Add fixed transaction');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Vet');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '1500');
    await fireEvent.changeText(screen.getByLabelText('Day of the month'), '10');
  }
  async function quickAdd(name: string) {
    await fireEvent.press(screen.getByLabelText('New category'));
    await fireEvent.changeText(screen.getByLabelText('New category name'), name);
    await press('Add');
  }

  it('asks only for a name, adds it, selects it, and the item saves in it', async () => {
    await startForm();
    await quickAdd(' Pet care ');
    expect(mockCalls.find((c) => c.op === 'createCategory')?.body).toEqual({
      name: 'Pet care',
      icon: 'help-circle-outline',
      colour: '#94A3B8',
      defaultBudgetMinor: 0,
    });
    expect(await screen.findByText('Pet care added and selected.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Pet care' })).toBeChecked();
    await press('Save');
    await waitFor(() => expect(mockCalls.find((c) => c.op === 'create')?.body).toMatchObject({ name: 'Vet', categoryId: 'e'.repeat(24) }));
  });

  it('an existing name selects that category, no duplicate', async () => {
    await startForm();
    await quickAdd('groceries');
    expect(mockCalls.some((c) => c.op === 'createCategory')).toBe(false);
    expect(await screen.findByText("Groceries already exists, so it's selected.")).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
  });

  it('a name clash on the server explains it and reloads the categories', async () => {
    mockCategoryError = new ApiError(409, 'category_exists');
    await startForm();
    const before = mockCalls.filter((c) => c.op === 'categories').length;
    await quickAdd('Pet care');
    expect(await screen.findByText('A category with this name already exists. Pick it from the list.')).toBeTruthy();
    await waitFor(() => expect(mockCalls.filter((c) => c.op === 'categories').length).toBe(before + 1));
  });
});

describe('Select to add (bulk)', () => {
  it('tick items, choose a date, add; alerts show as toasts', async () => {
    await open();
    await press('Select to add');
    expect(screen.getByRole('button', { name: 'Add 0 transactions' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('checkbox', { name: /^Internet,/ }));
    await press('Pick date'); // 3 Dec: a different month, so nothing is flagged
    await waitFor(() => expect(mockCalls.some((c) => c.op === 'list' && c.month === '2026-12')).toBe(true));
    await press('Add 1 transaction');
    await waitFor(() => expect(screen.getByText('Added 1 transaction on Dec 3.')).toBeTruthy());
    const body = mockCalls.find((c) => c.op === 'bulk')!.body as BulkPostInput;
    expect(body.date).toBe('2026-12-03');
    expect(body.items.map((i) => i.id)).toEqual([NET.id]);
    expect(body.items[0]!.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockToasts).toEqual([{ level: 'over', title: 'Over', body: 'Groceries over' }]);
    expect(screen.queryByRole('checkbox')).toBeNull(); // back to the list
  });

  it('items already added this month are flagged: Skip them adds only the rest', async () => {
    await open();
    await press('Select to add');
    await fireEvent.press(screen.getByRole('checkbox', { name: /^Rent,/ }));
    await fireEvent.press(screen.getByRole('checkbox', { name: /^Internet,/ }));
    await press('Add 2 transactions');
    expect(screen.getByText('1 already added in November 2026')).toBeTruthy();
    expect(screen.getByText('Rent (added Nov 5)')).toBeTruthy();
    expect(mockCalls.some((c) => c.op === 'bulk')).toBe(false);
    await press('Skip them');
    await waitFor(() => expect((mockCalls.find((c) => c.op === 'bulk')!.body as BulkPostInput).items.map((i) => i.id)).toEqual([NET.id]));
  });

  it('…or Add again adds them all; with only repeats there is no Skip', async () => {
    await open();
    await press('Select to add');
    await fireEvent.press(screen.getByRole('checkbox', { name: /^Rent,/ }));
    await press('Add 1 transaction');
    expect(screen.queryByRole('button', { name: 'Skip them' })).toBeNull();
    await press('Add again');
    await waitFor(() => expect((mockCalls.find((c) => c.op === 'bulk')!.body as BulkPostInput).items.map((i) => i.id)).toEqual([RENT.id]));
  });

  it('a failed add says so and keeps the selection', async () => {
    mockFail = new TypeError('Network request failed');
    await open();
    await press('Select to add');
    await fireEvent.press(screen.getByRole('checkbox', { name: /^Internet,/ }));
    await press('Add 1 transaction');
    expect(await screen.findByText("Couldn't add them. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /^Internet,/ })).toBeChecked();
  });

  it('Cancel leaves select mode', async () => {
    await open();
    await press('Select to add');
    await press('Cancel');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('helpers', () => {
  it('wording', () => {
    expect(addLabel(1)).toBe('Add 1 transaction');
    expect(addLabel(3)).toBe('Add 3 transactions');
    expect(fixedProblem(new ApiError(403, 'forbidden'))).toBe('Only the House Owner or a Co-Owner can change fixed transactions.');
    expect(fixedProblem(new ApiError(409, 'fixed_limit'))).toBe('A household can have up to 100 fixed transactions.');
    expect(fixedProblem(new ApiError(404, 'not_found'))).toBe('That fixed transaction was removed.');
  });
});
