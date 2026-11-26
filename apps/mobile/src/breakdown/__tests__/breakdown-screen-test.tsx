/** Spend tab: Monthly Spend Breakdown (docs/PLAN.md §6.8). */
import type { Category, Transaction } from '@bdgtr/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { BreakdownScreen, deleteProblem, listSummary } from '@/breakdown/breakdown-screen';
import { ApiError } from '@/lib/api-error';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});

let mockRole = 'owner';
let mockWindowClass = 'medium';
jest.mock('@/layout/window-class', () => ({
  ...jest.requireActual('@/layout/window-class'),
  useWindowClass: () => mockWindowClass,
}));
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: { householdId: 'h1', householdName: 'Dela Cruz', role: mockRole } }),
}));

/** Swipes can't be dragged in Jest: record each row's Swipeable props and call them directly. */
const mockSwipeables: { onSwipeableOpen: (d: string) => void; renderRightActions?: unknown }[] = [];
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  const Swipeable = forwardRef((props: { children: ReactNode; onSwipeableOpen: (d: string) => void; renderRightActions?: unknown }, ref: unknown) => {
    useImperativeHandle(ref, () => ({ close: () => {}, openLeft: () => {}, openRight: () => {}, reset: () => {} }));
    mockSwipeables.push(props);
    return props.children;
  });
  return { __esModule: true, default: Swipeable, SwipeDirection: { LEFT: 'left', RIGHT: 'right' } };
});

const id = (n: number) => n.toString(16).padStart(24, '0');
const mockGroceries: Category = { id: id(100), name: 'Groceries', icon: 'cart', colour: '#5A94FF', defaultBudgetMinor: 0, isRemoved: false, recentUseCount: 0 };
const mockBills: Category = { id: id(101), name: 'Bills', icon: 'flash', colour: '#4ADE80', defaultBudgetMinor: 0, isRemoved: true, recentUseCount: 0 };

function tx(n: number, date: string, amountMinor: number, cat: Category, opts: Partial<Transaction> = {}): Transaction {
  return {
    id: id(n),
    clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    date,
    yearMonth: date.slice(0, 7),
    categoryId: cat.id,
    amountMinor,
    description: null,
    createdBy: 'c'.repeat(24),
    isYours: true,
    ...opts,
  };
}

let mockTxs: Transaction[];
let mockDeleteError: Error | null;
let mockLoadError: Error | null;
const mockDeleted: string[] = [];
jest.mock('@/lib/api', () => {
  const { ApiError: E } = jest.requireActual('@/lib/api-error');
  return {
    ApiError: E,
    fetchTransactions: async (_t: unknown, _h: string, month: string) => {
      if (mockLoadError) throw mockLoadError;
      return mockTxs.filter((t) => t.yearMonth === month);
    },
    fetchCategories: async () => [mockGroceries, mockBills],
    deleteTransaction: async (_t: unknown, _h: string, txId: string) => {
      if (mockDeleteError) throw mockDeleteError;
      mockDeleted.push(txId);
      mockTxs = mockTxs.filter((t) => t.id !== txId);
    },
  };
});

const A = tx(1, '2026-11-03', 50_000, mockGroceries, { description: 'Weekly market run' });
const B = tx(2, '2026-11-10', 12_000, mockBills, { isYours: false });
const C = tx(3, '2026-11-12', 90_000, mockGroceries);
const D = tx(4, '2026-11-01', 30_000, mockGroceries, { isYours: false });

afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  mockRole = 'owner';
  mockWindowClass = 'medium';
  mockTxs = [A, B, C, D];
  mockDeleteError = null;
  mockLoadError = null;
  mockDeleted.length = 0;
  mockSwipeables.length = 0;
  await AsyncStorage.clear();
});

function Other() {
  return <View />;
}
async function open(month = '2026-11') {
  await renderRouter({ spend: BreakdownScreen, index: Other }, { initialUrl: `/spend?month=${month}` });
  await screen.findByText(/spends? ·|Showing|No spends/);
}
const rowLabels = () => screen.getAllByRole('button', { name: /^Nov \d+, / }).map((r) => r.props.accessibilityLabel as string);
const row = (name: RegExp) => screen.getByRole('button', { name });
const action = (el: ReturnType<typeof row>, actionName: string) => fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName } });

