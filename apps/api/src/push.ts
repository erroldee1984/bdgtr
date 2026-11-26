import { ANDROID_ALERT_CHANNEL, deviceAddress, type Device, type PushPayload, type RegisterDeviceInput } from '@bdgtr/shared';
import { type Db, ObjectId } from 'mongodb';
import { sendNotification, WebPushError } from 'web-push';

import type { AlertDoc } from './alerts.js';
import type { HouseholdDoc, MembershipDoc } from './households.js';
import { MEMBERSHIPS } from './households.js';

/** docs/PLAN.md §4 pushSubscriptions: one row per device (browser or phone). */
export interface PushSubscriptionDoc {
  _id: ObjectId;
  userId: ObjectId;
  kind: 'webpush' | 'expo';
  /** The device's address: a browser's push endpoint, or the app's Expo push token. */
  endpoint: string;
  /** Browsers only. */
  keys?: { p256dh: string; auth: string };
  deviceLabel: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export const PUSH_SUBSCRIPTIONS = 'pushSubscriptions';
/** Abuse guard: devices per person. */
export const MAX_DEVICES_PER_USER = 20;

export async function ensurePushIndexes(db: Db): Promise<void> {
  await db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).createIndexes([
    { key: { endpoint: 1 }, unique: true, name: 'endpoint_unique' },
    { key: { userId: 1 }, name: 'user' },
  ]);
}

export function toDevice(d: PushSubscriptionDoc): Device {
  return {
    id: d._id.toHexString(),
    kind: d.kind,
    deviceLabel: d.deviceLabel,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
  };
}

/**
 * Registers this browser or phone for the signed-in person. The same device
 * re-registering updates its row; a device last used by someone else
 * (a shared computer or phone) now belongs to whoever signed in.
 */
export async function registerDevice(db: Db, userId: ObjectId, input: RegisterDeviceInput, now: Date): Promise<PushSubscriptionDoc> {
  const endpoint = deviceAddress(input);
  const set: Partial<PushSubscriptionDoc> = { userId, kind: input.kind, deviceLabel: input.deviceLabel, lastSeenAt: now };
  if (input.kind === 'webpush') set.keys = input.subscription!.keys;
  const doc = await db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).findOneAndUpdate(
    { endpoint },
    { $set: set, $setOnInsert: { endpoint, createdAt: now } },
    { upsert: true, returnDocument: 'after' },
  );
  return doc!;
}

export async function countDevices(db: Db, userId: ObjectId): Promise<number> {
  return db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).countDocuments({ userId });
}

export async function listDevices(db: Db, userId: ObjectId): Promise<PushSubscriptionDoc[]> {
  return db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).find({ userId }).sort({ createdAt: 1 }).toArray();
}

/** Only your own devices. */
export async function removeDevice(db: Db, userId: ObjectId, id: ObjectId): Promise<boolean> {
  const res = await db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).deleteOne({ _id: id, userId });
  return res.deletedCount === 1;
}

export type SendResult = 'sent' | 'gone' | 'failed';
/** Delivers one notification to one device. Never throws. */
export type PushSender = (device: PushSubscriptionDoc, payload: PushPayload) => Promise<SendResult>;

/** Web Push sender (VAPID). 404/410 from the push service = the subscription is gone. */
export function createWebPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): PushSender {
  return async (device, payload) => {
    try {
      if (!device.keys) return 'failed';
      await sendNotification({ endpoint: device.endpoint, keys: device.keys }, JSON.stringify(payload), {
        vapidDetails: vapid,
        TTL: 24 * 60 * 60,
        urgency: payload.level === 'over' ? 'high' : 'normal',
        timeout: 5_000,
      });
      return 'sent';
    } catch (err) {
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) return 'gone';
      return 'failed';
    }
  };
}

/** Expo's push service, which hands notifications to Firebase Cloud Messaging for Android. */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** The message Expo delivers to the Android app for one alert. */
export function expoMessage(token: string, payload: PushPayload) {
  return {
    to: token,
    title: payload.title,
    body: payload.body,
    data: { type: payload.type, level: payload.level, householdId: payload.householdId, url: payload.url, tag: payload.tag },
    channelId: ANDROID_ALERT_CHANNEL,
    priority: payload.level === 'over' ? 'high' : 'default',
    sound: 'default',
    ttl: 24 * 60 * 60,
  };
}

