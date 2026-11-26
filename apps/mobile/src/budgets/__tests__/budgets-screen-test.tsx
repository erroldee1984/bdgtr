/** More → Budgets: this month's total (override / reset), the default, and the allocation link. */
import { buildMonthBudgets, type MonthBudgets } from '@bdgtr/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { amountText } from '@/budgets/budget-amount-editor';
import { allocationSummary, BudgetsScreen } from '@/budgets/budgets-screen';
import { ApiError } from '@/lib/api-error';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});

let mockRole = 'owner';
const mockRefresh = jest.fn(async () => {});
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: { householdId: 'h1', householdName: 'Dela Cruz', role: mockRole }, refresh: mockRefresh }),
}));

/** The fake server: defaults and overrides per month. */
let mockDefault: number;
let mockOverrides: Record<string, number>;
let mockFail: Error | null;
const mockCalls: string[] = [];
function mockMonth(month: string): MonthBudgets {
  return buildMonthBudgets({
    month,
    defaultMonthlyBudgetMinor: mockDefault,
    monthlyOverrideMinor: mockOverrides[month] ?? null,
    categories: [{ id: 'c1', name: 'Groceries', icon: 'cart', colour: '#5A94FF', defaultBudgetMinor: 800_000, overrideMinor: null }],
  });
}
jest.mock('@/lib/api', () => {
  const { ApiError: E } = jest.requireActual('@/lib/api-error');
  return {
    ApiError: E,
    fetchBudgets: async (_t: unknown, _h: string, month: string) => {
      mockCalls.push(`get ${month}`);
      if (mockFail) throw mockFail;
      return mockMonth(month);
    },
    setMonthlyBudget: async (_t: unknown, _h: string, month: string, minor: number) => {
      mockCalls.push(`set ${month} ${minor}`);
      if (mockFail) throw mockFail;
      if (minor === mockDefault) delete mockOverrides[month];
      else mockOverrides[month] = minor;
      return mockMonth(month);
    },
    resetMonthlyBudget: async (_t: unknown, _h: string, month: string) => {
      mockCalls.push(`reset ${month}`);
      delete mockOverrides[month];
      return mockMonth(month);
    },
    updateHousehold: async (_t: unknown, _h: string, input: { defaultMonthlyBudgetMinor: number }) => {
      mockCalls.push(`default ${input.defaultMonthlyBudgetMinor}`);
      if (mockFail) throw mockFail;
      mockDefault = input.defaultMonthlyBudgetMinor;
      return {};
    },
  };
});

beforeEach(() => {
  mockRole = 'owner';
  mockDefault = 4_000_000;
  mockOverrides = {};
  mockFail = null;
  mockCalls.length = 0;
  mockRefresh.mockClear();
});

function Allocate() {
  return <Text>Allocation screen</Text>;
}
const open = (month = '2026-11') =>
  renderRouter({ 'budgets/index': BudgetsScreen, 'budgets/categories': Allocate }, { initialUrl: `/budgets?month=${month}` });

