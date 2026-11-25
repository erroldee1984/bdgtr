import {
  HouseholdResponseSchema,
  MAX_HOUSEHOLDS_PER_USER,
  MeResponseSchema,
  type Role,
  ValidationErrorSchema,
} from '@bdgtr/shared';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { createHouseholdWithOwner, ensureHouseholdIndexes, HOUSEHOLDS, MEMBERSHIPS } from './households.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';
import { ensureUserIndexes, USERS } from './users.js';

const keys = makeTestKeys();
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_households_test');
  await ensureUserIndexes(db);
  await ensureHouseholdIndexes(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all([USERS, HOUSEHOLDS, MEMBERSHIPS].map((c) => db.collection(c).deleteMany({})));
});

const app = createApp({
  allowedOrigins: ['https://bdgtr.erroldee.com'],
  pingDb: async () => true,
  getDb: async () => db,
  verifyToken: createClerkVerifier(keys.publicPem),
  logError: () => {},
});

function call(
  clerkUserId: string,
  method: string,
  path: string,
  { body, householdId }: { body?: unknown; householdId?: string } = {},
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${signTestToken(keys.privateKey, { sub: clerkUserId, email: `${clerkUserId}@example.com` })}`,
  };
  if (householdId !== undefined) headers['X-Household-Id'] = householdId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return app.request(path, init);
}

async function createHousehold(owner: string, name = 'Dela Cruz') {
  const res = await call(owner, 'POST', '/households', { body: { name, defaultMonthlyBudgetMinor: 4_000_000 } });
  expect(res.status).toBe(201);
  return HouseholdResponseSchema.parse(await res.json()).household;
}

/** Adds `clerkUserId` to a household with a role (invites arrive in M1c). */
async function addMember(clerkUserId: string, householdId: string, role: Role, status = 'active') {
  await call(clerkUserId, 'GET', '/me'); // creates the user record
  const user = await db.collection(USERS).findOne({ clerkUserId });
  const now = new Date();
  await db.collection(MEMBERSHIPS).insertOne({
    householdId: new ObjectId(householdId),
    userId: user!._id,
    role,
    status,
    joinedAt: now,
    updatedAt: now,
    alertsMuted: false,
    dailyDigestEnabled: true,
  });
}

describe('POST /households', () => {
  it('creates a household with the caller as House Owner and lists it in /me', async () => {
    const h = await createHousehold('user_ana', '  Dela Cruz  ');
    expect(h).toMatchObject({ name: 'Dela Cruz', role: 'owner', currency: 'PHP', timezone: 'Asia/Manila', defaultMonthlyBudgetMinor: 4_000_000 });

    const me = MeResponseSchema.parse(await (await call('user_ana', 'GET', '/me')).json());
    expect(me.memberships).toEqual([{ householdId: h.id, householdName: 'Dela Cruz', role: 'owner' }]);
  });

  it('one person can own several households; /me lists them oldest first', async () => {
    const a = await createHousehold('user_ana', 'Home');
    const b = await createHousehold('user_ana', 'Parents');
    const me = MeResponseSchema.parse(await (await call('user_ana', 'GET', '/me')).json());
    expect(me.memberships.map((m) => m.householdId)).toEqual([a.id, b.id]);
  });

  it.each([
    ['blank name', { name: ' ', defaultMonthlyBudgetMinor: 100 }],
    ['negative budget', { name: 'A', defaultMonthlyBudgetMinor: -5 }],
    ['unknown field (e.g. trying to set role)', { name: 'A', defaultMonthlyBudgetMinor: 1, role: 'owner' }],
    ['NoSQL operator in name', { name: { $ne: null }, defaultMonthlyBudgetMinor: 1 }],
  ])('400 for %s, listing fields but never echoing values', async (_label, body) => {
    const res = await call('user_ana', 'POST', '/households', { body });
    expect(res.status).toBe(400);
    const err = ValidationErrorSchema.parse(await res.json());
    expect(err.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(err)).not.toContain('$ne');
    expect(await db.collection(HOUSEHOLDS).countDocuments()).toBe(0);
  });

  it('400 for a body that is not JSON', async () => {
    const res = await call('user_ana', 'POST', '/households', { body: '{not json' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it(`409 once a person is in ${MAX_HOUSEHOLDS_PER_USER} households`, async () => {
    for (let i = 0; i < MAX_HOUSEHOLDS_PER_USER; i++) await createHousehold('user_ana', `H${i}`);
    const res = await call('user_ana', 'POST', '/households', { body: { name: 'One too many', defaultMonthlyBudgetMinor: 1 } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'household_limit' });
  });

  it('401 without a valid sign-in', async () => {
    const res = await app.request('/households', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  // Regression (test audit): deleted households still counted toward the limit,
  // so someone who created and deleted test households was eventually locked out.
  it('deleted households do not count toward the limit', async () => {
    const made = [];
    for (let i = 0; i < MAX_HOUSEHOLDS_PER_USER; i++) made.push(await createHousehold('user_ana', `H${i}`));
    expect((await call('user_ana', 'DELETE', '/household', { householdId: made[0]!.id })).status).toBe(204);
    const res = await call('user_ana', 'POST', '/households', { body: { name: 'Replacement', defaultMonthlyBudgetMinor: 1 } });
    expect(res.status).toBe(201);
  });

  it('households you were removed from or left do not count toward the limit', async () => {
    for (let i = 0; i < MAX_HOUSEHOLDS_PER_USER - 1; i++) await createHousehold('user_ana', `H${i}`);
    const other = await createHousehold('user_ben', 'Ben home');
    await addMember('user_ana', other.id, 'member', 'left');
    expect((await call('user_ana', 'POST', '/households', { body: { name: 'Last one', defaultMonthlyBudgetMinor: 1 } })).status).toBe(201);
  });

  it('households you are only a member of DO count toward the limit', async () => {
    for (let i = 0; i < MAX_HOUSEHOLDS_PER_USER - 1; i++) await createHousehold('user_ana', `H${i}`);
    const other = await createHousehold('user_ben', 'Ben home');
    await addMember('user_ana', other.id, 'member');
    expect((await call('user_ana', 'POST', '/households', { body: { name: 'Too many', defaultMonthlyBudgetMinor: 1 } })).status).toBe(409);
  });

  it('if adding the owner fails, the half-created household is removed (no orphan)', async () => {
    await call('user_ana', 'GET', '/me');
    const user = await db.collection(USERS).findOne({ clerkUserId: 'user_ana' });
    const failingDb = {
      collection: (name: string) =>
        name === MEMBERSHIPS
          ? { insertOne: async () => Promise.reject(new Error('write failed')) }
          : db.collection(name),
    } as unknown as Db;
    await expect(
      createHouseholdWithOwner(failingDb, user!._id, { name: 'Orphan', defaultMonthlyBudgetMinor: 1 }),
    ).rejects.toThrow('write failed');
    expect(await db.collection(HOUSEHOLDS).countDocuments()).toBe(0);
  });
});

describe('household access (X-Household-Id)', () => {
  it('members of any role can view their household with their own role', async () => {
    const h = await createHousehold('user_owner');
    await addMember('user_co', h.id, 'co_owner');
    await addMember('user_mem', h.id, 'member');
    for (const [who, role] of [['user_owner', 'owner'], ['user_co', 'co_owner'], ['user_mem', 'member']] as const) {
      const res = await call(who, 'GET', '/household', { householdId: h.id });
      expect(res.status).toBe(200);
      expect(HouseholdResponseSchema.parse(await res.json()).household.role).toBe(role);
    }
  });

  it.each([
    ['no header', undefined],
    ['malformed id', 'not-an-id'],
    ['injection attempt', '{"$ne":null}'],
    ['well-formed but unknown id', new ObjectId().toHexString()],
  ])('404 (not 400/403) for %s', async (_label, householdId) => {
    await createHousehold('user_ana');
    const res = await call('user_ana', 'GET', '/household', householdId === undefined ? {} : { householdId });
    expect(res.status).toBe(404);
  });

  it("404 for someone else's household: no hint that it exists", async () => {
    const h = await createHousehold('user_ana');
    const res = await call('user_mallory', 'GET', '/household', { householdId: h.id });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('404 for a member who was removed or left', async () => {
    const h = await createHousehold('user_owner');
    await addMember('user_removed', h.id, 'member', 'removed');
    await addMember('user_left', h.id, 'co_owner', 'left');
    for (const who of ['user_removed', 'user_left']) {
      expect((await call(who, 'GET', '/household', { householdId: h.id })).status).toBe(404);
      const me = MeResponseSchema.parse(await (await call(who, 'GET', '/me')).json());
      expect(me.memberships).toEqual([]);
    }
  });
});

describe('PATCH /household', () => {
  it.each(['user_owner', 'user_co'])('%s (Owner / Co-Owner) can rename and change the budget', async (who) => {
    const h = await createHousehold('user_owner');
    await addMember('user_co', h.id, 'co_owner');
    const res = await call(who, 'PATCH', '/household', { householdId: h.id, body: { name: 'Renamed', defaultMonthlyBudgetMinor: 5_000_000 } });
    expect(res.status).toBe(200);
    expect(HouseholdResponseSchema.parse(await res.json()).household).toMatchObject({ name: 'Renamed', defaultMonthlyBudgetMinor: 5_000_000 });
  });

  it('403 for a House Member, and nothing changes', async () => {
    const h = await createHousehold('user_owner');
    await addMember('user_mem', h.id, 'member');
    const res = await call('user_mem', 'PATCH', '/household', { householdId: h.id, body: { name: 'Hijacked' } });
    expect(res.status).toBe(403);
    expect((await db.collection(HOUSEHOLDS).findOne({ _id: new ObjectId(h.id) }))!.name).toBe('Dela Cruz');
  });

  it.each([
    ['empty update', {}],
    ['changing currency', { currency: 'USD' }],
    ['moving ownership via body', { createdBy: 'someone' }],
  ])('400 for %s', async (_label, body) => {
    const h = await createHousehold('user_owner');
    const res = await call('user_owner', 'PATCH', '/household', { householdId: h.id, body });
    expect(res.status).toBe(400);
  });

  it('a partial update changes only the fields sent', async () => {
    const h = await createHousehold('user_owner');
    const res = await call('user_owner', 'PATCH', '/household', { householdId: h.id, body: { defaultMonthlyBudgetMinor: 123 } });
    expect(res.status).toBe(200);
    expect(HouseholdResponseSchema.parse(await res.json()).household).toMatchObject({ name: 'Dela Cruz', defaultMonthlyBudgetMinor: 123 });
  });

  it('400 for a body that is not JSON, and nothing changes', async () => {
    const h = await createHousehold('user_owner');
    const res = await call('user_owner', 'PATCH', '/household', { householdId: h.id, body: '{"name":' });
    expect(res.status).toBe(400);
    expect((await db.collection(HOUSEHOLDS).findOne({ _id: new ObjectId(h.id) }))!.name).toBe('Dela Cruz');
  });

  it('401 without a valid sign-in', async () => {
    const h = await createHousehold('user_owner');
    const res = await app.request('/household', {
      method: 'PATCH',
      headers: { 'X-Household-Id': h.id, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Anon' }),
    });
    expect(res.status).toBe(401);
  });

  it('404 once the household has been deleted', async () => {
    const h = await createHousehold('user_owner');
    await call('user_owner', 'DELETE', '/household', { householdId: h.id });
    const res = await call('user_owner', 'PATCH', '/household', { householdId: h.id, body: { name: 'Back from the dead' } });
    expect(res.status).toBe(404);
  });

  it('only changes the household named in the header, never another one', async () => {
    const mine = await createHousehold('user_owner', 'Mine');
    const theirs = await createHousehold('user_other', 'Theirs');
    const res = await call('user_owner', 'PATCH', '/household', { householdId: theirs.id, body: { name: 'Pwned' } });
    expect(res.status).toBe(404);
    expect((await db.collection(HOUSEHOLDS).findOne({ _id: new ObjectId(theirs.id) }))!.name).toBe('Theirs');
    expect((await db.collection(HOUSEHOLDS).findOne({ _id: new ObjectId(mine.id) }))!.name).toBe('Mine');
  });
});

describe('DELETE /household', () => {
  it('the House Owner can delete; it then disappears for everyone', async () => {
    const h = await createHousehold('user_owner');
    await addMember('user_mem', h.id, 'member');
    expect((await call('user_owner', 'DELETE', '/household', { householdId: h.id })).status).toBe(204);
    for (const who of ['user_owner', 'user_mem']) {
      expect((await call(who, 'GET', '/household', { householdId: h.id })).status).toBe(404);
      expect(MeResponseSchema.parse(await (await call(who, 'GET', '/me')).json()).memberships).toEqual([]);
    }
    // Soft delete: the record is kept (purged later), only marked.
    expect((await db.collection(HOUSEHOLDS).findOne({ _id: new ObjectId(h.id) }))!.deletedAt).toBeInstanceOf(Date);
  });

  it.each([['user_co', 'co_owner'], ['user_mem', 'member']] as const)('403 for %s (%s)', async (who, role) => {
    const h = await createHousehold('user_owner');
    await addMember(who, h.id, role);
    expect((await call(who, 'DELETE', '/household', { householdId: h.id })).status).toBe(403);
    expect((await call('user_owner', 'GET', '/household', { householdId: h.id })).status).toBe(200);
  });
});

describe('DELETE /household (negative cases)', () => {
  it("404 for someone else's household, which stays", async () => {
    const h = await createHousehold('user_owner');
    expect((await call('user_mallory', 'DELETE', '/household', { householdId: h.id })).status).toBe(404);
    expect((await call('user_owner', 'GET', '/household', { householdId: h.id })).status).toBe(200);
  });

  it('404 when deleting the same household twice', async () => {
    const h = await createHousehold('user_owner');
    expect((await call('user_owner', 'DELETE', '/household', { householdId: h.id })).status).toBe(204);
    expect((await call('user_owner', 'DELETE', '/household', { householdId: h.id })).status).toBe(404);
  });

  it('401 without a valid sign-in', async () => {
    const h = await createHousehold('user_owner');
    expect((await app.request('/household', { method: 'DELETE', headers: { 'X-Household-Id': h.id } })).status).toBe(401);
  });
});

describe('data integrity', () => {
  it('the database refuses a second active House Owner for the same household', async () => {
    const h = await createHousehold('user_owner');
    await expect(addMember('user_usurper', h.id, 'owner')).rejects.toThrow(/duplicate key/i);
  });

  it('the same person cannot be added to a household twice', async () => {
    const h = await createHousehold('user_owner');
    await addMember('user_mem', h.id, 'member');
    await expect(addMember('user_mem', h.id, 'member')).rejects.toThrow(/duplicate key/i);
  });
});
