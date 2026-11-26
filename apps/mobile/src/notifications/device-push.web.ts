import { deviceLabelFromUserAgent } from '@bdgtr/shared';

import { fetchVapidKey, registerDevice, unregisterDevice } from '@/lib/api';

/**
 * Browser notifications (Web Push) for this device (docs/PLAN.md §2b).
 * The permission prompt only ever appears after a click (browsers require it).
 */

type GetToken = () => Promise<string | null>;
export type PushStatus = 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-install' | 'server-off';

const SW_PATH = '/sw.js';

function hasPushApis(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iPhone/iPad Safari only allows Web Push for a site added to the Home Screen. */
function isIosNotInstalled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return ios && !standalone;
}

/** Base64url (VAPID public key) → bytes for pushManager.subscribe. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!hasPushApis()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function label(): string {
  return deviceLabelFromUserAgent(navigator.userAgent);
}

async function send(getToken: GetToken, sub: PushSubscription): Promise<void> {
  const json = sub.toJSON() as { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } };
  await registerDevice(getToken, { kind: 'webpush', subscription: json, deviceLabel: label() });
}

export async function pushStatus(): Promise<PushStatus> {
  if (isIosNotInstalled()) return 'needs-install';
  if (!hasPushApis()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** Asks permission (call from a click), subscribes and registers this browser. */
export async function enablePush(getToken: GetToken): Promise<PushStatus> {
  const status = await pushStatus();
  if (status === 'unsupported' || status === 'needs-install' || status === 'blocked') return status;
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const key = await fetchVapidKey();
  if (!key) return 'server-off';
  const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) }));
  await send(getToken, sub);
  return 'on';
}

/** Turns notifications off for this browser: forget it on the server, then unsubscribe. */
export async function disablePush(getToken: GetToken): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await unregisterDevice(getToken, sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}

/**
 * On sign-in / app start: if this browser already has notifications on,
 * register it to whoever is signed in now (a shared computer never keeps
 * showing the previous person's alerts). Never throws.
 */
export async function syncPush(getToken: GetToken): Promise<void> {
  try {
    if (!hasPushApis() || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (sub) await send(getToken, sub);
  } catch {
    /* best effort */
  }
}

/** Before signing out: stop this browser receiving the account's alerts. Never throws. */
export async function forgetPushOnSignOut(getToken: GetToken): Promise<void> {
  try {
    await disablePush(getToken);
  } catch {
    /* best effort */
  }
}

/** Alerts the service worker passes to an open, focused page (shown as toasts). */
export function onForegroundAlert(handler: (alert: { level: 'near' | 'over'; title: string; body: string }) => void): () => void {
  if (!hasPushApis()) return () => {};
  const listener = (e: MessageEvent) => {
    const d = e.data as { type?: string; alert?: { level?: string; title?: unknown; body?: unknown } } | null;
    if (d?.type !== 'bdgtr-alert' || !d.alert || typeof d.alert.title !== 'string' || typeof d.alert.body !== 'string') return;
    handler({ level: d.alert.level === 'over' ? 'over' : 'near', title: d.alert.title, body: d.alert.body });
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}

/** Browsers: the service worker opens the alert's page itself (public/sw.js). */
export function onNotificationTap(_open: (path: string) => void): () => void {
  return () => {};
}
