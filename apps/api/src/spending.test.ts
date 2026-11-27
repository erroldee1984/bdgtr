import {
  CategoriesResponseSchema,
  CategoryResponseSchema,
  CreatedInviteResponseSchema,
  DashboardSchema,
  HouseholdResponseSchema,
  MAX_CATEGORIES,
  TransactionResponseSchema,
  TransactionsResponseSchema,
} from '@bdgtr/shared';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CATEGORIES, ensureCategoryIndexes } from './categories.js';
import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { ensureHouseholdIndexes, HOUSEHOLDS, MEMBERSHIPS } from './households.js';
import { ensureInviteIndexes, INVITES } from './invites.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';
import { ensureTransactionIndexes, TRANSACTIONS } from './transactions.js';
import { ensureUserIndexes, USERS } from './users.js';
import { sharedMongo, type SharedMongo } from './test-utils/mongo.js';

const keys = makeTestKeys();
let mongo: SharedMongo;
let client: MongoClient;
let db: Db;
// 10:00 on 25 Nov 2026 in Manila.
let clock = new Date('2026-11-25T02:00:00.000Z');

beforeAll(async () => {
  mongo = await sharedMongo();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_spending_test');
  await Promise.all([
    ensureUserIndexes(db),
    ensureHouseholdIndexes(db),
    ensureInviteIndexes(db),
    ensureCategoryIndexes(db),
    ensureTransactionIndexes(db),
  ]);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  clock = new Date('2026-11-25T02:00:00.000Z');
  await Promise.all([USERS, HOUSEHOLDS, MEMBERSHIPS, INVITES, CATEGORIES, TRANSACTIONS].map((c) => db.collection(c).deleteMany({})));
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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${signTestToken(keys.privateKey, { sub: who, email: `${who}@example.com` })}`,
  };
  if (householdId) headers['X-Household-Id'] = householdId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}

/** Household with an Owner, a Co-Owner and a House Member (joined through real invites). */
async function setup() {
  const res = await call('owner', 'POST', '/households', { body: { name: 'Dela Cruz', defaultMonthlyBudgetMinor: 4_000_000 } });
  const h = HouseholdResponseSchema.parse(await res.json()).household;
  for (const [who, role] of [['co', 'co_owner'], ['mem', 'member']] as const) {
    const inv = CreatedInviteResponseSchema.parse(
      await (await call('owner', 'POST', '/invites', { householdId: h.id, body: { email: `${who}@example.com`, role } })).json(),
    );
    expect((await call(who, 'POST', '/invites/accept', { body: { token: inv.token } })).status).toBe(200);
  }
  // Groceries comes automatically; add a few more for the tests.
  for (const [name, icon] of EXTRA_CATEGORIES) {
    const r = await call('owner', 'POST', '/categories', { householdId: h.id, body: { name, icon, colour: '#5A94FF', defaultBudgetMinor: 0 } });
    expect(r.status).toBe(201);
  }
  return h.id;
}

const EXTRA_CATEGORIES = [['Dining out', 'food'], ['Transport', 'car'], ['Others', 'dots-horizontal']] as const;
/** Groceries + the extras. */
const SETUP_CATEGORY_COUNT = 1 + EXTRA_CATEGORIES.length;

async function categories(who: string, householdId: string) {
  return CategoriesResponseSchema.parse(await (await call(who, 'GET', '/categories', { householdId })).json()).categories;
}

const uuid = () => crypto.randomUUID();

async function spend(who: string, householdId: string, categoryId: string, amountMinor: number, extra: Record<string, unknown> = {}) {
  const res = await call(who, 'POST', '/transactions', {
    householdId,
    body: { clientId: uuid(), date: '2026-11-25', categoryId, amountMinor, ...extra },
  });
  expect(res.status).toBe(201);
  return TransactionResponseSchema.parse(await res.json()).transaction;
}

const NEW_CAT = { name: 'Pets', icon: 'paw', colour: '#C084FC', defaultBudgetMinor: 200_000 };

describe('categories', () => {
  it('a new household starts with just Groceries, visible to every role', async () => {
    const res = await call('owner', 'POST', '/households', { body: { name: 'Fresh', defaultMonthlyBudgetMinor: 0 } });
    const fresh = HouseholdResponseSchema.parse(await res.json()).household.id;
    expect((await categories('owner', fresh)).map((c) => [c.name, c.icon, c.isRemoved])).toEqual([['Groceries', 'cart', false]]);
    const h = await setup();
    for (const who of ['owner', 'co', 'mem']) expect((await categories(who, h)).some((c) => c.name === 'Groceries')).toBe(true);
  });

  it.each(['owner', 'co'])('%s can add, edit, remove and restore', async (who) => {
    const h = await setup();
    const created = await call(who, 'POST', '/categories', { householdId: h, body: NEW_CAT });
    expect(created.status).toBe(201);
    const cat = CategoryResponseSchema.parse(await created.json()).category;
    expect(cat).toMatchObject({ name: 'Pets', defaultBudgetMinor: 200_000, isRemoved: false });

    const edited = await call(who, 'PATCH', `/categories/${cat.id}`, { householdId: h, body: { name: 'Pet care', defaultBudgetMinor: 0 } });
    expect(CategoryResponseSchema.parse(await edited.json()).category).toMatchObject({ name: 'Pet care', defaultBudgetMinor: 0, icon: 'paw' });

    expect((await call(who, 'DELETE', `/categories/${cat.id}`, { householdId: h })).status).toBe(204);
    expect((await categories(who, h)).find((c) => c.id === cat.id)!.isRemoved).toBe(true);
    expect((await call(who, 'POST', `/categories/${cat.id}/restore`, { householdId: h })).status).toBe(204);
    expect((await categories(who, h)).find((c) => c.id === cat.id)!.isRemoved).toBe(false);
  });

  it('House Member cannot add, edit, remove or restore → 403, nothing changes', async () => {
    const h = await setup();
    const groceries = (await categories('owner', h)).find((c) => c.name === 'Groceries')!;
    expect((await call('mem', 'POST', '/categories', { householdId: h, body: NEW_CAT })).status).toBe(403);
    expect((await call('mem', 'PATCH', `/categories/${groceries.id}`, { householdId: h, body: { name: 'Mine' } })).status).toBe(403);
    expect((await call('mem', 'DELETE', `/categories/${groceries.id}`, { householdId: h })).status).toBe(403);
    expect((await call('mem', 'POST', `/categories/${groceries.id}/restore`, { householdId: h })).status).toBe(403);
    expect((await categories('owner', h)).find((c) => c.id === groceries.id)).toMatchObject({ name: 'Groceries', isRemoved: false });
  });

  it('duplicate names are refused, ignoring case and spaces → 409', async () => {
    const h = await setup();
    const res = await call('owner', 'POST', '/categories', { householdId: h, body: { ...NEW_CAT, name: '  dining   OUT ' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'category_exists' });
    const transport = (await categories('owner', h)).find((c) => c.name === 'Transport')!;
    expect((await call('owner', 'PATCH', `/categories/${transport.id}`, { householdId: h, body: { name: 'Groceries' } })).status).toBe(409);
  });

  it('a removed name can be reused; restoring the old one then clashes → 409', async () => {
    const h = await setup();
    const others = (await categories('owner', h)).find((c) => c.name === 'Others')!;
    await call('owner', 'DELETE', `/categories/${others.id}`, { householdId: h });
    expect((await call('owner', 'POST', '/categories', { householdId: h, body: { ...NEW_CAT, name: 'Others' } })).status).toBe(201);
    expect((await call('owner', 'POST', `/categories/${others.id}/restore`, { householdId: h })).status).toBe(409);
  });

  it.each([
    ['unknown icon', { ...NEW_CAT, icon: 'skull' }],
    ['colour outside the palette', { ...NEW_CAT, colour: '#123456' }],
    ['negative budget', { ...NEW_CAT, defaultBudgetMinor: -1 }],
    ['choosing the household in the body', { ...NEW_CAT, householdId: new ObjectId().toHexString() }],
  ])('400 for %s', async (_label, body) => {
    const h = await setup();
    expect((await call('owner', 'POST', '/categories', { householdId: h, body })).status).toBe(400);
  });

  it("another household's category, or a malformed id → 404, and it stays untouched", async () => {
    const h = await setup();
    const res = await call('other', 'POST', '/households', { body: { name: 'Other', defaultMonthlyBudgetMinor: 0 } });
    const other = HouseholdResponseSchema.parse(await res.json()).household.id;
    const theirs = (await categories('other', other))[0]!;
    for (const id of [theirs.id, 'nope']) {
      expect((await call('owner', 'PATCH', `/categories/${id}`, { householdId: h, body: { name: 'Hijack' } })).status).toBe(404);
      expect((await call('owner', 'DELETE', `/categories/${id}`, { householdId: h })).status).toBe(404);
      expect((await call('owner', 'POST', `/categories/${id}/restore`, { householdId: h })).status).toBe(404);
    }
    expect((await categories('other', other))[0]).toMatchObject({ name: theirs.name, isRemoved: false });
  });

  it('removing twice, or restoring an active category → 404', async () => {
    const h = await setup();
    const c = (await categories('owner', h))[0]!;
    expect((await call('owner', 'POST', `/categories/${c.id}/restore`, { householdId: h })).status).toBe(404);
    await call('owner', 'DELETE', `/categories/${c.id}`, { householdId: h });
    expect((await call('owner', 'DELETE', `/categories/${c.id}`, { householdId: h })).status).toBe(404);
  });

  it('a household with no active categories gets Groceries automatically when categories or the dashboard load', async () => {
    const h = await setup();
    // e.g. a household created before categories existed
    await db.collection(CATEGORIES).deleteMany({ householdId: new ObjectId(h) });
    expect((await categories('mem', h)).map((c) => c.name)).toEqual(['Groceries']);
    await db.collection(CATEGORIES).deleteMany({ householdId: new ObjectId(h) });
    const d = DashboardSchema.parse(await (await call('owner', 'GET', '/dashboard', { householdId: h })).json());
    expect(d.categories.map((c) => c.name)).toEqual(['Groceries']);
  });

  it('many simultaneous first loads still add Groceries only once', async () => {
    const h = await setup();
    await db.collection(CATEGORIES).deleteMany({ householdId: new ObjectId(h) });
    await Promise.all(['owner', 'co', 'mem', 'owner', 'co'].map((who) => call(who, 'GET', '/categories', { householdId: h })));
    expect(await db.collection(CATEGORIES).countDocuments({ householdId: new ObjectId(h), isRemoved: false })).toBe(1);
  });

  it('only active categories count: a household whose categories are all removed gets Groceries back', async () => {
    const h = await setup();
    await db.collection(CATEGORIES).updateMany({ householdId: new ObjectId(h) }, { $set: { isRemoved: true } });
    const list = await categories('owner', h);
    expect(list.filter((c) => !c.isRemoved).map((c) => c.name)).toEqual(['Groceries']);
  });

  it('the last active category cannot be removed → 409, and stays', async () => {
    const h = await setup();
    const all = await categories('owner', h);
    for (const c of all.slice(1)) expect((await call('owner', 'DELETE', `/categories/${c.id}`, { householdId: h })).status).toBe(204);
    const last = all[0]!;
    const res = await call('co', 'DELETE', `/categories/${last.id}`, { householdId: h });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'last_category' });
    expect((await categories('owner', h)).filter((c) => !c.isRemoved).map((c) => c.id)).toEqual([last.id]);
    // Once another exists (e.g. restored), it can be removed.
    expect((await call('owner', 'POST', `/categories/${all[1]!.id}/restore`, { householdId: h })).status).toBe(204);
    expect((await call('owner', 'DELETE', `/categories/${last.id}`, { householdId: h })).status).toBe(204);
  });

  // Never zero. In this rare race both may be refused (each sees the other's removal and
  // undoes its own); the person simply tries again.
  it('two people removing the last two categories at the same moment: never zero, at least one refused', async () => {
    const h = await setup();
    const all = await categories('owner', h);
    for (const c of all.slice(2)) await call('owner', 'DELETE', `/categories/${c.id}`, { householdId: h });
    const [a, b] = all;
    const statuses = (await Promise.all([
      call('owner', 'DELETE', `/categories/${a!.id}`, { householdId: h }),
      call('co', 'DELETE', `/categories/${b!.id}`, { householdId: h }),
    ])).map((r) => r.status);
    expect(statuses).toContain(409);
    const left = await db.collection(CATEGORIES).countDocuments({ householdId: new ObjectId(h), isRemoved: false });
    expect(left).toBeGreaterThanOrEqual(1);
    expect(left).toBe(2 - statuses.filter((x) => x === 204).length);
  });

  it(`409 at ${MAX_CATEGORIES} categories (removed ones count)`, async () => {
    const h = await setup();
    const now = new Date();
    const extra = Array.from({ length: MAX_CATEGORIES - SETUP_CATEGORY_COUNT }, (_, i) => ({
      householdId: new ObjectId(h), name: `C${i}`, nameKey: `c${i}`, icon: 'cart', colour: '#4ADE80', defaultBudgetMinor: 0,
      isRemoved: true, removedAt: now, createdBy: new ObjectId(), createdAt: now, updatedAt: now,
    }));
    await db.collection(CATEGORIES).insertMany(extra);
    const res = await call('owner', 'POST', '/categories', { householdId: h, body: NEW_CAT });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'category_limit' });
  });

  it('most-used counts only the last 90 days', async () => {
    const h = await setup();
    const food = (await categories('owner', h)).find((c) => c.name === 'Dining out')!;
    await spend('owner', h, food.id, 100);
    await spend('owner', h, food.id, 100, { date: '2026-08-27' }); // exactly 90 days back: counts
    await spend('owner', h, food.id, 100, { date: '2026-08-26' }); // 91 days back: doesn't
    expect((await categories('owner', h)).find((c) => c.id === food.id)!.recentUseCount).toBe(2);
  });

  it('401 without sign-in, 404 for a non-member', async () => {
    const h = await setup();
    expect((await app.request('/categories', { headers: { 'X-Household-Id': h } })).status).toBe(401);
    expect((await call('stranger', 'GET', '/categories', { householdId: h })).status).toBe(404);
  });
});

describe('transactions', () => {
  async function ready() {
    const h = await setup();
    const cats = await categories('owner', h);
    return { h, food: cats.find((c) => c.name === 'Dining out')!, bus: cats.find((c) => c.name === 'Transport')! };
  }

  it.each(['owner', 'co', 'mem'])('%s can enter a spend', async (who) => {
    const { h, food } = await ready();
    const tx = await spend(who, h, food.id, 25_050, { description: 'Lunch' });
    expect(tx).toMatchObject({ date: '2026-11-25', yearMonth: '2026-11', categoryId: food.id, amountMinor: 25_050, description: 'Lunch', isYours: true });
  });

  it('saving the same clientId twice keeps one transaction and returns the original (200)', async () => {
    const { h, food, bus } = await ready();
    const clientId = uuid();
    const first = await call('mem', 'POST', '/transactions', { householdId: h, body: { clientId, date: '2026-11-25', categoryId: food.id, amountMinor: 100 } });
    expect(first.status).toBe(201);
    const again = await call('mem', 'POST', '/transactions', { householdId: h, body: { clientId, date: '2026-11-24', categoryId: bus.id, amountMinor: 999 } });
    expect(again.status).toBe(200);
    expect(TransactionResponseSchema.parse(await again.json()).transaction).toMatchObject({ amountMinor: 100, categoryId: food.id });
    expect(await db.collection(TRANSACTIONS).countDocuments({ clientId })).toBe(1);
  });

  it('two simultaneous saves with the same clientId still make one transaction', async () => {
    const { h, food } = await ready();
    const body = { clientId: uuid(), date: '2026-11-25', categoryId: food.id, amountMinor: 100 };
    const statuses = (await Promise.all([1, 2, 3].map(() => call('mem', 'POST', '/transactions', { householdId: h, body })))).map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 200 || s === 201)).toBe(true);
    expect(await db.collection(TRANSACTIONS).countDocuments({ clientId: body.clientId })).toBe(1);
  });

  it('the same clientId in another household is a different transaction', async () => {
    const { h, food } = await ready();
    const res = await call('owner', 'POST', '/households', { body: { name: 'Second', defaultMonthlyBudgetMinor: 0 } });
    const h2 = HouseholdResponseSchema.parse(await res.json()).household.id;
    const food2 = (await categories('owner', h2)).find((c) => c.name === 'Groceries')!;
    const clientId = uuid();
    expect((await call('owner', 'POST', '/transactions', { householdId: h, body: { clientId, date: '2026-11-25', categoryId: food.id, amountMinor: 1 } })).status).toBe(201);
    expect((await call('owner', 'POST', '/transactions', { householdId: h2, body: { clientId, date: '2026-11-25', categoryId: food2.id, amountMinor: 1 } })).status).toBe(201);
  });

  it.each([
    ['zero amount', { amountMinor: 0 }],
    ['negative amount', { amountMinor: -5 }],
    ['non-numeric amount', { amountMinor: 'abc' }],
    ['3 decimal places (fractional centavos)', { amountMinor: 1.5 }],
    ['missing clientId', { clientId: undefined }],
    ['malformed clientId', { clientId: 'abc' }],
    ['impossible date', { date: '2026-02-30' }],
    ['description over 500 characters', { description: 'x'.repeat(501) }],
    ['NoSQL operator', { categoryId: { $gt: '' } }],
  ])('400 for %s; nothing saved', async (_label, patch) => {
    const { h, food } = await ready();
    const body = { clientId: uuid(), date: '2026-11-25', categoryId: food.id, amountMinor: 100, ...patch };
    expect((await call('owner', 'POST', '/transactions', { householdId: h, body })).status).toBe(400);
    expect(await db.collection(TRANSACTIONS).countDocuments()).toBe(0);
  });

  it('a date more than a year ahead (Manila) → 400; exactly a year ahead is fine', async () => {
    const { h, food } = await ready();
    const at = (date: string) => call('owner', 'POST', '/transactions', { householdId: h, body: { clientId: uuid(), date, categoryId: food.id, amountMinor: 1 } });
    expect((await at('2027-11-25')).status).toBe(201);
    const res = await at('2027-11-26');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_input', issues: [{ path: 'date', message: 'Date is more than a year ahead' }] });
  });

  it("removed category → 409; another household's or unknown category → 404", async () => {
    const { h, food } = await ready();
    await call('owner', 'DELETE', `/categories/${food.id}`, { householdId: h });
    const post = (categoryId: string) => call('mem', 'POST', '/transactions', { householdId: h, body: { clientId: uuid(), date: '2026-11-25', categoryId, amountMinor: 1 } });
    expect(await (await post(food.id)).json()).toEqual({ error: 'category_removed' });
    const other = HouseholdResponseSchema.parse(await (await call('other', 'POST', '/households', { body: { name: 'O', defaultMonthlyBudgetMinor: 0 } })).json()).household.id;
    const theirs = (await categories('other', other))[0]!;
    for (const id of [theirs.id, new ObjectId().toHexString()]) expect((await post(id)).status).toBe(404);
    expect(await db.collection(TRANSACTIONS).countDocuments()).toBe(0);
  });

  it('lists a month newest first, marking which are yours; other months excluded', async () => {
    const { h, food } = await ready();
    await spend('owner', h, food.id, 1, { date: '2026-11-03' });
    await spend('mem', h, food.id, 2, { date: '2026-11-20' });
    await spend('mem', h, food.id, 3, { date: '2026-10-31' });
    const res = await call('mem', 'GET', '/transactions?month=2026-11', { householdId: h });
    const list = TransactionsResponseSchema.parse(await res.json()).transactions;
    expect(list.map((t) => [t.date, t.isYours])).toEqual([
      ['2026-11-20', true],
      ['2026-11-03', false],
    ]);
    expect((await call('mem', 'GET', '/transactions?month=2026-13', { householdId: h })).status).toBe(400);
  });

  describe('edit and delete (D1: House Members only their own)', () => {
    it('House Member edits and deletes their own', async () => {
      const { h, food, bus } = await ready();
      const tx = await spend('mem', h, food.id, 100);
      const res = await call('mem', 'PATCH', `/transactions/${tx.id}`, { householdId: h, body: { amountMinor: 150, categoryId: bus.id, date: '2026-10-31' } });
      expect(TransactionResponseSchema.parse(await res.json()).transaction).toMatchObject({ amountMinor: 150, categoryId: bus.id, yearMonth: '2026-10' });
      expect((await call('mem', 'DELETE', `/transactions/${tx.id}`, { householdId: h })).status).toBe(204);
      expect(await db.collection(TRANSACTIONS).countDocuments()).toBe(0);
    });

    it("House Member cannot edit or delete someone else's → 403, unchanged", async () => {
      const { h, food } = await ready();
      const tx = await spend('owner', h, food.id, 100);
      expect((await call('mem', 'PATCH', `/transactions/${tx.id}`, { householdId: h, body: { amountMinor: 1 } })).status).toBe(403);
      expect((await call('mem', 'DELETE', `/transactions/${tx.id}`, { householdId: h })).status).toBe(403);
      expect((await db.collection(TRANSACTIONS).findOne({ _id: new ObjectId(tx.id) }))!.amountMinor).toBe(100);
    });

    it.each(['owner', 'co'])("%s can edit and delete anyone's", async (who) => {
      const { h, food } = await ready();
      const tx = await spend('mem', h, food.id, 100);
      expect((await call(who, 'PATCH', `/transactions/${tx.id}`, { householdId: h, body: { description: 'Fixed typo' } })).status).toBe(200);
      expect((await call(who, 'DELETE', `/transactions/${tx.id}`, { householdId: h })).status).toBe(204);
    });

    it('cannot move a spend into a removed category (409), but can edit one already in it', async () => {
      const { h, food, bus } = await ready();
      const inFood = await spend('owner', h, food.id, 100);
      const inBus = await spend('owner', h, bus.id, 100);
      await call('owner', 'DELETE', `/categories/${food.id}`, { householdId: h });
      expect((await call('owner', 'PATCH', `/transactions/${inBus.id}`, { householdId: h, body: { categoryId: food.id } })).status).toBe(409);
      expect((await call('owner', 'PATCH', `/transactions/${inFood.id}`, { householdId: h, body: { amountMinor: 5 } })).status).toBe(200);
    });

    it("404 for unknown, malformed or another household's transaction; 400 for bad changes", async () => {
      const { h, food } = await ready();
      const other = HouseholdResponseSchema.parse(await (await call('other', 'POST', '/households', { body: { name: 'O', defaultMonthlyBudgetMinor: 0 } })).json()).household.id;
      const theirs = await spend('other', other, (await categories('other', other))[0]!.id, 100);
      for (const id of [theirs.id, new ObjectId().toHexString(), 'bad']) {
        expect((await call('owner', 'PATCH', `/transactions/${id}`, { householdId: h, body: { amountMinor: 1 } })).status).toBe(404);
        expect((await call('owner', 'DELETE', `/transactions/${id}`, { householdId: h })).status).toBe(404);
      }
      const mine = await spend('owner', h, food.id, 100);
      for (const body of [{}, { amountMinor: 0 }, { clientId: uuid() }]) {
        expect((await call('owner', 'PATCH', `/transactions/${mine.id}`, { householdId: h, body })).status).toBe(400);
      }
      expect((await call('owner', 'PATCH', `/transactions/${mine.id}`, { householdId: h, body: { date: '2028-01-01' } })).status).toBe(400);
    });
  });
});

describe('GET /dashboard', () => {
  it('budget, spent, remaining and per-category bars for the current Manila month', async () => {
    const h = await setup();
    const cats = await categories('owner', h);
    const food = cats.find((c) => c.name === 'Dining out')!;
    const bus = cats.find((c) => c.name === 'Transport')!;
    await call('owner', 'PATCH', `/categories/${food.id}`, { householdId: h, body: { defaultBudgetMinor: 500_000 } });
    await spend('mem', h, food.id, 600_000);
    await spend('co', h, bus.id, 150_000);
    await spend('co', h, bus.id, 99, { date: '2026-10-31' }); // last month: not counted
    const res = await call('mem', 'GET', '/dashboard', { householdId: h });
    const d = DashboardSchema.parse(await res.json());
    expect(d).toMatchObject({ month: '2026-11', totalBudgetMinor: 4_000_000, spentMinor: 750_000, remainingMinor: 3_250_000 });
    expect(d.categories[0]).toMatchObject({ name: 'Dining out', budgetMinor: 500_000, spentMinor: 600_000 });
    expect(d.categories[1]).toMatchObject({ name: 'Transport', spentMinor: 150_000 });
    expect(d.categories).toHaveLength(SETUP_CATEGORY_COUNT);
  });

  it('at 23:30 on 30 Nov UTC it is already December in Manila', async () => {
    const h = await setup();
    clock = new Date('2026-11-30T23:30:00.000Z');
    expect(DashboardSchema.parse(await (await call('owner', 'GET', '/dashboard', { householdId: h })).json()).month).toBe('2026-12');
  });

  it('over budget → negative remaining; another month by ?month=', async () => {
    const h = await setup();
    const food = (await categories('owner', h))[0]!;
    await spend('owner', h, food.id, 5_000_000, { date: '2026-10-15' });
    const d = DashboardSchema.parse(await (await call('owner', 'GET', '/dashboard?month=2026-10', { householdId: h })).json());
    expect(d).toMatchObject({ month: '2026-10', spentMinor: 5_000_000, remainingMinor: -1_000_000 });
  });

  it('a removed category with spending still shows that month', async () => {
    const h = await setup();
    const food = (await categories('owner', h)).find((c) => c.name === 'Dining out')!;
    await spend('owner', h, food.id, 100);
    await call('owner', 'DELETE', `/categories/${food.id}`, { householdId: h });
    const d = DashboardSchema.parse(await (await call('owner', 'GET', '/dashboard', { householdId: h })).json());
    expect(d.categories.find((c) => c.id === food.id)).toMatchObject({ isRemoved: true, spentMinor: 100 });
  });

  it.each(['2026-13', '2026-1', 'november', ''])('400 for month %j', async (month) => {
    const h = await setup();
    expect((await call('owner', 'GET', `/dashboard?month=${month}`, { householdId: h })).status).toBe(400);
  });

  it("never mixes in another household's spending", async () => {
    const h = await setup();
    const other = HouseholdResponseSchema.parse(await (await call('other', 'POST', '/households', { body: { name: 'O', defaultMonthlyBudgetMinor: 0 } })).json()).household.id;
    await spend('other', other, (await categories('other', other))[0]!.id, 777);
    expect(DashboardSchema.parse(await (await call('owner', 'GET', '/dashboard', { householdId: h })).json()).spentMinor).toBe(0);
  });
});
