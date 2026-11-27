import {
  AlertsResponseSchema,
  CategoriesResponseSchema,
  CreatedInviteResponseSchema,
  HouseholdResponseSchema,
  type PushPayload,
} from '@bdgtr/shared';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALERT_CROSSINGS, ALERTS, ensureAlertIndexes } from './alerts.js';
import { CATEGORY_BUDGETS, ensureBudgetIndexes, MONTHLY_BUDGETS } from './budgets.js';
import { CATEGORIES, ensureCategoryIndexes } from './categories.js';
import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { ensureFixedIndexes, FIXED, FIXED_POSTINGS } from './fixed.js';
import { ensureHouseholdIndexes, HOUSEHOLDS, MEMBERSHIPS } from './households.js';
import { ensureInviteIndexes, INVITES } from './invites.js';
import { PUSH_SUBSCRIPTIONS, type PushSubscriptionDoc } from './push.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';
import { ensureTransactionIndexes, TRANSACTIONS } from './transactions.js';
import { ensureUserIndexes, USERS } from './users.js';
import { sharedMongo, type SharedMongo } from './test-utils/mongo.js';

const keys = makeTestKeys();
const SECRET = 's'.repeat(40);
let mongo: SharedMongo;
let client: MongoClient;
let db: Db;
let clock: Date;
const pushed: [string, PushPayload][] = [];

beforeAll(async () => {
  mongo = await sharedMongo();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_digest_test');
  await Promise.all([
    ensureUserIndexes(db), ensureHouseholdIndexes(db), ensureInviteIndexes(db), ensureCategoryIndexes(db),
    ensureTransactionIndexes(db), ensureAlertIndexes(db), ensureBudgetIndexes(db), ensureFixedIndexes(db),
  ]);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  clock = new Date('2026-11-01T02:00:00.000Z'); // households are set up early in November
  pushed.length = 0;
  await Promise.all(
    [USERS, HOUSEHOLDS, MEMBERSHIPS, INVITES, CATEGORIES, TRANSACTIONS, ALERTS, ALERT_CROSSINGS, MONTHLY_BUDGETS, CATEGORY_BUDGETS, FIXED, FIXED_POSTINGS, PUSH_SUBSCRIPTIONS].map((c) =>
      db.collection(c).deleteMany({}),
    ),
  );
});

const app = createApp({
  allowedOrigins: ['https://bdgtr.erroldee.com'],
  pingDb: async () => true,
  getDb: async () => db,
  verifyToken: createClerkVerifier(keys.publicPem),
  now: () => clock,
  cronSecret: SECRET,
  push: {
    publicKey: null,
    send: async (d: PushSubscriptionDoc, payload: PushPayload) => {
      pushed.push([d.deviceLabel, payload]);
      return 'sent';
    },
  },
  logError: () => {},
});

