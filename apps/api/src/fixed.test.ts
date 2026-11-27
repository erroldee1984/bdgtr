import {
  CategoriesResponseSchema,
  CategoryResponseSchema,
  CreatedInviteResponseSchema,
  FixedTransactionResponseSchema,
  FixedTransactionsResponseSchema,
  HouseholdResponseSchema,
  AlertsResponseSchema,
  BulkPostResponseSchema,
  type PushPayload,
  TransactionsResponseSchema,
} from '@bdgtr/shared';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALERT_CROSSINGS, ALERTS, ensureAlertIndexes } from './alerts.js';
import { CATEGORY_BUDGETS, ensureBudgetIndexes, MONTHLY_BUDGETS } from './budgets.js';
import { CATEGORIES, ensureCategoryIndexes } from './categories.js';
import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { autoPostClientId, ensureFixedIndexes, FIXED, FIXED_POSTINGS } from './fixed.js';
import { hasCronSecret } from './fixed-routes.js';
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
let clock = new Date('2026-11-25T02:00:00.000Z'); // 25 Nov, 10:00 Manila

beforeAll(async () => {
  mongo = await sharedMongo();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_fixed_test');
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
  clock = new Date('2026-11-25T02:00:00.000Z');
  pushed.length = 0;
  await Promise.all(
    [USERS, HOUSEHOLDS, MEMBERSHIPS, INVITES, CATEGORIES, TRANSACTIONS, ALERTS, ALERT_CROSSINGS, MONTHLY_BUDGETS, CATEGORY_BUDGETS, FIXED, FIXED_POSTINGS, PUSH_SUBSCRIPTIONS].map((c) =>
      db.collection(c).deleteMany({}),
    ),
  );
});

/** Every push "sent", as [device label, payload]. */
const pushed: [string, PushPayload][] = [];
function makeApp(cronSecret: string | null = SECRET) {
  return createApp({
    push: {
      publicKey: null,
      send: async (d: PushSubscriptionDoc, payload: PushPayload) => {
        pushed.push([d.deviceLabel, payload]);
        return 'sent';
      },
    },
    allowedOrigins: ['https://bdgtr.erroldee.com'],
    pingDb: async () => true,
    getDb: async () => db,
    verifyToken: createClerkVerifier(keys.publicPem),
    now: () => clock,
    cronSecret,
    logError: () => {},
  });
}
const app = makeApp();