describe('Budgets: this month', () => {
  it('shows the month’s budget (the default when nothing is set)', async () => {
    await open();
    expect(await screen.findByText('November 2026 budget')).toBeTruthy();
    expect(screen.getAllByText('₱40,000.00')).toHaveLength(2); // this month = the default
    expect(screen.getByText('The default monthly budget.')).toBeTruthy();
    expect(screen.queryByText('Custom')).toBeNull();
    expect(screen.queryByText('Reset to default')).toBeNull();
  });

  it('change it for this month → saved, marked Custom, with the default mentioned; reset puts the default back', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Change for November 2026'));
    await fireEvent.changeText(screen.getByLabelText('Budget for November 2026'), '50,000');
    await fireEvent.press(screen.getByText('Save'));
    expect(mockCalls).toContain('set 2026-11 5000000');
    expect(await screen.findByText('November 2026 budget saved.')).toBeTruthy();
    expect(screen.getByText('₱50,000.00')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText('Set for November 2026 only. The default is ₱40,000.00.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Reset to default'));
    expect(mockCalls).toContain('reset 2026-11');
    expect(await screen.findByText('November 2026 uses the default budget again.')).toBeTruthy();
    expect(screen.queryByText('Custom')).toBeNull();
  });

  it('a bad amount is explained and nothing is sent', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Change for November 2026'));
    await fireEvent.changeText(screen.getByLabelText('Budget for November 2026'), '12.345');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('Use at most 2 decimal places')).toBeTruthy();
    expect(mockCalls.filter((c) => c.startsWith('set'))).toEqual([]);
  });

  it('a failed save keeps the field open and says why', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Change for November 2026'));
    mockFail = new ApiError(403, 'forbidden');
    await fireEvent.changeText(screen.getByLabelText('Budget for November 2026'), '1');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('Only the House Owner or a Co-Owner can change budgets.')).toBeTruthy();
    expect(screen.getByLabelText('Budget for November 2026')).toBeTruthy();
  });

  it('Cancel closes the field without saving', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Change for November 2026'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.queryByLabelText('Budget for November 2026')).toBeNull();
    expect(mockCalls.filter((c) => c.startsWith('set'))).toEqual([]);
  });

  it('switching month loads that month', async () => {
    mockOverrides['2026-12'] = 6_000_000;
    await open();
    await screen.findByText('November 2026 budget');
    await fireEvent.press(screen.getByLabelText('Next month'));
    expect(await screen.findByText('December 2026 budget')).toBeTruthy();
    expect(screen.getByText('₱60,000.00')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(mockCalls).toContain('get 2026-12');
  });
});

describe('Budgets: the default', () => {
  it('editing the default saves it, refreshes the household everywhere, and flows into the month', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Edit default'));
    await fireEvent.changeText(screen.getByLabelText('Default monthly budget'), '45000');
    await fireEvent.press(screen.getByText('Save'));
    expect(mockCalls).toContain('default 4500000');
    expect(await screen.findByText('Default monthly budget saved.')).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalledWith('h1');
    await waitFor(() => expect(screen.getAllByText('₱45,000.00')).toHaveLength(2)); // the month (no override) and the default
  });
});

describe('Budgets: allocation and roles', () => {
  it('links to the per-category allocation for the same month, with a summary', async () => {
    await open();
    expect(await screen.findByText('₱8,000.00 of ₱40,000.00 allocated · ₱32,000.00 unallocated')).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: /Budget per Category/ }));
    expect(await screen.findByText('Allocation screen')).toBeTruthy();
    expect(screen).toHavePathname('/budgets/categories');
    expect(screen).toHaveSearchParams({ month: '2026-11' });
  });

  it('a House Member sees the numbers but no way to change them', async () => {
    mockRole = 'member';
    await open();
    expect(await screen.findAllByText('₱40,000.00')).toHaveLength(2);
    expect(screen.getByText('Only the House Owner or a Co-Owner can change these.')).toBeTruthy();
    expect(screen.queryByText('Change for November 2026')).toBeNull();
    expect(screen.queryByText('Edit default')).toBeNull();
  });

  it('cannot load → says so, and Try again works', async () => {
    mockFail = new ApiError(500, 'request_failed');
    await open();
    expect(await screen.findByText("Couldn't load the budgets.")).toBeTruthy();
    mockFail = null;
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('November 2026 budget')).toBeTruthy();
  });
});

describe('helpers', () => {
  it('amountText: as you would type it', () => {
    expect(amountText(4_000_000)).toBe('40000');
    expect(amountText(450_050)).toBe('4500.50');
    expect(amountText(0)).toBe('0');
  });
  it('allocationSummary: over-allocation in words', () => {
    expect(allocationSummary({ allocatedMinor: 150, unallocatedMinor: -50, percentAllocated: 150 }, 100)).toBe('Over-allocated by ₱0.50');
  });
});
