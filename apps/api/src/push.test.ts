import {
  CategoriesResponseSchema,
  CreatedInviteResponseSchema,
  CreateTransactionResponseSchema,
  DeviceResponseSchema,
  DevicesResponseSchema,
  HouseholdResponseSchema,
  MembershipSettingsSchema,
  type PushPayload,
} from '@bdgtr/shared';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALERTS, ensureAlertIndexes } from './alerts.js';
import { CATEGORIES, ensureCategoryIndexes } from './categories.js';
import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { loadEnv } from './env.js';
import { ensureHouseholdIndexes, HOUSEHOLDS, MEMBERSHIPS } from './households.js';
import { ensureInviteIndexes, INVITES } from './invites.js';
import { ensurePushIndexes, MAX_DEVICES_PER_USER, PUSH_SUBSCRIPTIONS, type PushSubscriptionDoc, type SendResult } from './push.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';
import { ensureTransactionIndexes, TRANSACTIONS } from './transactions.js';
import { ensureUserIndexes, USERS } from './users.js';

const keys = makeTestKeys();
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const clock = new Date('2026-11-25T02:00:00.000Z');
const PUBLIC_KEY = 'B'.repeat(87);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_push_test');
  await Promise.all([
    ensureUserIndexes(db), ensureHouseholdIndexes(db), ensureInviteIndexes(db), ensureCategoryIndexes(db),
    ensureTransactionIndexes(db), ensureAlertIndexes(db), ensurePushIndexes(db),
  ]);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

/** The fake push service: records deliveries; endpoints can be told to answer "gone" or fail. */
let sent: { endpoint: string; payload: PushPayload }[];
let behaviour: Record<string, SendResult | 'throw'>;
beforeEach(async () => {
  sent = [];
  behaviour = {};
  await Promise.all([USERS, HOUSEHOLDS, MEMBERSHIPS, INVITES, CATEGORIES, TRANSACTIONS, ALERTS, PUSH_SUBSCRIPTIONS].map((c) => db.collection(c).deleteMany({})));
});
const fakeSend = async (d: PushSubscriptionDoc, payload: PushPayload): Promise<SendResult> => {
  const b = behaviour[d.endpoint];
  if (b === 'throw') throw new Error('push service exploded');
  if (b) return b;
  sent.push({ endpoint: d.endpoint, payload });
  return 'sent';
};

const base = {
  allowedOrigins: ['https://bdgtr.erroldee.com'],
  pingDb: async () => true,
  getDb: async () => db,
  verifyToken: createClerkVerifier(keys.publicPem),
  now: () => clock,
  logError: () => {},
};
const app = createApp({ ...base, push: { publicKey: PUBLIC_KEY, send: fakeSend } });
const appWithoutPush = createApp(base);

