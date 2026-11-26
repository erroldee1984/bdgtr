import {
  AlertsResponseSchema,
  CategoriesResponseSchema,
  CategoryResponseSchema,
  CreatedInviteResponseSchema,
  CreateTransactionResponseSchema,
  HouseholdResponseSchema,
} from '@bdgtr/shared';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALERT_CROSSINGS, ALERT_RETENTION_DAYS, ALERTS, ensureAlertIndexes } from './alerts.js';
import { CATEGORIES, ensureCategoryIndexes } from './categories.js';
import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { ensureHouseholdIndexes, HOUSEHOLDS, MEMBERSHIPS } from './households.js';
import { ensureInviteIndexes, INVITES } from './invites.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';
import { ensureTransactionIndexes, TRANSACTIONS } from './transactions.js';
import { ensureUserIndexes, USERS } from './users.js';

const keys = makeTestKeys();
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let clock = new Date('2026-11-25T02:00:00.000Z');
const tick = (ms = 1000) => (clock = new Date(clock.getTime() + ms));

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_alerts_test');
  await Promise.all([
    ensureUserIndexes(db), ensureHouseholdIndexes(db), ensureInviteIndexes(db),
    ensureCategoryIndexes(db), ensureTransactionIndexes(db), ensureAlertIndexes(db),
  ]);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  clock = new Date('2026-11-25T02:00:00.000Z');
  await Promise.all([USERS, HOUSEHOLDS, MEMBERSHIPS, INVITES, CATEGORIES, TRANSACTIONS, ALERTS, ALERT_CROSSINGS].map((c) => db.collection(c).deleteMany({})));
});

const app = createApp({
  allowedOrigins: ['https://bdgtr.erroldee.com'],
  pingDb: async () => true,
  getDb: async () => db,
  verifyToken: createClerkVerifier(keys.publicPem),
  now: () => clock,
  logError: () => {},
});

