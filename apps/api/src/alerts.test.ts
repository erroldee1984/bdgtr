import {
  AlertsResponseSchema,
  CategoriesResponseSchema,
  CreatedInviteResponseSchema,
  CreateTransactionResponseSchema,
  HouseholdResponseSchema,
} from '@bdgtr/shared';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALERTS, ensureAlertIndexes } from './alerts.js';
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
  await Promise.all([USERS, HOUSEHOLDS, MEMBERSHIPS, INVITES, CATEGORIES, TRANSACTIONS, ALERTS].map((c) => db.collection(c).deleteMany({})));
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

  it('then crossing 100% → "over"; neither fires again this month', async () => {
    const { h, groceries } = await setup();
    await spend('mem', h, groceries, 95_000); // near
    expect((await spend('mem', h, groceries, 10_000)).alerts.map((a) => a.level)).toEqual(['over']);
    expect((await spend('mem', h, groceries, 50_000)).alerts).toEqual([]);
    expect((await alertsOf('owner', h)).alerts.map((a) => a.level)).toEqual(['over', 'near']); // newest first
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

  it('after "over", dropping back under 100% (a delete) and spending again does not send "near"', async () => {
    const { h, groceries } = await setup();
    const big = await spend('owner', h, groceries, 120_000); // over
    await call('owner', 'DELETE', `/transactions/${big.transaction.id}`, { householdId: h });
    expect((await spend('owner', h, groceries, 95_000)).alerts.filter((a) => a.categoryId)).toEqual([]);
  });

  // Regression (found while building M2b): simultaneous spends that together crossed 90%
  // each saw the others as "already there" and none fired. Now the level reached is judged.
  it('simultaneous spends that only together reach 90% still send exactly one alert', async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 85_000);
    await Promise.all(
      [1, 2, 3].map(() =>
        call('mem', 'POST', '/transactions', { householdId: h, body: { clientId: crypto.randomUUID(), date: '2026-11-25', categoryId: groceries, amountMinor: 2_000 } }),
      ),
    );
    expect(await db.collection(ALERTS).countDocuments({ level: 'near', scope: groceries })).toBe(1);
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

  it('deleting spending never fires, and re-adding past 90% does not repeat "near"', async () => {
    const { h, groceries } = await setup();
    const { transaction } = await spend('owner', h, groceries, 95_000);
    expect((await call('owner', 'DELETE', `/transactions/${transaction.id}`, { householdId: h })).status).toBe(204);
    expect((await spend('owner', h, groceries, 95_000)).alerts).toEqual([]);
    expect(await db.collection(ALERTS).countDocuments()).toBe(1);
  });

  it('simultaneous spends crossing the same line create one alert', async () => {
    const { h, groceries } = await setup();
    await spend('owner', h, groceries, 85_000);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        call('mem', 'POST', '/transactions', { householdId: h, body: { clientId: crypto.randomUUID(), date: '2026-11-25', categoryId: groceries, amountMinor: 3_000 } }),
      ),
    );
    const sent = (await Promise.all(results.map(async (r) => CreateTransactionResponseSchema.parse(await r.json()).alerts))).flat();
    expect(sent.filter((a) => a.categoryId).length).toBeLessThanOrEqual(1);
    expect(await db.collection(ALERTS).countDocuments({ level: 'near', scope: groceries })).toBe(1);
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
