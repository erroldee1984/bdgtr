/** More → Categories (docs/PLAN.md §6.4) against an in-memory fake server. */
import { fireEvent, screen, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { CategoriesManager } from '@/categories/categories-manager';
import { ApiError } from '@/lib/api-error';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});
let mockRole = 'owner';
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: { householdId: 'h1', householdName: 'Home', role: mockRole } }),
}));

// The real Screen scrolls; this one records scroll requests so the test can see them.
const mockScrollTo = jest.fn();
jest.mock('@/components/screen', () => {
  const { View, Text } = jest.requireActual('react-native');
  return {
    Screen: ({
      title,
      subtitle,
      children,
      scrollRef,
    }: {
      title: string;
      subtitle?: string;
      children: unknown;
      scrollRef?: { current: unknown };
    }) => {
      if (scrollRef) scrollRef.current = { scrollTo: mockScrollTo };
      return (
        <View>
          <Text>{title}</Text>
          {subtitle ? <Text>{subtitle}</Text> : null}
          {children}
        </View>
      );
    },
  };
});

type C = {
  id: string;
  name: string;
  icon: string;
  colour: string;
  defaultBudgetMinor: number;
  isRemoved: boolean;
  recentUseCount: number;
  kind?: 'normal' | 'unbudgeted';
};
let mockDb: C[];
let mockFailNext: unknown = null;
const mockCalls: string[] = [];
const mockMaybeFail = (name: string) => {
  mockCalls.push(name);
  if (mockFailNext) {
    const e = mockFailNext;
    mockFailNext = null;
    throw e;
  }
};
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  fetchCategories: async () => mockDb.map((c) => ({ ...c })),
  createCategory: async (_t: unknown, _h: string, input: Omit<C, 'id' | 'isRemoved' | 'recentUseCount'>) => {
    mockMaybeFail('create');
    const c = { ...input, id: String(mockDb.length + 1).padStart(24, 'f'), isRemoved: false, recentUseCount: 0 };
    mockDb.push(c);
    return c;
  },
  updateCategory: async (_t: unknown, _h: string, id: string, input: Partial<C>) => {
    mockMaybeFail('update');
    mockDb = mockDb.map((c) => (c.id === id ? { ...c, ...input } : c));
  },
  removeCategory: async (_t: unknown, _h: string, id: string) => {
    mockMaybeFail('remove');
    mockDb = mockDb.map((c) => (c.id === id ? { ...c, isRemoved: true } : c));
  },
  restoreCategory: async (_t: unknown, _h: string, id: string) => {
    mockMaybeFail('restore');
    mockDb = mockDb.map((c) => (c.id === id ? { ...c, isRemoved: false } : c));
  },
}));

beforeEach(() => {
  mockScrollTo.mockClear();
  mockRole = 'owner';
  mockFailNext = null;
  mockCalls.length = 0;
  mockDb = [
    {
      id: 'a'.repeat(24),
      name: 'Groceries',
      icon: 'cart',
      colour: '#4ADE80',
      defaultBudgetMinor: 1_000_000,
      isRemoved: false,
      recentUseCount: 0,
    },
    { id: 'b'.repeat(24), name: 'Transport', icon: 'car', colour: '#5A94FF', defaultBudgetMinor: 0, isRemoved: false, recentUseCount: 0 },
    { id: 'c'.repeat(24), name: 'Old stuff', icon: 'gift', colour: '#F472B6', defaultBudgetMinor: 0, isRemoved: true, recentUseCount: 0 },
  ];
});

const open = async () => {
  await renderRouter({ index: CategoriesManager }, { initialUrl: '/' });
  await screen.findByText('Groceries');
};
const row = (name: string) => screen.getAllByTestId('category-row').find((r) => within(r).queryByText(name))!;