function call(who: string, method: string, path: string, { body, householdId }: { body?: unknown; householdId?: string } = {}) {
  const claims = { sub: who, email: `${who}@example.com`, ...(who === 'mem' ? { name: 'Mia Santos' } : {}) };
  const headers: Record<string, string> = { Authorization: `Bearer ${signTestToken(keys.privateKey, claims)}` };
  if (householdId) headers['X-Household-Id'] = householdId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function join(h: string, who: string, role: 'co_owner' | 'member') {
  const inv = CreatedInviteResponseSchema.parse(await (await call('owner', 'POST', '/invites', { householdId: h, body: { email: `${who}@example.com`, role } })).json());
  expect((await call(who, 'POST', '/invites/accept', { body: { token: inv.token } })).status).toBe(200);
}

/** Household with a ₱10,000 total budget and Groceries at ₱1,000; Owner + House Member. */
async function setup(totalBudgetMinor = 1_000_000, groceriesBudgetMinor = 100_000) {
  const res = await call('owner', 'POST', '/households', { body: { name: 'Dela Cruz', defaultMonthlyBudgetMinor: totalBudgetMinor } });
  const h = HouseholdResponseSchema.parse(await res.json()).household.id;
  await join(h, 'mem', 'member');
  const groceries = CategoriesResponseSchema.parse(await (await call('owner', 'GET', '/categories', { householdId: h })).json()).categories[0]!;
  await call('owner', 'PATCH', `/categories/${groceries.id}`, { householdId: h, body: { defaultBudgetMinor: groceriesBudgetMinor } });
  return { h, groceries: groceries.id };
}

async function spend(who: string, h: string, categoryId: string, amountMinor: number, extra: Record<string, unknown> = {}) {
  tick();
  const res = await call(who, 'POST', '/transactions', {
    householdId: h,
    body: { clientId: crypto.randomUUID(), date: '2026-11-25', categoryId, amountMinor, description: 'Secret birthday gift', ...extra },
  });
  expect([200, 201]).toContain(res.status);
  return CreateTransactionResponseSchema.parse(await res.json());
}

const alertsOf = async (who: string, h: string, month = '') =>
  AlertsResponseSchema.parse(await (await call(who, 'GET', `/alerts${month ? `?month=${month}` : ''}`, { householdId: h })).json());

describe('alerts from a new spend', () => {
  it('crossing 90% of a category budget → one "near" alert, returned with the spend and stored', async () => {
    const { h, groceries } = await setup();
    expect((await spend('mem', h, groceries, 80_000)).alerts).toEqual([]);
    const { alerts } = await spend('mem', h, groceries, 12_000);
    expect(alerts.map((a) => [a.level, a.categoryId, a.body])).toEqual([
      ['near', groceries, 'Dela Cruz household has used 92% of its ₱1,000 Groceries budget'],
    ]);
    const list = await alertsOf('owner', h);
    expect(list.alerts).toHaveLength(1);
    expect(list.alerts[0]).toMatchObject({ level: 'near', triggeredBy: 'Mia Santos', unread: true });
  });

  it('then crossing 100% → "over"', async () => {
    const { h, groceries } = await setup();
    await spend('mem', h, groceries, 95_000); // near
    expect((await spend('mem', h, groceries, 10_000)).alerts.map((a) => [a.level, a.title])).toEqual([['over', 'Over budget · Groceries']]);
  });

  it('a category at 90–100%: every further spend in it sends "near" again, same title, updated percentage', async () => {
    const { h, groceries } = await setup();
    await spend('mem', h, groceries, 92_000);
    const again = await spend('owner', h, groceries, 3_000);
    expect(again.alerts.map((a) => [a.level, a.title, a.body])).toEqual([
      ['near', 'Nearly at budget · Groceries', 'Dela Cruz household has used 95% of its ₱1,000 Groceries budget'],
    ]);
    expect((await alertsOf('owner', h)).alerts.map((a) => a.level)).toEqual(['near', 'near']);
  });
  it('a category already over: every further spend in it sends "Still over budget" with the new amount', async () => {
    const { h, groceries } = await setup();
    await spend('mem', h, groceries, 110_000); // over by ₱100
    const second = await spend('owner', h, groceries, 25_000);
    expect(second.alerts.map((a) => [a.title, a.body])).toEqual([
      ['Still over budget · Groceries', 'Dela Cruz household is over its ₱1,000 Groceries budget by ₱350'],
    ]);
    const third = await spend('mem', h, groceries, 50);
    expect(third.alerts.map((a) => a.body)).toEqual(['Dela Cruz household is over its ₱1,000 Groceries budget by ₱350.50']);
    const list = (await alertsOf('owner', h)).alerts;
    expect(list.map((a) => a.title)).toEqual(['Still over budget · Groceries', 'Still over budget · Groceries', 'Over budget · Groceries']);
    expect(list[0]!.triggeredBy).toBe('Mia Santos');
  });
  it('the household total stays once a month, even while it is over', async () => {
    const { h, groceries } = await setup(100_000, 0); // ₱1,000 total, Groceries has no budget
    expect((await spend('owner', h, groceries, 120_000)).alerts.map((a) => [a.level, a.categoryId])).toEqual([['over', null]]);
    expect((await spend('owner', h, groceries, 5_000)).alerts).toEqual([]);
  });

  it('a spend in another category does not repeat the over-budget category', async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 120_000);
    const res = await call('owner', 'POST', '/categories', { householdId: h, body: { name: 'Transport', icon: 'car', colour: '#5A94FF', defaultBudgetMinor: 0 } });
    const transport = CategoryResponseSchema.parse(await res.json()).category.id;
    expect((await spend('owner', h, transport, 5_000)).alerts).toEqual([]);
  });

  it('simultaneous spends pushing a category over: exactly one first "over", the rest repeats, every save succeeds', async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 95_000);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        call('mem', 'POST', '/transactions', { householdId: h, body: { clientId: crypto.randomUUID(), date: '2026-11-25', categoryId: groceries, amountMinor: 10_000 } }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await db.collection(ALERTS).countDocuments({ scope: groceries, level: 'over', repeat: false })).toBe(1);
    expect(await db.collection(ALERTS).countDocuments({ scope: groceries, level: 'over' })).toBeGreaterThanOrEqual(1);
  });
  it('one spend can cross the category and the household total together', async () => {
    const { h, groceries } = await setup(100_000, 100_000);
    const { alerts } = await spend('owner', h, groceries, 150_000);
    expect(alerts.map((a) => [a.level, a.categoryId === null ? 'total' : 'category']).sort()).toEqual([
      ['over', 'category'],
      ['over', 'total'],
    ]);
    expect(alerts.find((a) => a.categoryId === null)!.body).toBe('Dela Cruz household is over its ₱1,000 monthly budget by ₱500');
  });

  it('jumping straight past 100% sends only "over"', async () => {
    const { h, groceries } = await setup();
    expect((await spend('owner', h, groceries, 120_000)).alerts.filter((a) => a.categoryId).map((a) => a.level)).toEqual(['over']);
  });

  it('after "over", dropping back to 90–100% (a delete) and spending again says "near" (its current state)', async () => {
    const { h, groceries } = await setup();
    const big = await spend('owner', h, groceries, 120_000); // over
    await call('owner', 'DELETE', `/transactions/${big.transaction.id}`, { householdId: h });
    expect((await spend('owner', h, groceries, 95_000)).alerts.filter((a) => a.categoryId).map((a) => a.level)).toEqual(['near']);
  });
  it('simultaneous spends that only together reach 90% still send an alert (never missed), with one first', async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 85_000);
    await Promise.all(
      [1, 2, 3].map(() =>
        call('mem', 'POST', '/transactions', { householdId: h, body: { clientId: crypto.randomUUID(), date: '2026-11-25', categoryId: groceries, amountMinor: 2_000 } }),
      ),
    );
    expect(await db.collection(ALERTS).countDocuments({ level: 'near', scope: groceries, repeat: false })).toBe(1);
  });
  it('a new month starts fresh', async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 95_000);
    clock = new Date('2026-12-02T02:00:00.000Z');
    expect((await spend('owner', h, groceries, 95_000, { date: '2026-12-02' })).alerts.map((a) => a.level)).toEqual(['near']);
    expect((await alertsOf('owner', h, '2026-11')).alerts).toHaveLength(1);
    expect((await alertsOf('owner', h, '2026-12')).alerts).toHaveLength(1);
  });

  it('a spend dated in an earlier month counts against that month', async () => {
    const { h, groceries } = await setup();
    const { alerts } = await spend('owner', h, groceries, 95_000, { date: '2026-10-31' });
    expect(alerts[0]).toMatchObject({ yearMonth: '2026-10', level: 'near' });
  });

  it('no budget (₱0) never fires', async () => {
    const { h, groceries } = await setup(0, 0);
    expect((await spend('owner', h, groceries, 9_999_999)).alerts).toEqual([]);
    expect(await db.collection(ALERTS).countDocuments()).toBe(0);
  });

  it('a retried save (same clientId) sends nothing new', async () => {
    const { h, groceries } = await setup();
    const body = { clientId: crypto.randomUUID(), date: '2026-11-25', categoryId: groceries, amountMinor: 95_000 };
    const first = CreateTransactionResponseSchema.parse(await (await call('mem', 'POST', '/transactions', { householdId: h, body })).json());
    const again = CreateTransactionResponseSchema.parse(await (await call('mem', 'POST', '/transactions', { householdId: h, body })).json());
    expect(first.alerts).toHaveLength(1);
    expect(again.alerts).toEqual([]);
    expect(await db.collection(ALERTS).countDocuments()).toBe(1);
  });

  it('deleting spending never fires; re-adding past 90% sends "near" again', async () => {
    const { h, groceries } = await setup();
    const { transaction } = await spend('owner', h, groceries, 95_000);
    const before = await db.collection(ALERTS).countDocuments();
    expect((await call('owner', 'DELETE', `/transactions/${transaction.id}`, { householdId: h })).status).toBe(204);
    expect(await db.collection(ALERTS).countDocuments()).toBe(before);
    expect((await spend('owner', h, groceries, 95_000)).alerts.map((a) => a.level)).toEqual(['near']);
  });
  it('simultaneous spends crossing the same line: one first alert, no errors', async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 85_000);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        call('mem', 'POST', '/transactions', { householdId: h, body: { clientId: crypto.randomUUID(), date: '2026-11-25', categoryId: groceries, amountMinor: 3_000 } }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await db.collection(ALERTS).countDocuments({ level: 'near', scope: groceries, repeat: false })).toBe(1);
  });
  it('alert text never includes the spend description (it can show on a lock screen)', async () => {
    const { h, groceries } = await setup();
    const { alerts } = await spend('owner', h, groceries, 120_000);
    expect(JSON.stringify(alerts)).not.toContain('Secret birthday gift');
    expect(JSON.stringify(await alertsOf('mem', h))).not.toContain('Secret birthday gift');
  });
});

