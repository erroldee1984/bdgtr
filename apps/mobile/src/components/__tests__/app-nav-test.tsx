import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { windowClassFor } from '@/layout/window-class';

import { AppNav } from '../app-nav';

// A tiny live store so changing the simulated width re-renders like a real fold/unfold.
let mockClass = windowClassFor(384);
const mockListeners = new Set<() => void>();
jest.mock('@/layout/window-class', () => ({
  ...jest.requireActual('@/layout/window-class'),
  useWindowClass: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
    require('react').useSyncExternalStore(
      (cb: () => void) => {
        mockListeners.add(cb);
        return () => mockListeners.delete(cb);
      },
      () => mockClass,
    ),
}));

/** Simulates the screen width; the width→class mapping itself is tested in window-class-test. */
function mockWidth(width: number) {
  mockClass = windowClassFor(width);
  mockListeners.forEach((cb) => cb());
}

let mounts = 0;
function CounterScreen() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    mounts += 1;
  }, []);
  return (
    <Pressable role="button" aria-label="Increment" onPress={() => setCount((c) => c + 1)}>
      <Text>Count {count}</Text>
    </Pressable>
  );
}

function renderNav(initialUrl = '/') {
  return renderRouter(
    {
      '(tabs)/_layout': () => <AppNav />,
      '(tabs)/index': () => <Text>Dashboard screen</Text>,
      '(tabs)/spend': () => <Text>Spend screen</Text>,
      '(tabs)/alerts': () => <Text>Alerts screen</Text>,
      '(tabs)/more': () => <Text>More screen</Text>,
      add: () => <Text>Add spend screen</Text>,
    },
    { initialUrl },
  );
}

afterEach(() => jest.restoreAllMocks());

describe('AppNav', () => {
  it('shows the four destinations as accessible tabs with Home selected', async () => {
    mockWidth(384); // Galaxy S24 FE
    await renderNav();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(['Home', 'Spend', 'Alerts', 'More']);
    expect(screen.getByRole('tab', { name: 'Home', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Spend', selected: false })).toBeTruthy();
    expect(screen.getByText('Dashboard screen')).toBeTruthy();
  });

  it('switches screens and selected state when a tab is pressed', async () => {
    mockWidth(384);
    await renderNav();

    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: 'Spend' }));
    });

    expect(screen.getByText('Spend screen')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Spend', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Home', selected: false })).toBeTruthy();
  });

  it('phones get a floating "Add spend" button and no side rail', async () => {
    mockWidth(360); // Fold 6 cover screen
    await renderNav();

    expect(screen.getAllByRole('button', { name: 'Add spend' })).toHaveLength(1);
    expect(screen.queryByText('bdgtr')).toBeNull(); // rail header only on wide screens
  });

  it.each([
    [707, 'unfolded Fold 6, portrait'],
    [823, 'unfolded Fold 6, landscape'],
    [1440, 'desktop browser'],
  ])('%i dp (%s) gets the side rail with its own Add spend button', async (width) => {
    mockWidth(width);
    await renderNav();

    expect(screen.getByText('bdgtr')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add spend' })).toHaveLength(1);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('folding and unfolding switches bar ↔ rail live without losing screen state', async () => {
    mockWidth(360); // folded: cover screen
    mounts = 0;
    await renderRouter(
      {
        '(tabs)/_layout': () => <AppNav />,
        '(tabs)/index': CounterScreen,
        '(tabs)/spend': () => <Text>Spend screen</Text>,
        '(tabs)/alerts': () => <Text>Alerts screen</Text>,
        '(tabs)/more': () => <Text>More screen</Text>,
      },
      { initialUrl: '/' },
    );

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Increment' }));
      fireEvent.press(screen.getByRole('button', { name: 'Increment' }));
    });
    expect(screen.getByText('Count 2')).toBeTruthy();
    expect(screen.queryByText('bdgtr')).toBeNull();

    await act(async () => mockWidth(707)); // unfold
    expect(screen.getByText('bdgtr')).toBeTruthy(); // rail header appeared
    expect(screen.getByText('Count 2')).toBeTruthy(); // state kept

    await act(async () => mockWidth(360)); // fold again
    expect(screen.queryByText('bdgtr')).toBeNull();
    expect(screen.getByText('Count 2')).toBeTruthy();
    expect(mounts).toBe(1); // the screen was never remounted
  });

  it('opens the Add spend screen from the floating button', async () => {
    mockWidth(384);
    await renderNav();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Add spend' }));
    });

    expect(screen.getByText('Add spend screen')).toBeTruthy();
  });

  it('deep links straight to a tab and marks it selected', async () => {
    mockWidth(384);
    await renderNav('/alerts');

    expect(screen.getByText('Alerts screen')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Alerts', selected: true })).toBeTruthy();
  });

  it('every tab meets the 48dp minimum touch target', async () => {
    mockWidth(384);
    await renderNav();

    for (const tab of screen.getAllByRole('tab')) {
      const style = [tab.props.style].flat(Infinity).reduce((acc, s) => ({ ...acc, ...(s || {}) }), {});
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
      expect(style.minWidth).toBeGreaterThanOrEqual(48);
    }
  });
});
