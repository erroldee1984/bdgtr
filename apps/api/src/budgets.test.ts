import {
  CategoriesResponseSchema,
  CategoryResponseSchema,
  CreatedInviteResponseSchema,
  CreateTransactionResponseSchema,
  DashboardSchema,
  HouseholdResponseSchema,
  MonthBudgetsSchema,
} from '@bdgtr/shared';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALERT_CROSSINGS, ALERTS, ensureAlertIndexes } from './alerts.js';
import { CATEGORY_BUDGETS, ensureBudgetIndexes, MONTHLY_BUDGETS } from './budgets.js';
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
const clock = new Date('2026-11-25T02:00:00.000Z'); // November in Manila

beforeAll(async () => {
  mongo = await sharedMongo();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_budgets_test');
  await Promise.all([
    ensureUserIndexes(db), ensureHouseholdIndexes(db), ensureInviteIndexes(db), ensureCategoryIndexes(db),
    ensureTransactionIndexes(db), ensureAlertIndexes(db), ensureBudgetIndexes(db),
  ]);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(
    [USERS, HOUSEHOLDS, MEMBERSHIPS, INVITES, CATEGORIES, TRANSACTIONS, ALERTS, ALERT_CROSSINGS, MONTHLY_BUDGETS, CATEGORY_BUDGETS].map((c) => db.collection(c).deleteMany({})),
  );
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
  const headers: Record<string, string> = { Authorization: `Bearer ${signTestToken(keys.privateKey, { sub: who, email: `${who}@example.com` })}` };
  if (householdId) headers['X-Household-Id'] = householdId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

/** Owner + House Member; ₱40,000 a month; Groceries ₱8,000 by default. */
async function setup() {
  const h = HouseholdResponseSchema.parse(
    await (await call('owner', 'POST', '/households', { body: { name: 'Dela Cruz', defaultMonthlyBudgetMinor: 4_000_000 } })).json(),
  ).household.id;
  const inv = CreatedInviteResponseSchema.parse(await (await call('owner', 'POST', '/invites', { householdId: h, body: { email: 'mem@example.com', role: 'member' } })).json());
  await call('mem', 'POST', '/invites/accept', { body: { token: inv.token } });
  // New households start with only the built-in Unbudgeted category: add Groceries for the tests.
  const groceries = CategoryResponseSchema.parse(
    await (await call('owner', 'POST', '/categories', { householdId: h, body: { name: 'Groceries', icon: 'cart', colour: '#4ADE80', defaultBudgetMinor: 800_000 } })).json(),
  ).category.id;
  return { h, groceries };
}
const budgets = async (who: string, h: string, month?: string) => {
  const res = await call(who, 'GET', `/budgets${month ? `?month=${month}` : ''}`, { householdId: h });
  expect(res.status).toBe(200);
  return MonthBudgetsSchema.parse(await res.json());
};
const dashboard = async (h: string, month: string) => DashboardSchema.parse(await (await call('owner', 'GET', `/dashboard?month=${month}`, { householdId: h })).json());
const spend = async (h: string, categoryId: string, amountMinor: number, date = '2026-11-25') =>
  CreateTransactionResponseSchema.parse(
    await (await call('mem', 'POST', '/transactions', { householdId: h, body: { clientId: crypto.randomUUID(), date, categoryId, amountMinor } })).json(),
  );

describe('GET /budgets', () => {
  it('no overrides: the defaults apply; everyone can see them (this month by default)', async () => {
    const { h, groceries } = await setup();
    const b = await budgets('mem', h);
    expect(b).toMatchObject({ month: '2026-11', defaultMonthlyBudgetMinor: 4_000_000, monthlyOverrideMinor: null, totalBudgetMinor: 4_000_000 });
    expect(b.categories).toEqual([
      { id: groceries, name: 'Groceries', icon: expect.any(String), colour: expect.any(String), defaultBudgetMinor: 800_000, overrideMinor: null, budgetMinor: 800_000, kind: 'normal' },
      // The built-in Unbudgeted category: the rest of the month's total, listed last.
      { id: expect.any(String), name: 'Unbudgeted', icon: 'dots-horizontal', colour: '#FF6B6B', defaultBudgetMinor: 3_200_000, overrideMinor: null, budgetMinor: 3_200_000, kind: 'unbudgeted' },
    ]);
    expect(b.thisMonth).toEqual({ allocatedMinor: 800_000, unallocatedMinor: 3_200_000, percentAllocated: 20 });
  });

  it('removed categories are not listed', async () => {
    const { h } = await setup();
    const extra = CategoryResponseSchema.parse(await (await call('owner', 'POST', '/categories', { householdId: h, body: { name: 'Old', icon: 'cart', colour: '#5A94FF', defaultBudgetMinor: 100 } })).json()).category.id;
    await call('owner', 'DELETE', `/categories/${extra}`, { householdId: h });
    expect((await budgets('owner', h)).categories.map((c) => c.name)).toEqual(['Groceries', 'Unbudgeted']);
  });

  it.each(['2026-13', '1999-12', '2100-01', 'nov'])('400 for month %s', async (m) => {
    const { h } = await setup();
    expect((await call('owner', 'GET', `/budgets?month=${m}`, { householdId: h })).status).toBe(400);
  });

  it('404 outside the household; 401 signed out', async () => {
    const { h } = await setup();
    expect((await call('stranger', 'GET', '/budgets', { householdId: h })).status).toBe(404);
    expect((await app.request('/budgets', { headers: { 'X-Household-Id': h } })).status).toBe(401);
  });
});

describe('Unbudgeted: automatic budget', () => {
  const unbudgetedOf = async (h: string, month?: string) => (await budgets('owner', h, month)).categories.find((c) => c.kind === 'unbudgeted')!;

  it('follows the month’s total and the other categories, never below ₱0; dashboard and alerts agree', async () => {
    const { h, groceries } = await setup(); // ₱40,000; Groceries ₱8,000
    expect((await unbudgetedOf(h)).budgetMinor).toBe(3_200_000);
    await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 3_900_000 } });
    expect((await unbudgetedOf(h)).budgetMinor).toBe(100_000);
    const dash = await dashboard(h, '2026-11');
    expect(dash.categories.find((c) => c.name === 'Unbudgeted')!.budgetMinor).toBe(100_000);
    await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 4_500_000 } });
    expect((await unbudgetedOf(h)).budgetMinor).toBe(0); // over-allocated
    expect((await unbudgetedOf(h, '2026-12')).budgetMinor).toBe(3_200_000); // another month: the defaults
  });

  it('can’t be set by hand: month budget, reset, or its default → 409', async () => {
    const { h } = await setup();
    const u = (await unbudgetedOf(h)).id;
    expect((await call('owner', 'PUT', `/budgets/categories/2026-11/${u}`, { householdId: h, body: { budgetMinor: 1 } })).status).toBe(409);
    expect((await call('owner', 'DELETE', `/budgets/categories/2026-11/${u}`, { householdId: h })).status).toBe(409);
    const patch = await call('owner', 'PATCH', `/categories/${u}`, { householdId: h, body: { defaultBudgetMinor: 1 } });
    expect(patch.status).toBe(409);
    expect(await patch.json()).toEqual({ error: 'protected_category' });
  });

  it('spending in Unbudgeted is alerted against its automatic budget', async () => {
    const { h, groceries } = await setup();
    await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 3_900_000 } }); // Unbudgeted ₱1,000
    const u = (await unbudgetedOf(h)).id;
    const res = await call('owner', 'POST', '/transactions', {
      householdId: h,
      body: { clientId: '00000000-0000-4000-8000-0000000000aa', date: '2026-11-25', categoryId: u, amountMinor: 95_000 },
    });
    const { alerts } = CreateTransactionResponseSchema.parse(await res.json());
    expect(alerts.map((a) => [a.level, a.title])).toEqual([['near', 'Nearly at budget · Unbudgeted']]);
  });
});