describe('unread alerts (per member)', () => {
  it('everyone starts with them unread; marking read clears it for that member only', async () => {
    const { h, groceries } = await setup();
    await spend('mem', h, groceries, 95_000);
    expect((await alertsOf('owner', h)).unreadCount).toBe(1);
    expect((await alertsOf('mem', h)).unreadCount).toBe(1);
    tick();
    expect((await call('owner', 'POST', '/alerts/read', { householdId: h })).status).toBe(204);
    const owner = await alertsOf('owner', h);
    expect(owner.unreadCount).toBe(0);
    expect(owner.alerts[0]!.unread).toBe(false);
    expect((await alertsOf('mem', h)).unreadCount).toBe(1);
    await spend('mem', h, groceries, 10_000); // over
    expect((await alertsOf('owner', h)).unreadCount).toBe(1);
  });

  it('unread counts every month, not only the one shown', async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 95_000, { date: '2026-10-15' });
    expect((await alertsOf('owner', h, '2026-11')).unreadCount).toBe(1);
  });

  it("someone who joins later doesn't see older alerts as unread", async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 95_000);
    tick();
    await join(h, 'late', 'member');
    const late = await alertsOf('late', h);
    expect(late.alerts).toHaveLength(1); // still visible
    expect(late.unreadCount).toBe(0);
    expect(late.alerts[0]!.unread).toBe(false);
  });
});