describe('the list', () => {
  it('Date · Category · Cost, newest first, with a count and total', async () => {
    await open();
    expect(rowLabels()).toEqual([
      'Nov 12, Groceries, ₱900.00',
      'Nov 10, Bills, ₱120.00',
      'Nov 3, Groceries, ₱500.00',
      'Nov 1, Groceries, ₱300.00',
    ]);
    expect(screen.getByText('4 spends · ₱1,820.00')).toBeTruthy();
  });

  it('tap a row → its description; without one → "No description"', async () => {
    await open();
    await fireEvent.press(row(/^Nov 3,/));
    expect(screen.getByText('Groceries · ₱500.00')).toBeTruthy();
    expect(screen.getByText('Weekly market run')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.press(row(/^Nov 12,/));
    expect(screen.getByText('No description')).toBeTruthy();
  });

  it('an empty month says so', async () => {
    await open('2026-10');
    expect(screen.getByText('No spends this month.')).toBeTruthy();
  });

  it('a failed load offers Try again', async () => {
    mockLoadError = new ApiError(500, 'boom');
    await renderRouter({ spend: BreakdownScreen, index: Other }, { initialUrl: '/spend?month=2026-11' });
    expect(await screen.findByText("Couldn't load the spends.")).toBeTruthy();
    mockLoadError = null;
    mockTxs = [A];
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 spend · ₱500.00')).toBeTruthy();
  });
});

describe('pins (this device only)', () => {
  it('pin via the screen-reader action → first, under "Pinned", stored per user and household', async () => {
    await open();
    await action(row(/^Nov 1,/), 'pin');
    expect(rowLabels()[0]).toBe('Nov 1, Groceries, ₱300.00, pinned');
    expect(screen.getByRole('heading', { name: 'Pinned' })).toBeTruthy();
    expect(screen.getByText('Pinned to the top.')).toBeTruthy();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('pins:u:h1'))!)).toEqual({ [D.id]: '2026-11' }));
  });

  it('swipe right toggles the pin, no confirmation', async () => {
    await open();
    const i = rowLabels().indexOf('Nov 3, Groceries, ₱500.00');
    await act(async () => mockSwipeables.at(-4 + i)!.onSwipeableOpen('right'));
    expect(rowLabels()[0]).toBe('Nov 3, Groceries, ₱500.00, pinned');
    await act(async () => mockSwipeables.at(-4)!.onSwipeableOpen('right'));
    expect(rowLabels()[0]).toBe('Nov 12, Groceries, ₱900.00');
    expect(await AsyncStorage.getItem('pins:u:h1')).toBeNull(); // nothing pinned → key removed
  });

  it('pins survive a reload; ones for spends no longer in the month are pruned, other months kept', async () => {
    await AsyncStorage.setItem('pins:u:h1', JSON.stringify({ [C.id]: '2026-11', [id(99)]: '2026-11', [id(98)]: '2026-10' }));
    await open();
    expect(rowLabels()[0]).toBe('Nov 12, Groceries, ₱900.00, pinned');
    await waitFor(async () =>
      expect(JSON.parse((await AsyncStorage.getItem('pins:u:h1'))!)).toEqual({ [C.id]: '2026-11', [id(98)]: '2026-10' }),
    );
  });

  it('filters still apply to pinned rows', async () => {
    await AsyncStorage.setItem('pins:u:h1', JSON.stringify({ [C.id]: '2026-11' }));
    await open();
    await fireEvent.press(screen.getByRole('button', { name: /^Filters and sort/ }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Bills (removed)' }));
    expect(rowLabels()).toEqual(['Nov 10, Bills, ₱120.00']);
    expect(screen.queryByRole('heading', { name: 'Pinned' })).toBeNull();
  });
});

describe('delete', () => {
  it('swipe left asks first; Delete removes it and its pin', async () => {
    await AsyncStorage.setItem('pins:u:h1', JSON.stringify({ [A.id]: '2026-11' }));
    await open();
    await act(async () => mockSwipeables.at(-4)!.onSwipeableOpen('left')); // pinned A is first
    expect(screen.getByText('Delete this spend?')).toBeTruthy();
    expect(screen.getByText('Nov 3 · Groceries · ₱500.00')).toBeTruthy();
    expect(mockDeleted).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockDeleted).toEqual([A.id]));
    expect(screen.getByText('Deleted Groceries ₱500.00.')).toBeTruthy();
    expect(rowLabels()).toHaveLength(3);
    expect(await AsyncStorage.getItem('pins:u:h1')).toBeNull();
  });

  it('Cancel keeps it', async () => {
    await open();
    await action(row(/^Nov 12,/), 'delete');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockDeleted).toEqual([]);
    expect(rowLabels()).toHaveLength(4);
  });

  it('a refused delete explains why and keeps the row', async () => {
    mockDeleteError = new ApiError(500, 'boom');
    await open();
    await action(row(/^Nov 12,/), 'delete');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText("Couldn't delete. Check your connection and try again.")).toBeTruthy();
    expect(rowLabels()).toHaveLength(4);
  });

  it('House Member: only their own rows can be deleted (no swipe, no action, no menu item)', async () => {
    mockRole = 'member';
    await open();
    const actionsOf = (name: RegExp) => (row(name).props.accessibilityActions as { name: string }[]).map((a) => a.name);
    expect(actionsOf(/^Nov 12,/)).toEqual(['activate', 'pin', 'delete']); // theirs
    expect(actionsOf(/^Nov 10,/)).toEqual(['activate', 'pin']); // someone else's
    const swipes = mockSwipeables.slice(-4);
    expect(swipes.map((s) => typeof s.renderRightActions)).toEqual(['function', 'undefined', 'function', 'undefined']);
    await act(async () => swipes[1]!.onSwipeableOpen('left'));
    expect(screen.queryByText('Delete this spend?')).toBeNull();
    await fireEvent(row(/^Nov 10,/), 'longPress');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByText(/Only the person who entered this spend/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pin' }));
    expect(rowLabels()[0]).toBe('Nov 10, Bills, ₱120.00, pinned'); // pinning works for everyone
  });

  it('House Owner can delete anyone’s row', async () => {
    await open();
    expect(mockSwipeables.slice(-4).every((s) => typeof s.renderRightActions === 'function')).toBe(true);
  });
});

