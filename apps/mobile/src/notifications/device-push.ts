import { ANDROID_ALERT_CHANNEL } from '@bdgtr/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { registerDevice, unregisterDevice } from '@/lib/api';

/**
 * Phone notifications (Android, Expo push → Firebase Cloud Messaging) for this
 * device (docs/PLAN.md §2b). Same interface as device-push.web.ts.
 *
 * "On" means: Android allows bdgtr's notifications AND this phone's Expo push
 * token is registered to whoever is signed in (remembered in secure storage).
 */

type GetToken = () => Promise<string | null>;
export type PushStatus = 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-install' | 'server-off';
export type ForegroundAlert = { level: 'near' | 'over'; title: string; body: string };

/** The Expo push token this phone registered for the signed-in person. */
export const PUSH_TOKEN_KEY = 'bdgtr.expoPushToken';

function supported(): boolean {
  return Platform.OS === 'android' && Device.isDevice;
}

async function rememberedToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function forgetToken(): Promise<void> {
  await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => {});
}

/** e.g. "Samsung SM-A546E" or "Google Pixel 8". Never the phone's personal name. */
export function phoneLabel(manufacturer: string | null, model: string | null): string {
  const maker = (manufacturer ?? '').trim();
  const name = (model ?? '').trim();
  const label = name.toLowerCase().startsWith(maker.toLowerCase()) ? name : `${maker.charAt(0).toUpperCase()}${maker.slice(1)} ${name}`;
  const clean = label.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return (clean || 'Android phone').slice(0, 60);
}

/** Android 13+ shows the permission prompt only once a channel exists. */
async function ensureChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(ANDROID_ALERT_CHANNEL, {
    name: 'Budget alerts',
    description: 'When a category or the whole household is nearly at or over its budget',
    importance: AndroidImportance.HIGH,
  });
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Registers this phone's (current) token for whoever is signed in; drops an old one. */
async function register(getToken: GetToken): Promise<void> {
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
  const previous = await rememberedToken();
  await registerDevice(getToken, {
    kind: 'expo',
    expoPushToken: token,
    deviceLabel: phoneLabel(Device.manufacturer, Device.modelName),
  });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  if (previous && previous !== token) await unregisterDevice(getToken, previous).catch(() => {});
}

export async function pushStatus(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return permission.canAskAgain ? 'off' : 'blocked';
  return (await rememberedToken()) ? 'on' : 'off';
}

/** Asks Android's permission (from a tap in Settings) and registers this phone. */
export async function enablePush(getToken: GetToken): Promise<PushStatus> {
  const status = await pushStatus();
  if (status === 'unsupported' || status === 'blocked') return status;
  await ensureChannel();
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return permission.canAskAgain ? 'off' : 'blocked';
  await register(getToken);
  return 'on';
}

/**
 * "Turn off on this phone": the server forgets it. Throws if the server can't
 * be reached (the phone would otherwise keep getting alerts); Settings says so.
 */
export async function disablePush(getToken: GetToken): Promise<void> {
  const token = await rememberedToken();
  if (token) await unregisterDevice(getToken, token);
  await forgetToken();
}

/**
 * After signing in (and on each app start): keeps a phone that's switched on
 * pointed at whoever is signed in, and picks up a new token if FCM rotated it.
 * Never throws.
 */
export async function syncPush(getToken: GetToken): Promise<void> {
  try {
    if ((await pushStatus()) !== 'on') return;
    await register(getToken);
  } catch {
    /* best effort */
  }
}

/**
 * Before signing out: stop this phone receiving the account's alerts. If the
 * server can't be reached, the phone's push registration is dropped instead,
 * so the server will find it gone at the next alert. Never throws.
 */
export async function forgetPushOnSignOut(getToken: GetToken): Promise<void> {
  const token = await rememberedToken();
  if (!token) return;
  try {
    await unregisterDevice(getToken, token);
  } catch {
    await Notifications.unregisterForNotificationsAsync().catch(() => {});
  }
  await forgetToken();
}

type AlertData = { type?: unknown; level?: unknown; url?: unknown };

function asAlert(content: Notifications.NotificationContent): ForegroundAlert | null {
  const data = (content.data ?? {}) as AlertData;
  if (data.type !== 'alert' || typeof content.title !== 'string' || typeof content.body !== 'string') return null;
  return { level: data.level === 'over' ? 'over' : 'near', title: content.title, body: content.body };
}

/** Only a path inside the app (never another site or app). */
function safePath(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
}

/**
 * Alerts that arrive while bdgtr is open and in front: shown as an in-app
 * toast instead of a duplicate system notification (they're in the Alerts tab too).
 */
export function onForegroundAlert(handler: (alert: ForegroundAlert) => void): () => void {
  if (!supported()) return () => {};
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  const sub = Notifications.addNotificationReceivedListener((n) => {
    const alert = asAlert(n.request.content);
    if (alert) handler(alert);
  });
  return () => sub.remove();
}

/**
 * Tapping a notification: open where it points (the Alerts tab for that
 * household), including when the tap launched the app.
 */
export function onNotificationTap(open: (path: string) => void): () => void {
  if (!supported()) return () => {};
  let handled: string | null = null; // the tap that launched the app can also reach the listener
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    if (response.notification.request.identifier === handled) return;
    handled = response.notification.request.identifier;
    const path = safePath((response.notification.request.content.data as AlertData | undefined)?.url);
    if (path) open(path);
  };
  let live = true;
  void Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      if (!live || !r) return;
      handle(r);
      return Notifications.clearLastNotificationResponseAsync();
    })
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => {
    live = false;
    sub.remove();
  };
}