function call(who: string, method: string, path: string, { body, householdId }: { body?: unknown; householdId?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${signTestToken(keys.privateKey, { sub: who, email: `${who}@example.com` })}` };
  if (householdId) headers['X-Household-Id'] = householdId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const digest = (auth: string | null = `Bearer ${SECRET}`) =>
  app.request('/internal/cron/daily-digest', { method: 'POST', headers: auth ? { Authorization: auth } : {} });

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

async function setup(owner = 'owner', name = 'Dela Cruz', budget = 4_000_000) {
  const h = HouseholdResponseSchema.parse(
    await (await call(owner, 'POST', '/households', { body: { name, defaultMonthlyBudgetMinor: budget } })).json(),
  ).household.id;
  const inv = CreatedInviteResponseSchema.parse(await (await call(owner, 'POST', '/invites', { householdId: h, body: { email: `mem-${owner}@example.com`, role: 'member' } })).json());
  await call(`mem-${owner}`, 'POST', '/invites/accept', { body: { token: inv.token } });
  const groceries = CategoriesResponseSchema.parse(await (await call(owner, 'GET', '/categories', { householdId: h })).json()).categories[0]!.id;
  return { h, groceries };
}
async function spend(who: string, h: string, categoryId: string, date: string, amountMinor: number) {
  const res = await call(who, 'POST', '/transactions', { householdId: h, body: { clientId: uuid(), date, categoryId, amountMinor } });
  expect(res.status).toBe(201);
}
async function phone(clerkId: string, label: string) {
  const user = await db.collection(USERS).findOne({ clerkUserId: clerkId });
  await db.collection(PUSH_SUBSCRIPTIONS).insertOne({
    _id: new ObjectId(), userId: user!._id, kind: 'expo', endpoint: `ExponentPushToken[${label}]`, deviceLabel: label, createdAt: clock, lastSeenAt: clock,
  });
}
const AT_7AM_23RD = new Date('2026-11-22T23:00:00.000Z'); // 23 Nov 07:00 Manila (still the 22nd in UTC)

describe('daily summary cron (07:00 Manila)', () => {
  it('needs the secret', async () => {
    expect((await digest(null)).status).toBe(401);
    expect((await digest('Bearer nope')).status).toBe(401);
  });

  it('at 23:00 UTC reports *Manila* yesterday: everyone’s spending, and the month as of now', async () => {
    const { h, groceries } = await setup();
    await phone('owner', 'owner-phone');
    await phone('mem-owner', 'member-phone');
    await spend('owner', h, groceries, '2026-11-22', 100_000);
    await spend('mem-owner', h, groceries, '2026-11-22', 84_550); // other members count too
    await spend('owner', h, groceries, '2026-11-21', 1_000_000); // earlier in the month
    await spend('owner', h, groceries, '2026-11-23', 500_000); // "today" (e.g. a 00:15 auto-post) counts in the month
    clock = AT_7AM_23RD;
    expect(await (await digest()).json()).toEqual({ forDate: '2026-11-22', households: 1, alreadySent: 0 });
    const body = 'Yesterday (Sun, 22 Nov) Dela Cruz household spent ₱1,845.50. ₱23,154.50 left of ₱40,000.00 for November.';
    expect(pushed.map(([d, p]) => [d, p.title, p.body, p.level])).toEqual([
      ['owner-phone', 'Daily summary · Dela Cruz household', body, 'near'],
      ['member-phone', 'Daily summary · Dela Cruz household', body, 'near'],
    ]);
    expect(pushed[0]![1].tag).toBe(`digest-${h}`); // replaces yesterday's
    const { alerts } = AlertsResponseSchema.parse(await (await call('mem-owner', 'GET', '/alerts?month=2026-11', { householdId: h })).json());
    expect(alerts.find((a) => a.kind === 'daily_summary')).toMatchObject({ title: 'Daily summary · Dela Cruz household', body, triggeredBy: null });
  });

  it('a re-run sends nothing twice', async () => {
    const { h } = await setup();
    await phone('owner', 'owner-phone');
    clock = AT_7AM_23RD;
    await digest();
    expect(await (await digest()).json()).toEqual({ forDate: '2026-11-22', households: 0, alreadySent: 1 });
    expect(pushed).toHaveLength(1);
    expect(await db.collection(ALERTS).countDocuments({ householdId: new ObjectId(h), kind: 'daily_summary' })).toBe(1);
  });

  it('₱0 day still sends; over budget is high priority', async () => {
    const a = await setup('owner');
    const b = await setup('other', 'Santos', 100_000);
    await phone('owner', 'a-phone');
    await phone('other', 'b-phone');
    await spend('other', b.h, b.groceries, '2026-11-10', 150_000);
    clock = AT_7AM_23RD;
    await digest();
    const byPhone = Object.fromEntries(pushed.map(([d, p]) => [d, p]));
    expect(byPhone['a-phone']!.body).toBe('Yesterday (Sun, 22 Nov) Dela Cruz household had no spending recorded. ₱40,000.00 left of ₱40,000.00 for November.');
    expect(byPhone['b-phone']).toMatchObject({ level: 'over', body: 'Yesterday (Sun, 22 Nov) Santos household had no spending recorded. Over budget by ₱500.00 for November.' });
    expect(a.h).not.toBe(b.h);
  });

  it('someone in two households gets one summary for each, titled with its name', async () => {
    const a = await setup('owner');
    await setup('other', 'Santos');
    const inv = CreatedInviteResponseSchema.parse(await (await call('other', 'POST', '/invites', { householdId: (await db.collection(HOUSEHOLDS).findOne({ name: 'Santos' }))!._id.toHexString(), body: { email: 'owner@example.com', role: 'member' } })).json());
    await call('owner', 'POST', '/invites/accept', { body: { token: inv.token } });
    await phone('owner', 'owner-phone');
    clock = AT_7AM_23RD;
    await digest();
    expect(pushed.filter(([d]) => d === 'owner-phone').map(([, p]) => p.title).sort()).toEqual([
      'Daily summary · Dela Cruz household',
      'Daily summary · Santos household',
    ]);
    expect(a.h).toBeTruthy();
  });

  it('follows the daily-summary switch, not the alert mute', async () => {
    const { h } = await setup();
    await phone('owner', 'owner-phone');
    await phone('mem-owner', 'member-phone');
    await call('owner', 'PATCH', '/membership/me', { householdId: h, body: { dailyDigestEnabled: false } });
    await call('mem-owner', 'PATCH', '/membership/me', { householdId: h, body: { alertsMuted: true } });
    clock = AT_7AM_23RD;
    await digest();
    expect(pushed.map(([d]) => d)).toEqual(['member-phone']);
  });

  it('on the 1st: last month’s close and the new month’s budget', async () => {
    const { h, groceries } = await setup();
    await phone('owner', 'owner-phone');
    await spend('owner', h, groceries, '2026-11-30', 95_000);
    await spend('owner', h, groceries, '2026-11-12', 3_665_000);
    await call('owner', 'PUT', '/budgets/monthly/2026-12', { householdId: h, body: { budgetMinor: 4_500_000 } });
    clock = new Date('2026-11-30T23:00:00.000Z'); // 1 Dec 07:00 Manila
    pushed.length = 0; // the spends above set off budget alerts
    await digest();
    expect(pushed[0]![1].body).toBe(
      'Yesterday (Mon, 30 Nov) Dela Cruz household spent ₱950.00. November closed ₱2,400.00 under budget. December budget: ₱45,000.00.',
    );
    const { alerts } = AlertsResponseSchema.parse(await (await call('owner', 'GET', '/alerts?month=2026-12', { householdId: h })).json());
    expect(alerts.map((a) => a.kind)).toEqual(['daily_summary']); // listed in the month it arrived
  });

  it('a household with no budget doesn’t crash; deleted households are skipped', async () => {
    const a = await setup('owner', 'Dela Cruz', 0);
    const gone = await setup('gone', 'Gone');
    await db.collection(HOUSEHOLDS).updateOne({ _id: new ObjectId(gone.h) }, { $set: { deletedAt: clock } });
    await phone('owner', 'owner-phone');
    clock = AT_7AM_23RD;
    expect(await (await digest()).json()).toMatchObject({ households: 1 });
    expect(pushed[0]![1].body).toBe('Yesterday (Sun, 22 Nov) Dela Cruz household had no spending recorded. No budget is set for November.');
    expect(a.h).toBeTruthy();
  });
});