describe('long-press menu', () => {
  it('offers description, pin and delete', async () => {
    await open();
    await fireEvent(row(/^Nov 3,/), 'longPress');
    expect(screen.getByText('Nov 3 · Groceries · ₱500.00')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Show description' }));
    expect(screen.getByText('Weekly market run')).toBeTruthy();
  });

  it('Delete from the menu still asks for confirmation', async () => {
    await open();
    await fireEvent(row(/^Nov 3,/), 'longPress');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this spend?')).toBeTruthy();
  });
});

describe('non-swipe ways in', () => {
  it('phones (Android, compact): swipe hint, no "⋯" buttons', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockWindowClass = 'compact';
    await open();
    expect(screen.getByText('Swipe right to pin, left to delete. Press and hold for more.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^More actions for/ })).toBeNull();
  });

  it('wide screens: a visible "⋯" button opens the menu', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await open();
    expect(screen.queryByText(/Swipe right to pin/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'More actions for Nov 3, Groceries, ₱500.00' }));
    expect(screen.getByText('Nov 3 · Groceries · ₱500.00')).toBeTruthy();
  });

  it('web: "⋯" even on a narrow window, and right-click opens the menu instead of the browser’s', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    mockWindowClass = 'compact';
    await open();
    expect(screen.getAllByRole('button', { name: /^More actions for/ })).toHaveLength(4);
    const preventDefault = jest.fn();
    await fireEvent(row(/^Nov 3,/), 'contextMenu', { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(screen.getByText('Nov 3 · Groceries · ₱500.00')).toBeTruthy();
  });
});

describe('filters and sort', () => {
  it('categories (multi) AND a ₱ range; the count shows', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: /^Filters and sort/ }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Groceries' }));
    expect(rowLabels()).toHaveLength(3);
    await fireEvent.changeText(screen.getByLabelText('Min'), '400');
    expect(rowLabels()).toEqual(['Nov 12, Groceries, ₱900.00', 'Nov 3, Groceries, ₱500.00']);
    expect(screen.getByText('Showing 2 of 4 · ₱1,400.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: /2 filters on/ })).toBeTruthy();
  });

  it('min above max is flagged and ignored', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: /^Filters and sort/ }));
    await fireEvent.changeText(screen.getByLabelText('Min'), '800');
    await fireEvent.changeText(screen.getByLabelText('Max'), '100');
    expect(screen.getByText('Max must be at least the min amount')).toBeTruthy();
    expect(rowLabels()).toHaveLength(4);
  });

  it('nothing matching → a message and Clear filters', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: /^Filters and sort/ }));
    await fireEvent.changeText(screen.getByLabelText('Min'), '5000');
    expect(screen.getByText('No spends match these filters.')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(rowLabels()).toHaveLength(4);
  });

  it('sort by cost, then flip the order', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: /^Filters and sort/ }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Cost' }));
    expect(rowLabels().map((l) => l.split(', ')[2])).toEqual(['₱900.00', '₱500.00', '₱300.00', '₱120.00']);
    await fireEvent.press(screen.getByRole('button', { name: 'Order: Highest first. Change' }));
    expect(rowLabels().map((l) => l.split(', ')[2])).toEqual(['₱120.00', '₱300.00', '₱500.00', '₱900.00']);
  });
});

describe('helpers', () => {
  it('summary wording', () => {
    expect(listSummary(1, 1, 500)).toBe('1 spend · ₱5.00');
    expect(listSummary(2, 5, 500)).toBe('Showing 2 of 5 · ₱5.00');
  });
  it('delete problems', () => {
    expect(deleteProblem(new ApiError(403, 'forbidden'))).toBe('You can only delete spends you entered.');
    expect(deleteProblem(new ApiError(404, 'not_found'))).toBe('That spend was already deleted.');
  });
});