describe('this month’s total', () => {
  it('an override applies to that month only, on the dashboard too; reset falls back to the default', async () => {
    const { h } = await setup();
    const res = await call('owner', 'PUT', '/budgets/monthly/2026-12', { householdId: h, body: { budgetMinor: 5_000_000 } });
    expect(res.status).toBe(200);
    expect(MonthBudgetsSchema.parse(await res.json())).toMatchObject({ month: '2026-12', monthlyOverrideMinor: 5_000_000, totalBudgetMinor: 5_000_000 });
    expect((await dashboard(h, '2026-12')).totalBudgetMinor).toBe(5_000_000);
    expect((await dashboard(h, '2026-11')).totalBudgetMinor).toBe(4_000_000);

    const reset = MonthBudgetsSchema.parse(await (await call('owner', 'DELETE', '/budgets/monthly/2026-12', { householdId: h })).json());
    expect(reset).toMatchObject({ monthlyOverrideMinor: null, totalBudgetMinor: 4_000_000 });
    expect(await db.collection(MONTHLY_BUDGETS).countDocuments()).toBe(0);
    expect((await call('owner', 'DELETE', '/budgets/monthly/2026-12', { householdId: h })).status).toBe(200); // again: fine
  });

  it('setting the default’s own value stores no override, so later default changes still flow in', async () => {
    const { h } = await setup();
    await call('owner', 'PUT', '/budgets/monthly/2026-12', { householdId: h, body: { budgetMinor: 4_000_000 } });
    expect(await db.collection(MONTHLY_BUDGETS).countDocuments()).toBe(0);
    await call('owner', 'PATCH', '/household', { householdId: h, body: { defaultMonthlyBudgetMinor: 4_500_000 } });
    expect((await budgets('owner', h, '2026-12')).totalBudgetMinor).toBe(4_500_000);
  });

  it('a changed default flows into months without an override, not into a month with one', async () => {
    const { h } = await setup();
    await call('owner', 'PUT', '/budgets/monthly/2026-12', { householdId: h, body: { budgetMinor: 5_000_000 } });
    await call('owner', 'PATCH', '/household', { householdId: h, body: { defaultMonthlyBudgetMinor: 3_000_000 } });
    expect((await budgets('owner', h, '2026-11')).totalBudgetMinor).toBe(3_000_000);
    expect((await budgets('owner', h, '2026-12')).totalBudgetMinor).toBe(5_000_000);
  });

  it('₱0 for a month is allowed (a no-spend month)', async () => {
    const { h } = await setup();
    const b = MonthBudgetsSchema.parse(await (await call('owner', 'PUT', '/budgets/monthly/2026-12', { householdId: h, body: { budgetMinor: 0 } })).json());
    expect(b.totalBudgetMinor).toBe(0);
  });

  it('two saves at once leave one override', async () => {
    const { h } = await setup();
    const results = await Promise.all(
      [5_000_000, 6_000_000, 7_000_000].map((v) => call('owner', 'PUT', '/budgets/monthly/2026-12', { householdId: h, body: { budgetMinor: v } })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await db.collection(MONTHLY_BUDGETS).countDocuments()).toBe(1);
  });
});

describe('a category this month', () => {
  it('an override changes the month’s category budget (dashboard too); reset falls back', async () => {
    const { h, groceries } = await setup();
    const b = MonthBudgetsSchema.parse(
      await (await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 1_200_000 } })).json(),
    );
    expect(b.categories[0]).toMatchObject({ defaultBudgetMinor: 800_000, overrideMinor: 1_200_000, budgetMinor: 1_200_000 });
    expect(b.thisMonth.allocatedMinor).toBe(1_200_000);
    expect(b.defaults.allocatedMinor).toBe(800_000);
    expect((await dashboard(h, '2026-11')).categories[0]!.budgetMinor).toBe(1_200_000);
    expect((await dashboard(h, '2026-10')).categories[0]!.budgetMinor).toBe(800_000);

    await call('owner', 'DELETE', `/budgets/categories/2026-11/${groceries}`, { householdId: h });
    expect((await budgets('owner', h)).categories[0]).toMatchObject({ overrideMinor: null, budgetMinor: 800_000 });
    expect(await db.collection(CATEGORY_BUDGETS).countDocuments()).toBe(0);
  });

  it('the default’s own value stores no override', async () => {
    const { h, groceries } = await setup();
    await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 800_000 } });
    expect(await db.collection(CATEGORY_BUDGETS).countDocuments()).toBe(0);
  });

  it('over-allocated: unallocated goes negative (a warning, not an error)', async () => {
    const { h, groceries } = await setup();
    const b = MonthBudgetsSchema.parse(
      await (await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 5_000_000 } })).json(),
    );
    expect(b.thisMonth).toEqual({ allocatedMinor: 5_000_000, unallocatedMinor: -1_000_000, percentAllocated: 125 });
  });

  it('404 for an unknown or malformed category, or another household’s; 409 for a removed one', async () => {
    const { h, groceries } = await setup();
    const other = HouseholdResponseSchema.parse(await (await call('owner', 'POST', '/households', { body: { name: 'Other', defaultMonthlyBudgetMinor: 0 } })).json()).household.id;
    expect((await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: other, body: { budgetMinor: 1 } })).status).toBe(404);
    expect((await call('owner', 'PUT', `/budgets/categories/2026-11/${'0'.repeat(24)}`, { householdId: h, body: { budgetMinor: 1 } })).status).toBe(404);
    expect((await call('owner', 'PUT', '/budgets/categories/2026-11/nope', { householdId: h, body: { budgetMinor: 1 } })).status).toBe(404);
    const extra = CategoryResponseSchema.parse(await (await call('owner', 'POST', '/categories', { householdId: h, body: { name: 'Old', icon: 'cart', colour: '#5A94FF', defaultBudgetMinor: 100 } })).json()).category.id;
    await call('owner', 'DELETE', `/categories/${extra}`, { householdId: h });
    expect((await call('owner', 'PUT', `/budgets/categories/2026-11/${extra}`, { householdId: h, body: { budgetMinor: 1 } })).status).toBe(409);
    expect((await call('owner', 'DELETE', `/budgets/categories/2026-11/${extra}`, { householdId: h })).status).toBe(409);
  });
});

