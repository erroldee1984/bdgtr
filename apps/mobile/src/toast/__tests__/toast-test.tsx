/** In-app toast (docs/PLAN.md §6.12). */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TOAST_MS, type ToastInput, ToastProvider, useToast } from '../toast';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const NEAR: ToastInput = { level: 'near', title: 'Nearly at budget · Groceries', body: 'Dela Cruz household has used 92% of its ₱8,000 Groceries budget' };
const OVER: ToastInput = { level: 'over', title: 'Over the monthly budget', body: 'Dela Cruz household is over its ₱40,000 monthly budget by ₱1,150' };

function Show({ toasts }: { toasts: ToastInput[] }) {
  const { show } = useToast();
  useEffect(() => toasts.forEach(show), [show, toasts]);
  return null;
}

// Expo Router provides this in the app; a bare render needs it explicitly.
const METRICS = { frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };
const open = (toasts: ToastInput[]) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ToastProvider>
        <Show toasts={toasts} />
      </ToastProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(router.push).mockClear();
});
afterEach(() => jest.useRealTimers());

describe('toast', () => {
  it('"near" is announced politely (status), "over" urgently (alert)', async () => {
    await open([NEAR, OVER]);
    expect(screen.getByRole('status')).toHaveTextContent(/92% of its ₱8,000 Groceries budget/);
    expect(screen.getByRole('alert')).toHaveTextContent(/over its ₱40,000 monthly budget by ₱1,150/);
  });

  it('stays at least 10 seconds, then goes', async () => {
    await open([NEAR]);
    await act(async () => jest.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.queryByTestId('toast')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(1));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('pauses while focused (keyboard / screen reader) and restarts the full time after', async () => {
    await open([NEAR]);
    await act(async () => jest.advanceTimersByTime(9_000));
    await fireEvent(screen.getByLabelText('Dismiss'), 'focus');
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(screen.queryByTestId('toast')).toBeTruthy();
    await fireEvent(screen.getByLabelText('Dismiss'), 'blur');
    await act(async () => jest.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.queryByTestId('toast')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(1));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('pauses while hovered (mouse)', async () => {
    await open([NEAR]);
    await fireEvent(screen.getByTestId('toast'), 'hoverIn');
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(screen.queryByTestId('toast')).toBeTruthy();
  });

  it('Dismiss closes it at once', async () => {
    await open([NEAR]);
    await fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('View opens the Alerts tab and closes the toast', async () => {
    await open([OVER]);
    await fireEvent.press(screen.getByLabelText('View alerts'));
    expect(router.push).toHaveBeenCalledWith('/alerts');
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('shows at most 3 at once (the newest)', async () => {
    await open([
      { ...NEAR, title: 'one' },
      { ...NEAR, title: 'two' },
      { ...NEAR, title: 'three' },
      { ...NEAR, title: 'four' },
    ]);
    expect(screen.getAllByTestId('toast')).toHaveLength(3);
    expect(screen.queryByText('one')).toBeNull();
    expect(screen.getByText('four')).toBeTruthy();
  });

  it('useToast outside the provider does nothing (no crash)', async () => {
    await render(<Show toasts={[NEAR]} />);
    expect(screen.queryByTestId('toast')).toBeNull();
  });
});