/**
 * The bit of fetch the Expo sender uses. Spelled out rather than relying on the
 * global Response type, which Vercel's build doesn't see (TS2339 on .ok/.json).
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

interface ExpoTicket {
  status?: string;
  details?: { error?: string };
}

/**
 * Expo push sender (Android). Always posts to Expo's fixed address; the token
 * only goes in the body. "DeviceNotRegistered" = the app was uninstalled or
 * the token is no longer valid. The access token is optional (Expo's
 * "enhanced security" setting) and is a secret.
 */
export function createExpoPushSender(opts: { accessToken?: string | undefined; fetch?: FetchLike } = {}): PushSender {
  const doFetch: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  return async (device, payload) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
      const res = await doFetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify([expoMessage(device.endpoint, payload)]),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return 'failed';
      const body = (await res.json()) as { data?: ExpoTicket[] };
      const ticket = Array.isArray(body?.data) ? body.data[0] : undefined;
      if (ticket?.status === 'ok') return 'sent';
      if (ticket?.details?.error === 'DeviceNotRegistered') return 'gone';
      return 'failed';
    } catch {
      return 'failed';
    }
  };
}

/** Picks the right sender for each device. A kind that isn't set up counts as a failed send. */
export function createPushSender(senders: { webpush: PushSender | null; expo: PushSender | null }): PushSender {
  return async (device, payload) => {
    const send = device.kind === 'expo' ? senders.expo : senders.webpush;
    return send ? send(device, payload) : 'failed';
  };
}

/** Push set-up from the environment: browsers need VAPID keys; the Android app always works through Expo. */
export function pushFromEnv(env: {
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
  EXPO_ACCESS_TOKEN?: string | undefined;
}): { publicKey: string | null; send: PushSender } {
  const vapid =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
      : null;
  return {
    publicKey: vapid ? vapid.publicKey : null,
    send: createPushSender({
      webpush: vapid ? createWebPushSender(vapid) : null,
      expo: createExpoPushSender({ accessToken: env.EXPO_ACCESS_TOKEN }),
    }),
  };
}

export function alertPayload(household: HouseholdDoc, alert: AlertDoc): PushPayload {
  const id = household._id.toHexString();
  return {
    type: 'alert',
    title: alert.title,
    body: alert.body,
    level: alert.level,
    householdId: id,
    url: `/alerts?household=${id}`,
    tag: `alert-${id}-${alert.scope}`,
  };
}

/**
 * Sends new alerts to every device of every active member of the household
 * (including whoever entered the spend), skipping members who muted alerts
 * for this household. Gone devices are removed. Never throws: a push outage
 * must not fail the spend that was already saved.
 */
export async function fanOutAlerts(
  db: Db,
  household: HouseholdDoc,
  alerts: AlertDoc[],
  send: PushSender | null,
): Promise<{ sent: number; removed: number }> {
  if (!send || alerts.length === 0) return { sent: 0, removed: 0 };
  try {
    const members = await db
      .collection<MembershipDoc>(MEMBERSHIPS)
      .find({ householdId: household._id, status: 'active', alertsMuted: { $ne: true } }, { projection: { userId: 1, role: 1 } })
      .toArray();
    const devices = await db
      .collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS)
      .find({ userId: { $in: members.map((m) => m.userId) } })
      .toArray();
    // Managers-only alerts ("due today" reminders) skip House Members' devices.
    const managers = new Set(members.filter((m) => m.role !== 'member').map((m) => m.userId.toHexString()));
    const jobs = alerts.flatMap((a) =>
      devices
        .filter((d) => a.audience !== 'managers' || managers.has(d.userId.toHexString()))
        .map(async (d) => ({ d, result: await send(d, alertPayload(household, a)) })),
    );
    const results = (await Promise.allSettled(jobs)).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const gone = [...new Set(results.filter((r) => r.result === 'gone').map((r) => r.d._id.toHexString()))].map((h) => new ObjectId(h));
    if (gone.length) await db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).deleteMany({ _id: { $in: gone } });
    return { sent: results.filter((r) => r.result === 'sent').length, removed: gone.length };
  } catch {
    return { sent: 0, removed: 0 };
  }
}
