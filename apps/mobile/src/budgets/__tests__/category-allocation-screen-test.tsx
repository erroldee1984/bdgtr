/** Budgets → Budget per Category: the month's donut, each category's budget, Custom badge and reset. */
import { buildMonthBudgets, type MonthBudgets } from '@bdgtr/shared';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { describeAllocation } from '@/budgets/allocation-donut';
import { CategoryAllocationScreen } from '@/budgets/category-allocation-screen';
import { ApiError } from '@/lib/api-error';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});

let mockRole = 'owner';
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: { householdId: 'h1', householdName: 'Dela Cruz', role: mockRole }, refresh: async () => {} }),
}));

let mockTotal: number;
let mockDefaults: Record<string, number>;
let mockOverrides: Record<string, number>;
let mockFail: Error | null;
const mockCalls: string[] = [];
let mockUnbudgeted: ((month: string) => MonthBudgets) | null = null;
function mockMonth(month: string): MonthBudgets {
  if (mockUnbudgeted) return mockUnbudgeted(month);
  return buildMonthBudgets({
    month,
    defaultMonthlyBudgetMinor: mockTotal,
    monthlyOverrideMinor: null,
    categories: [
      { id: 'c1', name: 'Groceries', icon: 'cart', colour: '#5A94FF', defaultBudgetMinor: mockDefaults.c1!, overrideMinor: mockOverrides.c1 ?? null },
      { id: 'c2', name: 'Transport', icon: 'bus', colour: '#5A94FF', defaultBudgetMinor: mockDefaults.c2!, overrideMinor: mockOverrides.c2 ?? null },
    ],
  });
}
jest.mock('@/lib/api', () => {
  const { ApiError: E } = jest.requireActual('@/lib/api-error');
  return {
    ApiError: E,
    fetchBudgets: async (_t: unknown, _h: string, month: string) => mockMonth(month),
    setCategoryMonthBudget: async (_t: unknown, _h: string, month: string, id: string, minor: number) => {
      mockCalls.push(`month ${month} ${id} ${minor}`);
      if (mockFail) throw mockFail;
      if (minor === mockDefaults[id]) delete mockOverrides[id];
      else mockOverrides[id] = minor;
      return mockMonth(month);
    },
    resetCategoryMonthBudget: async (_t: unknown, _h: string, month: string, id: string) => {
      mockCalls.push(`reset ${month} ${id}`);
      if (mockFail) throw mockFail;
      delete mockOverrides[id];
      return mockMonth(month);
    },
  };
});

beforeEach(() => {
  mockUnbudgeted = null;
  mockRole = 'owner';
  mockTotal = 4_000_000;
  mockDefaults = { c1: 800_000, c2: 200_000 };
  mockOverrides = {};
  mockFail = null;
  mockCalls.length = 0;
});

const open = () => renderRouter({ 'budgets/categories': CategoryAllocationScreen }, { initialUrl: '/budgets/categories?month=2026-11' });
const row = (name: string) => screen.getAllByTestId('allocation-row').find((r) => within(r).queryByText(name))!;