describe('Categories (House Owner / Co-Owner)', () => {
  it('each row is centred between its dividers (regression: 24px above, 8px below)', async () => {
    await open();
    const els = screen.getAllByTestId('category-row');
    const rows = els.map((r) => StyleSheet.flatten(r.props.style));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const below = (r: (typeof rows)[number]) => r.paddingBottom ?? r.paddingVertical;
    const above = (r: (typeof rows)[number]) => r.paddingTop ?? r.paddingVertical;
    // Same space on both sides of each divider, and no extra gap between rows.
    for (let n = 0; n < rows.length - 1; n++) expect(below(rows[n]!)).toBe(above(rows[n + 1]!));
    expect(StyleSheet.flatten(els[0]!.parent!.props.style)?.gap ?? 0).toBe(0);
    expect(rows[0]!.paddingTop).toBe(0); // the card's own padding is above it
    expect(rows[rows.length - 1]).toMatchObject({ borderBottomWidth: 0, paddingBottom: 0 }); // no divider under the last
  });

  it('lists active categories with their default budgets; removed ones are hidden until asked', async () => {
    await open();
    expect(within(row('Groceries')).getByText('Default budget ₱10,000.00')).toBeTruthy();
    expect(within(row('Transport')).getByText('No default budget')).toBeTruthy();
    expect(screen.queryByText('Old stuff')).toBeNull();
    await fireEvent.press(screen.getByText('Show removed (1)'));
    expect(screen.getByText('Old stuff')).toBeTruthy();
  });

  it('adds a category with the chosen icon, colour and budget', async () => {
    await open();
    await fireEvent.press(screen.getByText('Add category'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Pets');
    await fireEvent.press(screen.getByLabelText('paw'));
    await fireEvent.press(screen.getByLabelText('Colour 5'));
    await fireEvent.changeText(screen.getByLabelText('Default monthly budget (optional)'), '2,000');
    await fireEvent.press(screen.getAllByText('Add category').at(-1)!);
    expect(await screen.findByText('Pets added.')).toBeTruthy();
    expect(mockDb.at(-1)).toMatchObject({ name: 'Pets', icon: 'paw', colour: '#C084FC', defaultBudgetMinor: 200_000 });
    expect(await screen.findByText('Default budget ₱2,000.00')).toBeTruthy();
  });

  it('edits a category (form starts with its current values)', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('Edit Groceries'));
    expect(screen.getByDisplayValue('10000.00')).toBeTruthy();
    await fireEvent.changeText(screen.getByDisplayValue('Groceries'), 'Food & groceries');
    await fireEvent.press(screen.getByText('Save changes'));
    expect(await screen.findByText('Food & groceries saved.')).toBeTruthy();
    expect(await screen.findByText('Food & groceries')).toBeTruthy();
  });

  it('remove asks first and explains past spending keeps it; Cancel keeps it', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('Remove Transport'));
    expect(screen.getByText(/Remove Transport\? Past spending keeps this category/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Cancel'));
    expect(mockCalls).not.toContain('remove');
    await fireEvent.press(screen.getByLabelText('Remove Transport'));
    await fireEvent.press(within(row('Transport')).getByText('Remove'));
    expect(await screen.findByText('Transport removed.')).toBeTruthy();
    expect(await screen.findByText('Show removed (2)')).toBeTruthy();
  });

  it('restores a removed category', async () => {
    await open();
    await fireEvent.press(screen.getByText('Show removed (1)'));
    await fireEvent.press(screen.getByLabelText('Restore Old stuff'));
    expect(await screen.findByText('Old stuff restored.')).toBeTruthy();
    expect(await screen.findByLabelText('Edit Old stuff')).toBeTruthy();
  });

  it.each([
    [new ApiError(409, 'category_exists'), 'A category with this name already exists.'],
    [new TypeError('Network request failed'), "Couldn't save. Check your connection and try again."],
  ])('saving fails with %s → explains it and keeps the form', async (err, message) => {
    await open();
    mockFailNext = err;
    await fireEvent.press(screen.getByText('Add category'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'groceries');
    await fireEvent.press(screen.getAllByText('Add category').at(-1)!);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByDisplayValue('groceries')).toBeTruthy();
  });

  it('form problems are explained before anything is sent', async () => {
    await open();
    await fireEvent.press(screen.getByText('Add category'));
    await fireEvent.changeText(screen.getByLabelText('Default monthly budget (optional)'), 'abc');
    await fireEvent.press(screen.getAllByText('Add category').at(-1)!);
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(screen.getByText('Enter an amount like 5,000 or 5000.50')).toBeTruthy();
    expect(mockCalls).not.toContain('create');
  });

  it('the built-in Unbudgeted category: explained, with no Edit or Remove (it can’t be removed or renamed)', async () => {
    mockDb = [
      ...mockDb,
      {
        id: 'u'.repeat(24),
        name: 'Unbudgeted',
        icon: 'dots-horizontal',
        colour: '#FF6B6B',
        defaultBudgetMinor: 0,
        isRemoved: false,
        recentUseCount: 0,
        kind: 'unbudgeted',
      },
    ];
    await open();
    expect(screen.getByText('Unbudgeted')).toBeTruthy();
    expect(screen.getByText(/^Built in: gets whatever the monthly budget doesn’t give the other categories/)).toBeTruthy();
    expect(screen.queryByLabelText('Edit Unbudgeted')).toBeNull();
    expect(screen.queryByLabelText('Remove Unbudgeted')).toBeNull();
    expect(screen.getByLabelText('Remove Groceries')).not.toBeDisabled(); // the others can go
  });

  it('if the server refuses because it would be the last one (someone else removed the other), it says so', async () => {
    await open();
    mockFailNext = new ApiError(409, 'last_category');
    await fireEvent.press(screen.getByLabelText('Remove Transport'));
    await fireEvent.press(within(row('Transport')).getByText('Remove'));
    expect(await screen.findByText('A household needs at least one category, so the last one can’t be removed.')).toBeTruthy();
  });
});

describe('Categories: the form is brought into view', () => {
  it('Edit on a category further down scrolls to the form at the top and focuses its Name field', async () => {
    await open();
    expect(mockScrollTo).not.toHaveBeenCalled(); // opening the screen doesn't jump
    await fireEvent.press(screen.getByLabelText('Edit Transport'));
    expect(mockScrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
    const name = screen.getByLabelText('Name');
    expect(name.props.value).toBe('Transport');
    expect(name.props.autoFocus).toBe(true);
  });

  it('switching to Edit another category scrolls up again and focuses the new form', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('Edit Transport'));
    await fireEvent.press(screen.getByLabelText('Edit Groceries'));
    expect(mockScrollTo).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Name').props.value).toBe('Groceries');
  });

  it('Add category does the same', async () => {
    await open();
    await fireEvent.press(screen.getByText('Add category'));
    expect(mockScrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
    expect(screen.getByLabelText('Name').props.autoFocus).toBe(true);
  });

  it('closing the form (Cancel) does not scroll', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('Edit Transport'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(mockScrollTo).toHaveBeenCalledTimes(1);
  });
});

describe('Categories (House Member)', () => {
  it('read-only: no add, edit, remove or restore', async () => {
    mockRole = 'member';
    await open();
    expect(screen.getByText('Only the House Owner or a Co-Owner can change these.')).toBeTruthy();
    expect(screen.queryByText('Add category')).toBeNull();
    expect(screen.queryByLabelText(/^Edit /)).toBeNull();
    expect(screen.queryByLabelText(/^Remove /)).toBeNull();
    await fireEvent.press(screen.getByText('Show removed (1)'));
    expect(screen.queryByLabelText('Restore Old stuff')).toBeNull();
  });
});
