/** Budgets → Allocate per category: donut, Defaults | This month, edit, Custom badge and reset. */
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
function mockMonth(month: string): MonthBudgets {
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
    updateCategory: async (_t: unknown, _h: string, id: string, input: { defaultBudgetMinor: number }) => {
      mockCalls.push(`default ${id} ${input.defaultBudgetMinor}`);
      mockDefaults[id] = input.defaultBudgetMinor;
      return {};
    },
  };
});

beforeEach(() => {
  mockRole = 'owner';
  mockTotal = 4_000_000;
  mockDefaults = { c1: 800_000, c2: 200_000 };
  mockOverrides = {};
  mockFail = null;
  mockCalls.length = 0;
});

const open = () => renderRouter({ 'budgets/categories': CategoryAllocationScreen }, { initialUrl: '/budgets/categories?month=2026-11' });
const row = (name: string) => screen.getAllByTestId('allocation-row').find((r) => within(r).queryByText(name))!;

describe('Allocate per category', () => {
  it('opens on this month: the donut says how much is allocated; each row shows default and this month', async () => {
    await open();
    expect(await screen.findByLabelText('25% of ₱40,000.00 allocated, ₱30,000.00 unallocated')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'This month' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(within(row('Groceries')).getByText('Default ₱8,000.00')).toBeTruthy();
    expect(within(row('Groceries')).getByText('November 2026 ₱8,000.00')).toBeTruthy();
  });

  it('this month: Edit sets an override (Custom badge, donut updates); Reset goes back to the default', async () => {
    await open();
    await fireEvent.press(await screen.findByLabelText('Edit Groceries for November 2026'));
    await fireEvent.changeText(screen.getByLabelText('Groceries budget for November 2026'), '12000');
    await fireEvent.press(screen.getByText('Save'));
    expect(mockCalls).toEqual(['month 2026-11 c1 1200000']);
    expect(await screen.findByText('Groceries budget for November 2026 saved.')).toBeTruthy();
    expect(within(row('Groceries')).getByText('Custom')).toBeTruthy();
    expect(within(row('Groceries')).getByText('November 2026 ₱12,000.00')).toBeTruthy();
    expect(screen.getByLabelText('35% of ₱40,000.00 allocated, ₱26,000.00 unallocated')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Reset Groceries to default'));
    expect(await screen.findByText('Groceries uses its default in November 2026 again.')).toBeTruthy();
    expect(within(row('Groceries')).queryByText('Custom')).toBeNull();
  });

  it('defaults: Edit changes the category’s default (and its donut)', async () => {
    await open();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Defaults' }));
    expect(screen.queryByLabelText('Reset Groceries to default')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Edit Transport default'));
    await fireEvent.changeText(screen.getByLabelText('Transport default budget'), '5000');
    await fireEvent.press(screen.getByText('Save'));
    expect(mockCalls).toEqual(['default c2 500000']);
    expect(await screen.findByText('Transport default saved.')).toBeTruthy();
    expect(await screen.findByLabelText('32% of ₱40,000.00 allocated, ₱27,000.00 unallocated')).toBeTruthy();
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
    await fireEvent.press(await screen.findByLabelText('Edit Groceries for November 2026'));
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

describe('describeAllocation', () => {
  it('no total budget', () => {
    expect(describeAllocation({ allocatedMinor: 100, unallocatedMinor: -100, percentAllocated: 0 }, 0)).toBe('₱1.00 allocated, no total budget set');
  });
});