describe('upgrading the alerts index from the first version', () => {
  it('existing alerts are kept and marked as firsts, the old index is replaced, and it can run again', async () => {
    const coll = db.collection(ALERTS);
    await coll.dropIndexes().catch(() => {});
    await coll.createIndex({ householdId: 1, yearMonth: 1, scope: 1, level: 1 }, { unique: true, name: 'one_per_crossing' });
    await coll.insertOne({ householdId: 'h', yearMonth: '2026-11', scope: 'total', level: 'over', createdAt: new Date() });
    await ensureAlertIndexes(db);
    await ensureAlertIndexes(db); // a second start-up is fine
    const names = (await coll.indexes()).map((i) => i.name);
    expect(names).toContain('first_per_crossing');
    expect(names).not.toContain('one_per_crossing');
    expect(await coll.findOne({ householdId: 'h' })).toMatchObject({ repeat: false });
    // Firsts are still unique...
    await expect(coll.insertOne({ householdId: 'h', yearMonth: '2026-11', scope: 'total', level: 'over', repeat: false })).rejects.toThrow(/duplicate key/);
    // ...repeats are not.
    await coll.insertOne({ householdId: 'h', yearMonth: '2026-11', scope: 'total', level: 'over', repeat: true });
    await coll.insertOne({ householdId: 'h', yearMonth: '2026-11', scope: 'total', level: 'over', repeat: true });
    expect(await coll.countDocuments({ householdId: 'h' })).toBe(3);
  });
});

describe('GET /alerts and POST /alerts/read (negative cases)', () => {
  it.each(['2026-13', 'nov', ''])('400 for month %j', async (month) => {
    const { h } = await setup();
    expect((await call('owner', 'GET', `/alerts?month=${month}`, { householdId: h })).status).toBe(400);
  });

  it("404 for someone outside the household; 401 without sign-in; never another household's alerts", async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 95_000);
    expect((await call('stranger', 'GET', '/alerts', { householdId: h })).status).toBe(404);
    expect((await call('stranger', 'POST', '/alerts/read', { householdId: h })).status).toBe(404);
    expect((await app.request('/alerts', { headers: { 'X-Household-Id': h } })).status).toBe(401);
    const other = HouseholdResponseSchema.parse(await (await call('other', 'POST', '/households', { body: { name: 'O', defaultMonthlyBudgetMinor: 0 } })).json()).household.id;
    expect((await alertsOf('other', other)).alerts).toEqual([]);
  });
});