describe('alerts follow the month’s budgets', () => {
  it('a lowered category budget for the month sets off "nearly at budget" sooner', async () => {
    const { h, groceries } = await setup();
    await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 500_000 } });
    const { alerts } = await spend(h, groceries, 460_000); // 92% of ₱5,000 (58% of the ₱8,000 default)
    expect(alerts.map((a) => a.title)).toEqual(['Nearly at budget · Groceries']);
    expect(alerts[0]!.body).toContain('₱5,000');
  });

  it('a raised budget for the month means no alert where the default would have fired', async () => {
    const { h, groceries } = await setup();
    await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 2_000_000 } });
    expect((await spend(h, groceries, 900_000)).alerts).toEqual([]); // over ₱8,000 but 45% of ₱20,000
  });

  it('the household total uses the month’s override too; another month uses the default', async () => {
    const { h, groceries } = await setup();
    await call('owner', 'PUT', `/budgets/categories/2026-11/${groceries}`, { householdId: h, body: { budgetMinor: 10_000_000 } });
    await call('owner', 'PUT', '/budgets/monthly/2026-11', { householdId: h, body: { budgetMinor: 1_000_000 } });
    const { alerts } = await spend(h, groceries, 950_000);
    expect(alerts.map((a) => a.title)).toEqual(['Nearly at the monthly budget']);
    const october = (await spend(h, groceries, 950_000, '2026-10-05')).alerts; // October: ₱40,000 default total
    expect(october.filter((a) => a.categoryId === null)).toEqual([]);
  });
});

