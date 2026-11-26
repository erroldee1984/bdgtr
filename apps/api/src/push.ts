import type { Device, PushPayload, RegisterDeviceInput } from '@bdgtr/shared';
import { type Db, ObjectId } from 'mongodb';
import { sendNotification, WebPushError } from 'web-push';

import type { AlertDoc } from './alerts.js';
import type { HouseholdDoc, MembershipDoc } from './households.js';
import { MEMBERSHIPS } from './households.js';

/** docs/PLAN.md §4 pushSubscriptions: one row per device (browser or phone). */
export interface PushSubscriptionDoc {
  _id: ObjectId;
  userId: ObjectId;
  kind: 'webpush';
  endpoint: string;
  keys: { p256dh: string; auth: string };
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
 * Registers this browser for the signed-in person. The same browser
 * re-registering updates its row; a browser last used by someone else
 * (a shared computer) now belongs to whoever signed in.
 */
export async function registerDevice(db: Db, userId: ObjectId, input: RegisterDeviceInput, now: Date): Promise<PushSubscriptionDoc> {
  const doc = await db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).findOneAndUpdate(
    { endpoint: input.subscription.endpoint },
    {
      $set: { userId, kind: 'webpush', keys: input.subscription.keys, deviceLabel: input.deviceLabel, lastSeenAt: now },
      $setOnInsert: { endpoint: input.subscription.endpoint, createdAt: now },
    },
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
      .find({ householdId: household._id, status: 'active', alertsMuted: { $ne: true } }, { projection: { userId: 1 } })
      .toArray();
    const devices = await db
      .collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS)
      .find({ userId: { $in: members.map((m) => m.userId) } })
      .toArray();
    const jobs = alerts.flatMap((a) => devices.map(async (d) => ({ d, result: await send(d, alertPayload(household, a)) })));
    const results = (await Promise.allSettled(jobs)).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const gone = [...new Set(results.filter((r) => r.result === 'gone').map((r) => r.d._id.toHexString()))].map((h) => new ObjectId(h));
    if (gone.length) await db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).deleteMany({ _id: { $in: gone } });
    return { sent: results.filter((r) => r.result === 'sent').length, removed: gone.length };
  } catch {
    return { sent: 0, removed: 0 };
  }
}
