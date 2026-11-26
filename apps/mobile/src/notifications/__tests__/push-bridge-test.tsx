/** PushBridge: keeps push pointed at whoever is signed in; foreground alerts → toast; a tap → Alerts. */
import { act, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { PushBridge } from '@/notifications/push-bridge';

jest.mock('@clerk/expo', () => {
  const auth = { isSignedIn: true, userId: 'u1', getToken: async () => 't' };
  return { useAuth: () => auth };
});

const mockShow = jest.fn();
jest.mock('@/toast/toast', () => {
  const toast = { show: (...a: unknown[]) => mockShow(...a) };
  return { useToast: () => toast };
});

const mockSync = jest.fn(async () => {});
let mockAlertHandler: ((a: unknown) => void) | null = null;
let mockTapHandler: ((path: string) => void) | null = null;
jest.mock('@/notifications/device-push', () => ({
  syncPush: (...a: unknown[]) => mockSync(...(a as [])),
  onForegroundAlert: (h: (a: unknown) => void) => {
    mockAlertHandler = h;
    return () => (mockAlertHandler = null);
  },
  onNotificationTap: (h: (path: string) => void) => {
    mockTapHandler = h;
    return () => (mockTapHandler = null);
  },
}));

function Home() {
  return (
    <>
      <PushBridge />
      <Text>Home</Text>
    </>
  );
}
function Alerts() {
  const { household } = useLocalSearchParams<{ household?: string }>();
  return <Text>{`Alerts for ${household}`}</Text>;
}

beforeEach(() => {
  mockShow.mockReset();
  mockSync.mockClear();
});

it('signed in → keeps this device registered to them', async () => {
  await renderRouter({ index: Home, alerts: Alerts }, { initialUrl: '/' });
  expect(mockSync).toHaveBeenCalledTimes(1);
});

it('an alert while the app is in front → a toast', async () => {
  await renderRouter({ index: Home, alerts: Alerts }, { initialUrl: '/' });
  const alert = { level: 'over', title: 'Over budget · Food', body: 'b' };
  await act(async () => mockAlertHandler!(alert));
  expect(mockShow).toHaveBeenCalledWith(alert);
});

it('tapping a phone notification opens the alerts for that household', async () => {
  await renderRouter({ index: Home, alerts: Alerts }, { initialUrl: '/' });
  await act(async () => mockTapHandler!('/alerts?household=h1'));
  expect(await screen.findByText('Alerts for h1')).toBeTruthy();
});