describe('who can change budgets', () => {
  it.each([
    ['PUT', '/budgets/monthly/2026-12', { budgetMinor: 1 }],
    ['DELETE', '/budgets/monthly/2026-12', undefined],
    ['PUT', '/budgets/categories/2026-12/CAT', { budgetMinor: 1 }],
    ['DELETE', '/budgets/categories/2026-12/CAT', undefined],
  ])('a House Member cannot %s %s (403); nothing changes', async (method, path, body) => {
    const { h, groceries } = await setup();
    expect((await call('mem', method, path.replace('CAT', groceries), { householdId: h, body })).status).toBe(403);
    expect(await db.collection(MONTHLY_BUDGETS).countDocuments()).toBe(0);
    expect(await db.collection(CATEGORY_BUDGETS).countDocuments()).toBe(0);
  });

  it('a Co-Owner can', async () => {
    const { h } = await setup();
    const inv = CreatedInviteResponseSchema.parse(await (await call('owner', 'POST', '/invites', { householdId: h, body: { email: 'co@example.com', role: 'co_owner' } })).json());
    await call('co', 'POST', '/invites/accept', { body: { token: inv.token } });
    expect((await call('co', 'PUT', '/budgets/monthly/2026-12', { householdId: h, body: { budgetMinor: 1 } })).status).toBe(200);
  });

  it.each([
    ['negative', { budgetMinor: -1 }],
    ['fractional', { budgetMinor: 0.5 }],
    ['text', { budgetMinor: '5000' }],
    ['an operator', { budgetMinor: { $gt: 0 } }],
    ['extra fields', { budgetMinor: 1, householdId: 'x' }],
  ])('400 for %s; nothing stored', async (_label, body) => {
    const { h } = await setup();
    expect((await call('owner', 'PUT', '/budgets/monthly/2026-12', { householdId: h, body })).status).toBe(400);
    expect(await db.collection(MONTHLY_BUDGETS).countDocuments()).toBe(0);
  });

  it.each(['2026-13', '1999-12', 'default'])('400 for month %s', async (m) => {
    const { h, groceries } = await setup();
    expect((await call('owner', 'PUT', `/budgets/monthly/${m}`, { householdId: h, body: { budgetMinor: 1 } })).status).toBe(400);
    expect((await call('owner', 'DELETE', `/budgets/monthly/${m}`, { householdId: h })).status).toBe(400);
    expect((await call('owner', 'PUT', `/budgets/categories/${m}/${groceries}`, { householdId: h, body: { budgetMinor: 1 } })).status).toBe(400);
    expect((await call('owner', 'DELETE', `/budgets/categories/${m}/${groceries}`, { householdId: h })).status).toBe(400);
  });

  it('one household’s overrides never show in another', async () => {
    const { h } = await setup();
    const other = HouseholdResponseSchema.parse(await (await call('owner', 'POST', '/households', { body: { name: 'Other', defaultMonthlyBudgetMinor: 100 } })).json()).household.id;
    await call('owner', 'PUT', '/budgets/monthly/2026-11', { householdId: h, body: { budgetMinor: 1 } });
    expect((await budgets('owner', other)).totalBudgetMinor).toBe(100);
  });
});