function call(who: string, method: string, path: string, { body, householdId, using = app }: { body?: unknown; householdId?: string; using?: typeof app } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${signTestToken(keys.privateKey, { sub: who, email: `${who}@example.com` })}` };
  if (householdId) headers['X-Household-Id'] = householdId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return using.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

const endpoint = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;
const device = (n: string, label = `Chrome ${n}`) => ({
  kind: 'webpush',
  subscription: { endpoint: endpoint(n), expirationTime: null, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } },
  deviceLabel: label,
});
const register = async (who: string, n: string) => {
  const res = await call(who, 'POST', '/push-subscriptions', { body: device(n) });
  expect([200, 201]).toContain(res.status);
  return DeviceResponseSchema.parse(await res.json()).device;
};
const devicesOf = async (who: string) => DevicesResponseSchema.parse(await (await call(who, 'GET', '/push-subscriptions')).json()).devices;

/** Owner + House Member; Groceries budget ₱1,000. */
async function setup() {
  const h = HouseholdResponseSchema.parse(
    await (await call('owner', 'POST', '/households', { body: { name: 'Dela Cruz', defaultMonthlyBudgetMinor: 0 } })).json(),
  ).household.id;
  const inv = CreatedInviteResponseSchema.parse(await (await call('owner', 'POST', '/invites', { householdId: h, body: { email: 'mem@example.com', role: 'member' } })).json());
  await call('mem', 'POST', '/invites/accept', { body: { token: inv.token } });
  const groceries = CategoriesResponseSchema.parse(await (await call('owner', 'GET', '/categories', { householdId: h })).json()).categories[0]!.id;
  await call('owner', 'PATCH', `/categories/${groceries}`, { householdId: h, body: { defaultBudgetMinor: 100_000 } });
  return { h, groceries };
}
const spend = async (who: string, h: string, categoryId: string, amountMinor: number, using = app) => {
  const res = await call(who, 'POST', '/transactions', {
    householdId: h,
    using,
    body: { clientId: crypto.randomUUID(), date: '2026-11-25', categoryId, amountMinor, description: 'Secret birthday gift' },
  });
  return { status: res.status, body: CreateTransactionResponseSchema.parse(await res.json()) };
};

describe('GET /push/vapid-public-key', () => {
  it('gives the public key (no sign-in needed: the browser needs it to subscribe)', async () => {
    const res = await app.request('/push/vapid-public-key');
    expect(await res.json()).toEqual({ publicKey: PUBLIC_KEY });
  });
  it('503 when push is not configured', async () => {
    expect((await appWithoutPush.request('/push/vapid-public-key')).status).toBe(503);
  });
});

describe('devices', () => {
  it('registers this browser; registering again updates it rather than duplicating', async () => {
    const first = await call('ana', 'POST', '/push-subscriptions', { body: device('one', 'Chrome on Windows') });
    expect(first.status).toBe(201);
    const again = await call('ana', 'POST', '/push-subscriptions', { body: device('one', 'Chrome on Windows 11') });
    expect(again.status).toBe(200);
    expect((await devicesOf('ana')).map((d) => d.deviceLabel)).toEqual(['Chrome on Windows 11']);
  });

  it('a shared computer: the browser moves to whoever signed in last', async () => {
    await register('ana', 'shared');
    await register('ben', 'shared');
    expect(await devicesOf('ana')).toEqual([]);
    expect((await devicesOf('ben')).length).toBe(1);
  });

  it('you only see and remove your own devices', async () => {
    const mine = await register('ana', 'mine');
    const theirs = await register('ben', 'theirs');
    expect((await devicesOf('ana')).map((d) => d.id)).toEqual([mine.id]);
    expect((await call('ana', 'DELETE', `/push-subscriptions/${theirs.id}`)).status).toBe(404);
    expect((await devicesOf('ben')).length).toBe(1);
    expect((await call('ana', 'DELETE', `/push-subscriptions/${mine.id}`)).status).toBe(204);
    expect(await devicesOf('ana')).toEqual([]);
    expect((await call('ana', 'DELETE', '/push-subscriptions/nope')).status).toBe(404);
  });

  it('refuses an address that is not a real push service (the server never calls arbitrary URLs)', async () => {
    const bad = { ...device('x'), subscription: { ...device('x').subscription, endpoint: 'https://169.254.169.254/latest/meta-data' } };
    expect((await call('ana', 'POST', '/push-subscriptions', { body: bad })).status).toBe(400);
    expect(await db.collection(PUSH_SUBSCRIPTIONS).countDocuments()).toBe(0);
  });

  it(`409 past ${MAX_DEVICES_PER_USER} devices; re-registering a known one still works`, async () => {
    for (let i = 0; i < MAX_DEVICES_PER_USER; i++) await register('ana', `d${i}`);
    expect((await call('ana', 'POST', '/push-subscriptions', { body: device('one-more') })).status).toBe(409);
    expect((await call('ana', 'POST', '/push-subscriptions', { body: device('d0') })).status).toBe(200);
  });

  it('401 without sign-in', async () => {
    expect((await app.request('/push-subscriptions')).status).toBe(401);
    expect((await app.request('/push-subscriptions', { method: 'POST', body: '{}' })).status).toBe(401);
  });
});

describe('membership settings (per household, per member)', () => {
  it('defaults: alerts on, daily summary on; muting changes only your own', async () => {
    const { h } = await setup();
    expect(MembershipSettingsSchema.parse(await (await call('mem', 'GET', '/membership/me', { householdId: h })).json())).toEqual({ alertsMuted: false, dailyDigestEnabled: true });
    const res = await call('mem', 'PATCH', '/membership/me', { householdId: h, body: { alertsMuted: true } });
    expect(await res.json()).toEqual({ alertsMuted: true, dailyDigestEnabled: true });
    expect(await (await call('owner', 'GET', '/membership/me', { householdId: h })).json()).toEqual({ alertsMuted: false, dailyDigestEnabled: true });
  });

  it('400 for nothing or other fields; 404 outside the household', async () => {
    const { h } = await setup();
    expect((await call('mem', 'PATCH', '/membership/me', { householdId: h, body: {} })).status).toBe(400);
    expect((await call('mem', 'PATCH', '/membership/me', { householdId: h, body: { role: 'owner' } })).status).toBe(400);
    expect((await call('stranger', 'GET', '/membership/me', { householdId: h })).status).toBe(404);
  });
});

describe('alerts reach every member’s devices', () => {
  it('a spend that sets off an alert notifies every device of every member, incl. whoever entered it', async () => {
    const { h, groceries } = await setup();
    await register('owner', 'owner-laptop');
    await register('owner', 'owner-phone');
    await register('mem', 'mem-laptop');
    const { status } = await spend('mem', h, groceries, 95_000);
    expect(status).toBe(201);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([endpoint('mem-laptop'), endpoint('owner-laptop'), endpoint('owner-phone')]);
    expect(sent[0]!.payload).toEqual({
      type: 'alert',
      title: 'Nearly at budget · Groceries',
      body: 'Dela Cruz household has used 95% of its ₱1,000 Groceries budget',
      level: 'near',
      householdId: h,
      url: `/alerts?household=${h}`,
      tag: `alert-${h}-${groceries}`,
    });
  });

  it('never sends the spend description (lock screens)', async () => {
    const { h, groceries } = await setup();
    await register('owner', 'laptop');
    await spend('mem', h, groceries, 120_000);
    expect(JSON.stringify(sent)).not.toContain('Secret birthday gift');
  });

  it('no alert, no notification', async () => {
    const { h, groceries } = await setup();
    await register('owner', 'laptop');
    await spend('mem', h, groceries, 1_000);
    expect(sent).toEqual([]);
  });

  it('a member who muted this household gets nothing; others still do', async () => {
    const { h, groceries } = await setup();
    await register('owner', 'owner-laptop');
    await register('mem', 'mem-laptop');
    await call('mem', 'PATCH', '/membership/me', { householdId: h, body: { alertsMuted: true } });
    await spend('owner', h, groceries, 95_000);
    expect(sent.map((s) => s.endpoint)).toEqual([endpoint('owner-laptop')]);
  });

  it('a removed member gets nothing; nor does a member of another household', async () => {
    const { h, groceries } = await setup();
    await register('mem', 'mem-laptop');
    await register('outsider', 'outsider-laptop');
    await call('outsider', 'POST', '/households', { body: { name: 'Other', defaultMonthlyBudgetMinor: 0 } });
    const memId = (await db.collection(USERS).findOne({ clerkUserId: 'mem' }))!._id.toHexString();
    await call('owner', 'DELETE', `/members/${memId}`, { householdId: h });
    await spend('owner', h, groceries, 95_000);
    expect(sent).toEqual([]);
  });

  it('a device the push service says is gone is removed; the others still get it', async () => {
    const { h, groceries } = await setup();
    await register('owner', 'old-browser');
    await register('owner', 'laptop');
    behaviour[endpoint('old-browser')] = 'gone';
    await spend('mem', h, groceries, 95_000);
    expect(sent.map((s) => s.endpoint)).toEqual([endpoint('laptop')]);
    expect((await devicesOf('owner')).map((d) => d.deviceLabel)).toEqual(['Chrome laptop']);
  });

  it('a push outage never fails the spend (failures and even a crashing sender)', async () => {
    const { h, groceries } = await setup();
    await register('owner', 'flaky');
    await register('owner', 'broken');
    behaviour[endpoint('flaky')] = 'failed';
    behaviour[endpoint('broken')] = 'throw';
    const { status, body } = await spend('mem', h, groceries, 95_000);
    expect(status).toBe(201);
    expect(body.alerts).toHaveLength(1); // still recorded and returned for the toast
    expect((await devicesOf('owner')).length).toBe(2); // failures are not "gone"
  });

  it('push not configured: spends and alerts still work', async () => {
    const { h, groceries } = await setup();
    const { status, body } = await spend('mem', h, groceries, 95_000, appWithoutPush);
    expect(status).toBe(201);
    expect(body.alerts).toHaveLength(1);
  });
});

describe('configuration', () => {
  const env = { MONGODB_URI: 'mongodb://localhost/x' };
  const vapid = { VAPID_PUBLIC_KEY: 'B'.repeat(87), VAPID_PRIVATE_KEY: 'k'.repeat(43), VAPID_SUBJECT: 'https://bdgtr.erroldee.com' };
  it('push keys are optional, all three together', () => {
    expect(loadEnv(env).VAPID_PUBLIC_KEY).toBeUndefined();
    expect(loadEnv({ ...env, ...vapid }).VAPID_SUBJECT).toBe('https://bdgtr.erroldee.com');
  });
  it.each([
    ['only some set', { VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY }],
    ['a malformed private key', { ...vapid, VAPID_PRIVATE_KEY: 'short' }],
    ['a subject that is not mailto/https', { ...vapid, VAPID_SUBJECT: 'http://example.com' }],
  ])('refuses %s, without echoing the secret', (_label, extra) => {
    let message = '';
    try {
      loadEnv({ ...env, ...extra });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/VAPID/);
    expect(message).not.toContain('k'.repeat(43));
  });
});
