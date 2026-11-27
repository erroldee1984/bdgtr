/** Over-the-air updates in the Android app (docs/PLAN.md §2c). */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { AppVersion, versionText } from '@/updates/app-version';

const mockReload = jest.fn(async () => {});
let mockState = { currentlyRunning: { isEmbeddedLaunch: true, createdAt: undefined as Date | undefined }, isUpdatePending: false };
jest.mock('expo-updates', () => ({ useUpdates: () => mockState, reloadAsync: () => mockReload() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.2' } } }));

describe('versionText', () => {
  it('the APK as installed: just the version', () => {
    expect(versionText('1.0.2', true, new Date('2026-11-28T03:00:00Z'))).toBe('bdgtr 1.0.2');
  });
  it('running an update: says when it was published (Manila date)', () => {
    expect(versionText('1.0.2', false, new Date('2026-11-30T17:00:00Z'))).toBe('bdgtr 1.0.2, updated Dec 1, 2026');
  });
});

describe('AppVersion', () => {
  beforeEach(() => mockReload.mockClear());

  it('no update waiting: shows the version only', async () => {
    mockState = { currentlyRunning: { isEmbeddedLaunch: true, createdAt: undefined }, isUpdatePending: false };
    await render(<AppVersion />);
    expect(screen.getByText('bdgtr 1.0.2')).toBeTruthy();
    expect(screen.queryByText(/An update is ready/)).toBeNull();
  });

  it('update downloaded: says so, and Restart now applies it', async () => {
    mockState = { currentlyRunning: { isEmbeddedLaunch: true, createdAt: undefined }, isUpdatePending: true };
    await render(<AppVersion />);
    expect(screen.getByText(/An update is ready/)).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Restart now' })));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});
