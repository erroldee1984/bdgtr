/** More → Settings: notifications on this device, muting a household, your devices. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { SettingsScreen } from '@/settings/settings-screen';

jest.mock('@clerk/expo', () => {
  const auth = { isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' };
  return { useAuth: () => auth };
});
jest.mock('@/household/household-context', () => ({
  useHousehold: () => ({ active: { householdId: 'h1', householdName: 'Dela Cruz', role: 'member' } }),
}));

let mockStatus: string;
const mockEnable = jest.fn();
const mockDisable = jest.fn();
jest.mock('@/notifications/device-push', () => ({
  pushStatus: async () => mockStatus,
  enablePush: (...a: unknown[]) => mockEnable(...a),
  disablePush: (...a: unknown[]) => mockDisable(...a),
}));

let mockMuted = false;
let mockDevices: { id: string; kind: string; deviceLabel: string; createdAt: string; lastSeenAt: string }[];
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchMembershipSettings: async () => ({ alertsMuted: mockMuted, dailyDigestEnabled: true }),
  updateMembershipSettings: (...a: unknown[]) => mockUpdate(...a),
  fetchDevices: async () => mockDevices.map((d) => ({ ...d })),
  removeDevice: (...a: unknown[]) => mockRemove(...a),
}));

const dev = (id: string, label: string) => ({ id, kind: 'webpush', deviceLabel: label, createdAt: '2026-11-20T02:00:00.000Z', lastSeenAt: '2026-11-25T02:00:00.000Z' });

beforeEach(() => {
  mockStatus = 'off';
  mockMuted = false;
  mockDevices = [dev('d1', 'Chrome on Windows'), dev('d2', 'Firefox on Linux')];
  mockEnable.mockReset().mockImplementation(async () => {
    mockStatus = 'on';
    return 'on';
  });
  mockDisable.mockReset().mockImplementation(async () => {
    mockStatus = 'off';
  });
  mockUpdate.mockReset().mockImplementation(async (_t: unknown, _h: string, input: { alertsMuted: boolean }) => ({ alertsMuted: input.alertsMuted, dailyDigestEnabled: true }));
  mockRemove.mockReset().mockImplementation(async (_t: unknown, id: string) => {
    mockDevices = mockDevices.filter((d) => d.id !== id);
  });
});

const open = () => renderRouter({ index: SettingsScreen }, { initialUrl: '/' });

describe('Settings: this device', () => {
  it('off → Turn on asks the browser (from the click) and confirms', async () => {
    await open();
    await fireEvent.press(await screen.findByText('Turn on notifications'));
    expect(mockEnable).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Notifications turned on for this browser.')).toBeTruthy();
    expect(screen.getByText('Turn off on this browser')).toBeTruthy();
  });

  it('on → Turn off', async () => {
    mockStatus = 'on';
    await open();
    await fireEvent.press(await screen.findByText('Turn off on this browser'));
    expect(mockDisable).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Notifications turned off for this browser.')).toBeTruthy();
  });

  it.each([
    ['blocked', /blocking notifications from bdgtr/],
    ['needs-install', /add bdgtr to your Home Screen/],
    ['server-off', /aren’t set up on the server/],
  ])('%s → explains what to do, no button', async (status, text) => {
    mockStatus = status;
    await open();
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText('Turn on notifications')).toBeNull();
  });

  it('turning on fails → says so', async () => {
    mockEnable.mockRejectedValue(new TypeError('Network request failed'));
    await open();
    await fireEvent.press(await screen.findByText('Turn on notifications'));
    expect(await screen.findByText("Couldn't turn on notifications. Check your connection and try again.")).toBeTruthy();
  });

  it('the person declines in the browser prompt → explains how to allow it', async () => {
    mockEnable.mockResolvedValue('blocked');
    await open();
    await fireEvent.press(await screen.findByText('Turn on notifications'));
    expect(await screen.findByText(/blocking notifications from bdgtr/)).toBeTruthy();
  });
});

describe('Settings: mute this household', () => {
  it('shows the current setting and saves a change for this household only', async () => {
    await open();
    const toggle = await screen.findByLabelText('Mute notifications from Dela Cruz');
    await waitFor(() => expect(toggle.props.value).toBe(false));
    await fireEvent(toggle, 'valueChange', true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.any(Function), 'h1', { alertsMuted: true });
    await waitFor(() => expect(screen.getByLabelText('Mute notifications from Dela Cruz').props.value).toBe(true));
  });

  it('a failed save puts the switch back and says so', async () => {
    mockUpdate.mockRejectedValue(new TypeError('Network request failed'));
    await open();
    const toggle = await screen.findByLabelText('Mute notifications from Dela Cruz');
    await waitFor(() => expect(toggle.props.value).toBe(false));
    await fireEvent(toggle, 'valueChange', true);
    expect(await screen.findByText("Couldn't change that setting. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Mute notifications from Dela Cruz').props.value).toBe(false);
  });
});

describe('Settings: your devices', () => {
  it('lists your devices; Remove takes one off', async () => {
    await open();
    expect(await screen.findAllByTestId('device-row')).toHaveLength(2);
    await fireEvent.press(screen.getByLabelText('Remove Firefox on Linux'));
    await waitFor(() => expect(screen.queryByText('Firefox on Linux')).toBeNull());
    expect(mockRemove).toHaveBeenCalledWith(expect.any(Function), 'd2');
  });

  it('none yet says so', async () => {
    mockDevices = [];
    await open();
    expect(await screen.findByText('No devices get notifications yet.')).toBeTruthy();
  });
});