function call(who: string, method: string, path: string, { body, householdId }: { body?: unknown; householdId?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${signTestToken(keys.privateKey, { sub: who, email: `${who}@example.com` })}` };
  if (householdId) headers['X-Household-Id'] = householdId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const cron = (auth: string | null = `Bearer ${SECRET}`, body?: unknown, a = app, path = '/internal/cron/fixed-postings') =>
  a.request(path, {
    method: 'POST',
    headers: { ...(auth ? { Authorization: auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** Owner + House Member; ₱40,000 a month; Groceries ₱8,000 by default. */
async function setup(owner = 'owner', name = 'Dela Cruz') {
  const h = HouseholdResponseSchema.parse(
    await (await call(owner, 'POST', '/households', { body: { name, defaultMonthlyBudgetMinor: 4_000_000 } })).json(),
  ).household.id;
  const inv = CreatedInviteResponseSchema.parse(await (await call(owner, 'POST', '/invites', { householdId: h, body: { email: `mem-${owner}@example.com`, role: 'member' } })).json());
  await call(`mem-${owner}`, 'POST', '/invites/accept', { body: { token: inv.token } });
  // New households start with only the built-in Unbudgeted category: add Groceries for the tests.
  const groceries = CategoryResponseSchema.parse(
    await (await call(owner, 'POST', '/categories', { householdId: h, body: { name: 'Groceries', icon: 'cart', colour: '#4ADE80', defaultBudgetMinor: 800_000 } })).json(),
  ).category.id;
  return { h, groceries };
}
async function addFixed(h: string, categoryId: string, patch: Record<string, unknown> = {}, who = 'owner') {
  const res = await call(who, 'POST', '/fixed-transactions', {
    householdId: h,
    body: { name: 'Rent', categoryId, amountMinor: 1_500_000, dayOfMonth: 25, autoPostEnabled: true, ...patch },
  });
  expect(res.status).toBe(201);
  return FixedTransactionResponseSchema.parse(await res.json()).item;
}
const list = async (h: string, month?: string, who = 'owner') =>
  FixedTransactionsResponseSchema.parse(await (await call(who, 'GET', `/fixed-transactions${month ? `?month=${month}` : ''}`, { householdId: h })).json()).items;
const spends = async (h: string, month = '2026-11', who = 'owner') =>
  TransactionsResponseSchema.parse(await (await call(who, 'GET', `/transactions?month=${month}`, { householdId: h })).json()).transactions;

describe('fixed transactions: list and edit', () => {
  it('Owner adds, changes and removes; everyone can view', async () => {
    const { h, groceries } = await setup();
    const item = await addFixed(h, groceries, { description: 'Condo' });
    expect(item).toMatchObject({ name: 'Rent', amountMinor: 1_500_000, dayOfMonth: 25, autoPostEnabled: true, description: 'Condo', postedOn: null });
    expect(await list(h, undefined, 'mem-owner')).toHaveLength(1);

    const patched = await call('owner', 'PATCH', `/fixed-transactions/${item.id}`, { householdId: h, body: { amountMinor: 1_600_000, autoPostEnabled: false } });
    expect(FixedTransactionResponseSchema.parse(await patched.json()).item).toMatchObject({ amountMinor: 1_600_000, autoPostEnabled: false });

    expect((await call('owner', 'DELETE', `/fixed-transactions/${item.id}`, { householdId: h })).status).toBe(204);
    expect(await list(h)).toEqual([]);
    expect((await call('owner', 'PATCH', `/fixed-transactions/${item.id}`, { householdId: h, body: { amountMinor: 1 } })).status).toBe(404);
    expect((await call('owner', 'DELETE', `/fixed-transactions/${item.id}`, { householdId: h })).status).toBe(404);
  });

  it('House Members can only view (403 on every change)', async () => {
    const { h, groceries } = await setup();
    const item = await addFixed(h, groceries);
    const body = { name: 'X', categoryId: groceries, amountMinor: 1, dayOfMonth: 1, autoPostEnabled: false };
    expect((await call('mem-owner', 'POST', '/fixed-transactions', { householdId: h, body })).status).toBe(403);
    expect((await call('mem-owner', 'PATCH', `/fixed-transactions/${item.id}`, { householdId: h, body: { amountMinor: 1 } })).status).toBe(403);
    expect((await call('mem-owner', 'DELETE', `/fixed-transactions/${item.id}`, { householdId: h })).status).toBe(403);
    expect((await call('mem-owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body: { date: '2026-11-25', items: [{ id: item.id, clientId: uuid() }] } })).status).toBe(403);
  });

  it('another household’s items and categories are invisible', async () => {
    const a = await setup('owner');
    const b = await setup('other', 'Santos');
    const item = await addFixed(a.h, a.groceries);
    expect((await call('other', 'PATCH', `/fixed-transactions/${item.id}`, { householdId: b.h, body: { amountMinor: 1 } })).status).toBe(404);
    const res = await call('other', 'POST', '/fixed-transactions', {
      householdId: b.h,
      body: { name: 'X', categoryId: a.groceries, amountMinor: 1, dayOfMonth: 1, autoPostEnabled: false },
    });
    expect(res.status).toBe(404);
  });

  it('a removed category is refused (409); validation errors are 400', async () => {
    const { h } = await setup();
    const extra = CategoryResponseSchema.parse(
      await (await call('owner', 'POST', '/categories', { householdId: h, body: { name: 'Bills', icon: 'flash', colour: '#4ADE80', defaultBudgetMinor: 0 } })).json(),
    ).category.id;
    await call('owner', 'DELETE', `/categories/${extra}`, { householdId: h });
    const res = await call('owner', 'POST', '/fixed-transactions', {
      householdId: h,
      body: { name: 'Power', categoryId: extra, amountMinor: 1, dayOfMonth: 1, autoPostEnabled: true },
    });
    expect(res.status).toBe(409);
    expect((await call('owner', 'POST', '/fixed-transactions', { householdId: h, body: { name: 'Bad', categoryId: extra, amountMinor: 1, dayOfMonth: 32, autoPostEnabled: true } })).status).toBe(400);
  });

  it('?month= must be YYYY-MM', async () => {
    const { h } = await setup();
    expect((await call('owner', 'GET', '/fixed-transactions?month=2026-13', { householdId: h })).status).toBe(400);
  });
});

describe('bulk add', () => {
  it('adds each item as a spend on the date; a retry adds nothing more; the month shows when', async () => {
    const { h, groceries } = await setup();
    const rent = await addFixed(h, groceries);
    const net = await addFixed(h, groceries, { name: 'Internet', amountMinor: 150_000, dayOfMonth: 3, autoPostEnabled: false });
    const body = { date: '2026-11-20', items: [{ id: rent.id, clientId: uuid() }, { id: net.id, clientId: uuid() }] };
    const res = await call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body });
    expect(res.status).toBe(201);
    const out = BulkPostResponseSchema.parse(await res.json());
    expect(out.transactions.map((t) => [t.date, t.amountMinor, t.categoryId])).toEqual([
      ['2026-11-20', 1_500_000, groceries],
      ['2026-11-20', 150_000, groceries],
    ]);
    expect(out.alerts.map((a) => a.level)).toContain('over'); // ₱16,500 against Groceries ₱8,000

    await call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body }); // retry
    expect(await spends(h)).toHaveLength(2);
    expect((await list(h, '2026-11')).map((i) => i.postedOn)).toEqual(['2026-11-20', '2026-11-20']);
    expect((await list(h, '2026-12')).map((i) => i.postedOn)).toEqual([null, null]);
    const doc = await db.collection(TRANSACTIONS).findOne({ fixedTransactionId: new ObjectId(rent.id) });
    expect(doc?.source).toBe('fixed-bulk');
  });

  it('"add again" (new clientIds) adds another spend; the month keeps the first date', async () => {
    const { h, groceries } = await setup();
    const rent = await addFixed(h, groceries);
    await call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body: { date: '2026-11-02', items: [{ id: rent.id, clientId: uuid() }] } });
    await call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body: { date: '2026-11-21', items: [{ id: rent.id, clientId: uuid() }] } });
    expect(await spends(h)).toHaveLength(2);
    expect((await list(h))[0]!.postedOn).toBe('2026-11-02');
  });

  it('refuses removed items (404), removed categories (409), bad input (400)', async () => {
    const { h, groceries } = await setup();
    const rent = await addFixed(h, groceries);
    const gone = await addFixed(h, groceries, { name: 'Gone' });
    await call('owner', 'DELETE', `/fixed-transactions/${gone.id}`, { householdId: h });
    const post = (body: unknown) => call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body });
    expect((await post({ date: '2026-11-25', items: [{ id: rent.id, clientId: uuid() }, { id: gone.id, clientId: uuid() }] })).status).toBe(404);
    expect((await post({ date: '2026-11-25', items: [] })).status).toBe(400);
    expect((await post({ date: '2028-01-01', items: [{ id: rent.id, clientId: uuid() }] })).status).toBe(400); // > a year ahead

    const bills = CategoryResponseSchema.parse(
      await (await call('owner', 'POST', '/categories', { householdId: h, body: { name: 'Bills', icon: 'flash', colour: '#4ADE80', defaultBudgetMinor: 0 } })).json(),
    ).category.id;
    const power = await addFixed(h, bills, { name: 'Power' });
    await call('owner', 'DELETE', `/categories/${bills}`, { householdId: h });
    expect((await post({ date: '2026-11-25', items: [{ id: power.id, clientId: uuid() }] })).status).toBe(409);
    expect(await spends(h)).toEqual([]);
  });
});

describe('auto-post cron (00:15 Manila)', () => {
  it('needs the secret: none / wrong → 401; not configured → 503', async () => {
    expect((await cron(null)).status).toBe(401);
    expect((await cron('Bearer wrong')).status).toBe(401);
    expect((await cron(SECRET)).status).toBe(401); // no "Bearer "
    expect((await cron(`Bearer ${SECRET}`, undefined, makeApp(null))).status).toBe(503);
  });

  it('at 16:15 UTC posts items due on the *Manila* date (the next day), across households; a re-run adds nothing', async () => {
    const a = await setup('owner');
    const b = await setup('other', 'Santos');
    await addFixed(a.h, a.groceries, { dayOfMonth: 26 });
    await addFixed(b.h, b.groceries, { dayOfMonth: 26, name: 'Tuition', amountMinor: 50_000 }, 'other');
    await addFixed(a.h, a.groceries, { dayOfMonth: 25, name: 'Yesterday’s' });
    clock = new Date('2026-11-25T16:15:00.000Z'); // 26 Nov 00:15 Manila
    const res = await cron();
    expect(await res.json()).toEqual({ date: '2026-11-26', posted: 2, alreadyPosted: 0, skippedRemovedCategory: 0 });
    expect((await spends(a.h)).map((t) => t.date)).toEqual(['2026-11-26']);
    expect((await spends(b.h, '2026-11', 'other')).map((t) => t.amountMinor)).toEqual([50_000]);
    const doc = await db.collection(TRANSACTIONS).findOne({ householdId: new ObjectId(a.h) });
    expect(doc?.source).toBe('fixed-auto');

    expect(await (await cron()).json()).toMatchObject({ posted: 0, alreadyPosted: 2 });
    expect(await spends(a.h)).toHaveLength(1);
  });

  it('a crash after adding the spend but before noting it can’t double-post (same clientId)', async () => {
    const { h, groceries } = await setup();
    const rent = await addFixed(h, groceries, { dayOfMonth: 25 });
    await cron();
    await db.collection(FIXED_POSTINGS).deleteMany({}); // as if the note never got written
    expect(await (await cron()).json()).toMatchObject({ posted: 0, alreadyPosted: 1 });
    expect(await spends(h)).toHaveLength(1);
    expect((await list(h))[0]!.postedOn).toBe('2026-11-25'); // re-noted
    expect(autoPostClientId(new ObjectId(rent.id), '2026-11')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('days 29–31 post on the last day of a short month', async () => {
    const { h, groceries } = await setup();
    await addFixed(h, groceries, { dayOfMonth: 31 });
    await addFixed(h, groceries, { dayOfMonth: 30, name: 'Thirty' });
    await addFixed(h, groceries, { dayOfMonth: 29, name: 'TwentyNine' });
    clock = new Date('2026-11-29T16:15:00.000Z'); // 30 Nov Manila
    expect(await (await cron()).json()).toMatchObject({ date: '2026-11-30', posted: 2 }); // 30 and 31 (29 was yesterday)
    clock = new Date('2027-02-27T16:15:00.000Z'); // 28 Feb 2027 Manila
    expect(await (await cron()).json()).toMatchObject({ date: '2027-02-28', posted: 3 });
  });

  it('skips: auto-post off, removed items, already bulk-added this month, removed category, deleted household', async () => {
    const { h, groceries } = await setup();
    await addFixed(h, groceries, { autoPostEnabled: false, name: 'Off' });
    const removed = await addFixed(h, groceries, { name: 'Removed' });
    await call('owner', 'DELETE', `/fixed-transactions/${removed.id}`, { householdId: h });
    const early = await addFixed(h, groceries, { name: 'Paid early' });
    await call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body: { date: '2026-11-03', items: [{ id: early.id, clientId: uuid() }] } });
    const bills = CategoryResponseSchema.parse(
      await (await call('owner', 'POST', '/categories', { householdId: h, body: { name: 'Bills', icon: 'flash', colour: '#4ADE80', defaultBudgetMinor: 0 } })).json(),
    ).category.id;
    await addFixed(h, bills, { name: 'Power' });
    await call('owner', 'DELETE', `/categories/${bills}`, { householdId: h });
    const gone = await setup('gone', 'Gone');
    await addFixed(gone.h, gone.groceries, {}, 'gone');
    await db.collection(HOUSEHOLDS).updateOne({ _id: new ObjectId(gone.h) }, { $set: { deletedAt: clock } });

    expect(await (await cron()).json()).toEqual({ date: '2026-11-25', posted: 0, alreadyPosted: 1, skippedRemovedCategory: 1 });
    expect(await spends(h)).toHaveLength(1); // only the early bulk add
  });

  it('auto-posted spends raise budget alerts like any spend', async () => {
    const { h, groceries } = await setup();
    await addFixed(h, groceries, { amountMinor: 900_000 }); // over Groceries ₱8,000
    await cron();
    const alerts = await db.collection(ALERTS).find({ householdId: new ObjectId(h) }).toArray();
    expect(alerts.map((x) => x.level)).toEqual(['over']); // one jump past the line records 'over' only
  });

  it('{ date } re-runs a missed day from the last week, never the future or older', async () => {
    const { h, groceries } = await setup();
    await addFixed(h, groceries, { dayOfMonth: 20 });
    expect((await cron(`Bearer ${SECRET}`, { date: '2026-11-26' })).status).toBe(400);
    expect((await cron(`Bearer ${SECRET}`, { date: '2026-11-17' })).status).toBe(400);
    expect((await cron(`Bearer ${SECRET}`, { date: 'nope' })).status).toBe(400);
    expect(await (await cron(`Bearer ${SECRET}`, { date: '2026-11-20' })).json()).toMatchObject({ date: '2026-11-20', posted: 1 });
    expect((await spends(h))[0]!.date).toBe('2026-11-20');
  });
});

describe('alerts.ts collection names', () => {
  it('match fixed.ts (repeated there to avoid a circular import)', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('./alerts.ts', import.meta.url), 'utf8');
    expect(src).toContain(`const FIXED_COLLECTION = '${FIXED}'`);
    expect(src).toContain(`const FIXED_POSTINGS_COLLECTION = '${FIXED_POSTINGS}'`);
  });
});

describe('hasCronSecret', () => {
  it('exact Bearer match only', () => {
    expect(hasCronSecret(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(hasCronSecret(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(hasCronSecret('Bearer ', SECRET)).toBe(false);
    expect(hasCronSecret(undefined, SECRET)).toBe(false);
  });
});

describe('7:00 AM notices', () => {
  const notices = (auth: string | null = `Bearer ${SECRET}`, body?: unknown, a = app) => cron(auth, body, a, '/internal/cron/fixed-notices');
  const alertsFor = async (who: string, h: string) =>
    AlertsResponseSchema.parse(await (await call(who, 'GET', '/alerts?month=2026-11', { householdId: h })).json());
  async function phone(clerkId: string, label: string) {
    const user = await db.collection(USERS).findOne({ clerkUserId: clerkId });
    await db.collection(PUSH_SUBSCRIPTIONS).insertOne({
      _id: new ObjectId(),
      userId: user!._id,
      kind: 'expo',
      endpoint: `ExponentPushToken[${label}]`,
      deviceLabel: label,
      createdAt: clock,
      lastSeenAt: clock,
    });
  }

  it('need the secret, like the other jobs', async () => {
    expect((await notices(null)).status).toBe(401);
    expect((await notices(`Bearer ${SECRET}`, undefined, makeApp(null))).status).toBe(503);
  });

  it('"Added automatically" goes to everyone in the household, at 7:00 not at 00:15', async () => {
    clock = new Date('2026-11-20T02:00:00.000Z'); // the household is set up before the 25th
    const { h, groceries } = await setup();
    await phone('owner', 'owner-phone');
    await phone('mem-owner', 'member-phone');
    await addFixed(h, groceries, { amountMinor: 100_000 }); // auto, due on the 25th
    clock = new Date('2026-11-24T16:15:00.000Z'); // 25 Nov 00:15 Manila
    await cron();
    expect(pushed).toEqual([]); // nothing at midnight (₱1,000 crosses no budget)

    clock = new Date('2026-11-24T23:00:00.000Z'); // 25 Nov 07:00 Manila
    expect(await (await notices()).json()).toEqual({ date: '2026-11-25', added: 1, due: 0 });
    expect(pushed.map(([d, p]) => [d, p.title, p.body])).toEqual([
      ['owner-phone', 'Added automatically · Rent', "Dela Cruz household: Rent (₱1,000, Groceries) was added as today's spend."],
      ['member-phone', 'Added automatically · Rent', "Dela Cruz household: Rent (₱1,000, Groceries) was added as today's spend."],
    ]);
    for (const who of ['owner', 'mem-owner']) {
      const { alerts, unreadCount } = await alertsFor(who, h);
      expect(alerts.map((a) => [a.kind, a.title, a.triggeredBy])).toEqual([['fixed_added', 'Added automatically · Rent', null]]);
      expect(unreadCount).toBe(1);
    }
  });

  it('"Due today" (not added automatically) goes only to the House Owner and Co-Owners', async () => {
    const { h, groceries } = await setup();
    await phone('owner', 'owner-phone');
    await phone('mem-owner', 'member-phone');
    await addFixed(h, groceries, { name: 'Tuition', amountMinor: 2_500_000, autoPostEnabled: false });
    clock = new Date('2026-11-24T23:00:00.000Z');
    expect(await (await notices()).json()).toEqual({ date: '2026-11-25', added: 0, due: 1 });
    expect(pushed.map(([d, p]) => [d, p.title, p.body])).toEqual([
      ['owner-phone', 'Due today · Tuition', 'Dela Cruz household: Tuition (₱25,000, Groceries) is due today. Add it in Fixed transactions.'],
    ]);
    expect((await alertsFor('owner', h)).alerts.map((a) => a.kind)).toEqual(['fixed_due']);
    const member = await alertsFor('mem-owner', h);
    expect(member.alerts).toEqual([]);
    expect(member.unreadCount).toBe(0);
    expect(await spends(h)).toEqual([]); // a reminder adds nothing
  });

  it('no reminder for an item already added this month, or not due today, or removed', async () => {
    const { h, groceries } = await setup();
    const paid = await addFixed(h, groceries, { name: 'Paid', autoPostEnabled: false });
    await call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body: { date: '2026-11-03', items: [{ id: paid.id, clientId: uuid() }] } });
    await addFixed(h, groceries, { name: 'Later', autoPostEnabled: false, dayOfMonth: 28 });
    const gone = await addFixed(h, groceries, { name: 'Gone', autoPostEnabled: false });
    await call('owner', 'DELETE', `/fixed-transactions/${gone.id}`, { householdId: h });
    expect(await (await notices()).json()).toEqual({ date: '2026-11-25', added: 0, due: 0 });
  });

  it('a re-run sends nothing again; days 29–31 remind on the last day of a short month', async () => {
    const { h, groceries } = await setup();
    await phone('owner', 'owner-phone');
    await addFixed(h, groceries, { name: 'Rent', autoPostEnabled: false, dayOfMonth: 31 });
    clock = new Date('2026-11-29T23:00:00.000Z'); // 30 Nov 07:00 Manila
    expect(await (await notices()).json()).toMatchObject({ date: '2026-11-30', due: 1 });
    expect(await (await notices()).json()).toMatchObject({ due: 0 });
    expect(pushed).toHaveLength(1);
  });

  describe('"Add it now" on a due-today reminder (canAdd)', () => {
    async function remind() {
      clock = new Date('2026-11-20T02:00:00.000Z');
      const { h, groceries } = await setup();
      const item = await addFixed(h, groceries, { name: 'Tuition', amountMinor: 2_500_000, autoPostEnabled: false });
      clock = new Date('2026-11-24T23:00:00.000Z'); // 25 Nov 07:00 Manila
      await notices();
      const reminder = async (who = 'owner') => (await alertsFor(who, h)).alerts.find((a) => a.kind === 'fixed_due');
      return { h, item, reminder };
    }

    it('on the due day, not yet added: canAdd, with the item and date to add', async () => {
      const { item, reminder } = await remind();
      clock = new Date('2026-11-25T10:00:00.000Z'); // 18:00 Manila, still the 25th
      expect(await reminder()).toMatchObject({ canAdd: true, fixedTransactionId: item.id, dueDate: '2026-11-25' });
    });

    it('once added (the button posts it for that date), the button goes', async () => {
      const { h, item, reminder } = await remind();
      const res = await call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body: { date: '2026-11-25', items: [{ id: item.id, clientId: uuid() }] } });
      expect(res.status).toBe(201);
      expect((await spends(h)).map((t) => [t.date, t.amountMinor])).toEqual([['2026-11-25', 2_500_000]]);
      expect((await reminder())?.canAdd).toBe(false);
    });

    it('added earlier in the month counts as added too', async () => {
      clock = new Date('2026-11-20T02:00:00.000Z');
      const { h, groceries } = await setup();
      const item = await addFixed(h, groceries, { name: 'Tuition', autoPostEnabled: false });
      clock = new Date('2026-11-24T23:00:00.000Z');
      await notices();
      await call('owner', 'POST', '/fixed-transactions/bulk-post', { householdId: h, body: { date: '2026-11-25', items: [{ id: item.id, clientId: uuid() }] } });
      expect((await alertsFor('owner', h)).alerts[0]!.canAdd).toBe(false);
    });

    it('the day after (Manila), the button goes', async () => {
      const { reminder } = await remind();
      clock = new Date('2026-11-25T16:00:00.000Z'); // 26 Nov 00:00 Manila
      expect((await reminder())?.canAdd).toBe(false);
    });

    it('a removed item has no button', async () => {
      const { h, item, reminder } = await remind();
      await call('owner', 'DELETE', `/fixed-transactions/${item.id}`, { householdId: h });
      expect((await reminder())?.canAdd).toBe(false);
    });

    it('"added automatically" notices never have one', async () => {
      clock = new Date('2026-11-20T02:00:00.000Z');
      const { h, groceries } = await setup();
      await addFixed(h, groceries, { amountMinor: 100_000 });
      clock = new Date('2026-11-24T16:15:00.000Z');
      await cron();
      clock = new Date('2026-11-24T23:00:00.000Z');
      await notices();
      const [a] = (await alertsFor('owner', h)).alerts;
      expect(a).toMatchObject({ kind: 'fixed_added', canAdd: false });
    });
  });

  it('muted members get no push but still see it in Alerts', async () => {
    const { h, groceries } = await setup();
    await phone('mem-owner', 'member-phone');
    await call('mem-owner', 'PATCH', '/membership/me', { householdId: h, body: { alertsMuted: true } });
    await addFixed(h, groceries, { amountMinor: 100_000 });
    clock = new Date('2026-11-24T16:15:00.000Z');
    await cron();
    clock = new Date('2026-11-24T23:00:00.000Z');
    await notices();
    expect(pushed).toEqual([]);
    expect((await alertsFor('mem-owner', h)).alerts).toHaveLength(1);
  });
});