describe('alerts are kept 7 days (to save space)', () => {
  it('MongoDB deletes them 7 days after they were made (TTL index)', async () => {
    const ttl = (await db.collection(ALERTS).indexes()).find((i) => i.name === 'ttl_7_days');
    expect(ttl).toMatchObject({ key: { createdAt: 1 }, expireAfterSeconds: 7 * 24 * 60 * 60 });
    expect(ALERT_RETENTION_DAYS).toBe(7);
  });

  it('a deleted alert doesn’t fire again later that month: the total stays once, a category says "Still over"', async () => {
    const { h, groceries } = await setup(100_000, 50_000);
    expect((await spend('mem', h, groceries, 120_000)).alerts.map((a) => [a.categoryId ? 'cat' : 'total', a.level])).toEqual([
      ['cat', 'over'],
      ['total', 'over'],
    ]);
    await db.collection(ALERTS).deleteMany({}); // as the TTL does after 7 days
    const { alerts } = await spend('mem', h, groceries, 1_000);
    expect(alerts.map((a) => a.title)).toEqual(['Still over budget · Groceries']); // no second "Over the monthly budget"
  });

  it('crossings are remembered ~2 months, then deleted too', async () => {
    const ttl = (await db.collection(ALERT_CROSSINGS).indexes()).find((i) => i.name === 'ttl');
    expect(ttl).toMatchObject({ key: { createdAt: 1 }, expireAfterSeconds: 70 * 24 * 60 * 60 });
  });

  it('upgrade: budget alerts recorded before crossings existed are remembered at start-up (can run again)', async () => {
    const hid = new ObjectId();
    await db.collection(ALERTS).insertOne({ householdId: hid, yearMonth: '2026-11', scope: 'total', level: 'over', repeat: false, createdAt: clock });
    await db.collection(ALERTS).insertOne({ householdId: hid, yearMonth: '2026-11', kind: 'daily_summary', scope: 'daily_summary:2026-11-24', level: 'near', repeat: false, createdAt: clock });
    await ensureAlertIndexes(db);
    await ensureAlertIndexes(db);
    expect(await db.collection(ALERT_CROSSINGS).find({ householdId: hid }, { projection: { _id: 0, scope: 1, level: 1 } }).toArray()).toEqual([
      { scope: 'total', level: 'over' },
    ]);
  });

  it('GET /alerts lists the last 7 days, across months; ?month= still lists one month', async () => {
    const { h } = await setup();
    const hid = new ObjectId(h);
    const at = (iso: string, title: string) =>
      db.collection(ALERTS).insertOne({
        householdId: hid, yearMonth: iso.slice(0, 7), kind: 'budget', scope: title, level: 'near', categoryId: null, title, body: title,
        budgetMinor: 0, spentMinor: 0, triggeredBy: hid, transactionId: null, repeat: true, createdAt: new Date(iso),
      });
    await at('2026-11-17T01:00:00.000Z', 'too old'); // 8 days before the clock (25 Nov 02:00 UTC); the TTL would have taken it
    await at('2026-11-20T01:00:00.000Z', 'five days ago');
    await at('2026-11-25T01:00:00.000Z', 'today');
    expect((await alertsOf('owner', h)).alerts.map((a) => a.title)).toEqual(['today', 'five days ago']);
    clock = new Date('2026-12-01T02:00:00.000Z'); // a new month: November's last 7 days still show
    expect((await alertsOf('owner', h)).alerts.map((a) => a.title)).toEqual(['today']);
    expect((await alertsOf('owner', h, '2026-11')).alerts.map((a) => a.title)).toEqual(['today', 'five days ago', 'too old']);
  });
});