describe('Budget per Category', () => {
  it('shows the month at the top only: the donut and each category’s budget, without defaults or the month repeated', async () => {
    await open();
    expect(await screen.findByLabelText('25% of ₱40,000.00 allocated, ₱30,000.00 unallocated')).toBeTruthy();
    expect(screen.getByText('November 2026')).toBeTruthy(); // the month switcher
    expect(screen.getByText('Of the ₱40,000.00 monthly budget')).toBeTruthy();
    expect(within(row('Groceries')).getByText('₱8,000.00')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull(); // no Defaults | This month
    expect(screen.queryByText(/Default ₱/)).toBeNull();
    expect(screen.queryAllByText(/November 2026/)).toHaveLength(1);
  });

  it('Edit sets the category’s budget for the month (Custom badge, donut updates); Reset goes back to the default', async () => {
    await open();
    await fireEvent.press(await screen.findByLabelText('Edit Groceries'));
    expect(screen.getByLabelText('Groceries budget').props.value).toBe('8000');
    await fireEvent.changeText(screen.getByLabelText('Groceries budget'), '12000');
    await fireEvent.press(screen.getByText('Save'));
    expect(mockCalls).toEqual(['month 2026-11 c1 1200000']);
    expect(await screen.findByText('Groceries budget saved.')).toBeTruthy();
    expect(within(row('Groceries')).getByText('Custom')).toBeTruthy();
    expect(within(row('Groceries')).getByText('₱12,000.00')).toBeTruthy();
    expect(screen.getByLabelText('35% of ₱40,000.00 allocated, ₱26,000.00 unallocated')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Reset Groceries to default'));
    expect(await screen.findByText('Groceries uses its default budget again.')).toBeTruthy();
    expect(within(row('Groceries')).queryByText('Custom')).toBeNull();
  });

  it('switching month shows that month’s budgets', async () => {
    await open();
    await fireEvent.press(await screen.findByLabelText('Next month'));
    expect(await screen.findByText('December 2026')).toBeTruthy();
    expect(screen.queryAllByText(/November 2026/)).toHaveLength(0);
  });

  it('over-allocated: said in words with the red plus icon (not colour alone)', async () => {
    mockOverrides = { c1: 4_500_000 };
    await open();
    expect(await screen.findByLabelText('117% of ₱40,000.00 allocated, over-allocated by ₱7,000.00')).toBeTruthy();
    expect(screen.getByText('Over-allocated by ₱7,000.00', { includeHiddenElements: true })).toBeTruthy(); // visible; the label above is what's spoken
  });

  it('a failed reset says so', async () => {
    mockOverrides = { c1: 1 };
    await open();
    mockFail = new TypeError('Network request failed');
    await fireEvent.press(await screen.findByLabelText('Reset Groceries to default'));
    expect(await screen.findByText("Couldn't save. Check your connection and try again.")).toBeTruthy();
  });

  it('a removed category on save is explained', async () => {
    await open();
    await fireEvent.press(await screen.findByLabelText('Edit Groceries'));
    mockFail = new ApiError(409, 'category_removed');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('That category was removed.')).toBeTruthy();
  });

  it('a House Member sees the allocation but no Edit or Reset', async () => {
    mockRole = 'member';
    mockOverrides = { c1: 1 };
    await open();
    expect(await screen.findAllByTestId('allocation-row')).toHaveLength(2);
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Reset to default')).toBeNull();
    expect(screen.getByText('Only the House Owner or a Co-Owner can change these.')).toBeTruthy();
  });
});

describe('with the built-in Unbudgeted category', () => {
  const withUnbudgeted = (month: string): MonthBudgets =>
    buildMonthBudgets({
      month,
      defaultMonthlyBudgetMinor: 4_000_000,
      monthlyOverrideMinor: null,
      categories: [
        { id: 'g', name: 'Groceries', icon: 'cart', colour: '#4ADE80', defaultBudgetMinor: 800_000, overrideMinor: null },
        { id: 'u', name: 'Unbudgeted', icon: 'dots-horizontal', colour: '#94A3B8', defaultBudgetMinor: 0, overrideMinor: null, kind: 'unbudgeted' },
      ],
    });

  it('its budget is the rest, marked Automatic, with no Edit or Reset; the ring says "in Unbudgeted"', async () => {
    mockUnbudgeted = withUnbudgeted;
    await open();
    expect(await screen.findByText('Unbudgeted')).toBeTruthy();
    expect(screen.getByText('₱32,000.00')).toBeTruthy();
    expect(screen.getByText('Automatic: what the monthly budget doesn\'t give the other categories.')).toBeTruthy();
    expect(screen.queryByLabelText('Edit Unbudgeted')).toBeNull();
    expect(screen.getByLabelText('Edit Groceries')).toBeTruthy();
    expect(screen.getByLabelText('20% of ₱40,000.00 allocated, ₱32,000.00 in Unbudgeted')).toBeTruthy();
    expect(screen.getByText('₱32,000.00 in Unbudgeted', { includeHiddenElements: true })).toBeTruthy();
    mockUnbudgeted = null;
  });
});

describe('describeAllocation', () => {
  it('no total budget', () => {
    expect(describeAllocation({ allocatedMinor: 100, unallocatedMinor: -100, percentAllocated: 0 }, 0)).toBe('₱1.00 allocated, no total budget set');
  });
});
