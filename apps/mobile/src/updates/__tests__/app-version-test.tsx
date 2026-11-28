/** Over-the-air updates in the Android app (docs/PLAN.md §2c). */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/toast/toast';
import { AppVersion, versionText } from '@/updates/app-version';
import { UPDATE_TITLE, UpdateReadyCard, UpdateReadyProvider } from '@/updates/update-ready';

const mockReload = jest.fn(async () => {});
type State = {
  currentlyRunning: { isEmbeddedLaunch: boolean; createdAt?: Date };
  isUpdatePending: boolean;
  downloadedUpdate?: { updateId: string };
};
let mockState: State;
jest.mock('expo-updates', () => ({ useUpdates: () => mockState, reloadAsync: () => mockReload() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.2' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.3' } } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const app = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ToastProvider>
      <UpdateReadyProvider>
        <UpdateReadyCard />
        <AppVersion />
      </UpdateReadyProvider>
    </ToastProvider>
  </SafeAreaProvider>
);
const idle = (): State => ({ currentlyRunning: { isEmbeddedLaunch: true }, isUpdatePending: false });
const pending = (updateId = 'u1'): State => ({
  currentlyRunning: { isEmbeddedLaunch: true },
  isUpdatePending: true,
  downloadedUpdate: { updateId },
});

beforeEach(() => {
  mockReload.mockClear();
  mockState = idle();
});

describe('versionText', () => {
  it('the APK as installed: just the version', () => {
    expect(versionText('1.0.2', true, new Date('2026-11-28T03:00:00Z'))).toBe('bdgtr 1.0.2');
  });
  it('running an update: says when it was published (Manila date)', () => {
    expect(versionText('1.0.2', false, new Date('2026-11-30T17:00:00Z'))).toBe('bdgtr 1.0.2, updated Dec 1, 2026');
  });
});

describe('update ready', () => {
  it('nothing downloaded: no growl, no card, just the version on More', async () => {
    await render(app());
    expect(screen.getByText('bdgtr 1.0.2')).toBeTruthy();
    expect(screen.queryByText(UPDATE_TITLE)).toBeNull();
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('downloaded: a growl with Restart, which restarts into the update', async () => {
    mockState = pending();
    await render(app());
    const toast = screen.getByTestId('toast');
    expect(toast).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Restart' })));
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toast')).toBeNull(); // the growl closes
  });

  it('downloaded: the Alerts card has Restart now too, and stays until the restart', async () => {
    mockState = pending();
    await render(app());
    expect(screen.getByTestId('update-ready')).toBeTruthy();
    // The card's and More's "Restart now" buttons both restart.
    const buttons = screen.getAllByRole('button', { name: 'Restart now' });
    expect(buttons).toHaveLength(2);
    await act(async () => fireEvent.press(buttons[0]!));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('one growl per update, not one per render', async () => {
    mockState = pending('u1');
    const r = await render(app());
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Dismiss' })));
    await r.rerender(app());
    expect(screen.queryByTestId('toast')).toBeNull();
    mockState = pending('u2'); // a newer update downloads
    await r.rerender(app());
    expect(screen.getByTestId('toast')).toBeTruthy();
  });

  it('a failed restart lets you try again', async () => {
    mockState = pending();
    mockReload.mockRejectedValueOnce(new Error('nope'));
    await render(app());
    const card = screen.getAllByRole('button', { name: 'Restart now' })[0]!;
    await act(async () => fireEvent.press(card));
    expect(screen.getAllByRole('button', { name: 'Restart now' })[0]!.props.accessibilityState).toMatchObject({ busy: false });
  });
});
