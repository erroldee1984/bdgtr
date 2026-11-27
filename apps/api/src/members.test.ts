import {
  AcceptInviteResponseSchema,
  CreatedInviteResponseSchema,
  HouseholdResponseSchema,
  INVITE_TTL_DAYS,
  InvitesResponseSchema,
  MAX_HOUSEHOLDS_PER_USER,
  MAX_PENDING_INVITES,
  MembersResponseSchema,
  MeResponseSchema,
  type Role,
} from '@bdgtr/shared';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { ensureHouseholdIndexes, HOUSEHOLDS, MEMBERSHIPS } from './households.js';
import { ensureInviteIndexes, hashToken, INVITE_ATTEMPTS, INVITES, MAX_FAILED_ACCEPTS } from './invites.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';
import { ensureUserIndexes, USERS } from './users.js';
import { sharedMongo, type SharedMongo } from './test-utils/mongo.js';

// Transfer ownership uses a transaction, which needs a replica set.
const keys = makeTestKeys();
let mongo: SharedMongo;
let client: MongoClient;
let db: Db;
let clock = new Date('2026-11-25T02:00:00.000Z');

beforeAll(async () => {
  mongo = await sharedMongo();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_members_test');
  await Promise.all([ensureUserIndexes(db), ensureHouseholdIndexes(db), ensureInviteIndexes(db)]);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  clock = new Date('2026-11-25T02:00:00.000Z');
  await Promise.all([USERS, HOUSEHOLDS, MEMBERSHIPS, INVITES, INVITE_ATTEMPTS].map((c) => db.collection(c).deleteMany({})));
});

const app = createApp({
  allowedOrigins: ['https://bdgtr.erroldee.com'],
  pingDb: async () => true,
  getDb: async () => db,
  verifyToken: createClerkVerifier(keys.publicPem),
  now: () => clock,
  logError: () => {},
});

/** Every test person signs in as <name>@example.com unless an email is given. */
function call(
  who: string,
  method: string,
  path: string,
  { body, householdId, email, name }: { body?: unknown; householdId?: string; email?: string | null; name?: string } = {},
) {
  const claims: Record<string, unknown> = { sub: who };
  if (email !== null) claims.email = email ?? `${who}@example.com`;
  if (name) claims.name = name;
  const headers: Record<string, string> = { Authorization: `Bearer ${signTestToken(keys.privateKey, claims)}` };
  if (householdId) headers['X-Household-Id'] = householdId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}

async function createHousehold(owner: string, name = 'Dela Cruz') {
  const res = await call(owner, 'POST', '/households', { body: { name, defaultMonthlyBudgetMinor: 4_000_000 } });
  expect(res.status).toBe(201);
  return HouseholdResponseSchema.parse(await res.json()).household;
}

async function invite(by: string, householdId: string, email: string, role: 'co_owner' | 'member' = 'member') {
  const res = await call(by, 'POST', '/invites', { householdId, body: { email, role } });
  expect(res.status).toBe(201);
  return CreatedInviteResponseSchema.parse(await res.json());
}

const accept = (who: string, token: string, opts: { email?: string | null } = {}) =>
  call(who, 'POST', '/invites/accept', { body: { token }, ...opts });

/** Household with an Owner, a Co-Owner and a House Member, joined through real invites. */
async function household3() {
  const h = await createHousehold('owner');
  for (const [who, role] of [['co', 'co_owner'], ['mem', 'member']] as const) {
    const { token } = await invite('owner', h.id, `${who}@example.com`, role);
    expect((await accept(who, token)).status).toBe(200);
  }
  return h;
}

async function members(who: string, householdId: string) {
  const res = await call(who, 'GET', '/members', { householdId });
  expect(res.status).toBe(200);
  return MembersResponseSchema.parse(await res.json()).members;
}

const userIdOf = async (who: string) => (await db.collection(USERS).findOne({ clerkUserId: who }))!._id.toHexString();
const roleOf = async (who: string, householdId: string): Promise<Role | null> => {
  const user = await db.collection(USERS).findOne({ clerkUserId: who });
  const m = await db.collection(MEMBERSHIPS).findOne({ householdId: new ObjectId(householdId), userId: user!._id, status: 'active' });
  return (m?.role as Role | undefined) ?? null;
};
const days = (n: number) => n * 24 * 60 * 60 * 1000;

describe('GET /members', () => {
  it('every role sees everyone, House Owner first, with names, emails and "you"', async () => {
    const h = await createHousehold('owner');
    await call('owner', 'GET', '/me', { name: 'Ana Dela Cruz' }); // name claim configured
    const { token } = await invite('owner', h.id, 'mem@example.com');
    await accept('mem', token);
    for (const who of ['owner', 'mem']) {
      const list = await members(who, h.id);
      expect(list.map((m) => [m.email, m.role, m.isYou])).toEqual([
        ['owner@example.com', 'owner', who === 'owner'],
        ['mem@example.com', 'member', who === 'mem'],
      ]);
    }
    expect((await members('owner', h.id))[0]!.name).toBe('Ana Dela Cruz');
    expect((await members('owner', h.id))[1]!.name).toBeNull(); // no name claim: null, not invented
  });

  it('people who left or were removed are not listed', async () => {
    const h = await household3();
    await call('mem', 'DELETE', `/members/${await userIdOf('mem')}`, { householdId: h.id });
    expect((await members('owner', h.id)).map((m) => m.email)).toEqual(['owner@example.com', 'co@example.com']);
  });

  it('404 for a non-member, 401 without sign-in', async () => {
    const h = await createHousehold('owner');
    expect((await call('stranger', 'GET', '/members', { householdId: h.id })).status).toBe(404);
    expect((await app.request('/members', { headers: { 'X-Household-Id': h.id } })).status).toBe(401);
  });
});

describe('PATCH /members/:userId (change role)', () => {
  it('House Owner promotes a House Member to Co-Owner', async () => {
    const h = await household3();
    const res = await call('owner', 'PATCH', `/members/${await userIdOf('mem')}`, { householdId: h.id, body: { role: 'co_owner' } });
    expect(res.status).toBe(204);
    expect(await roleOf('mem', h.id)).toBe('co_owner');
  });

  it('Co-Owner demotes a Co-Owner to House Member', async () => {
    const h = await household3();
    await call('owner', 'PATCH', `/members/${await userIdOf('mem')}`, { householdId: h.id, body: { role: 'co_owner' } });
    expect((await call('co', 'PATCH', `/members/${await userIdOf('mem')}`, { householdId: h.id, body: { role: 'member' } })).status).toBe(204);
    expect(await roleOf('mem', h.id)).toBe('member');
  });

  it('Co-Owner cannot demote the House Owner → 403, and nothing changes', async () => {
    const h = await household3();
    const res = await call('co', 'PATCH', `/members/${await userIdOf('owner')}`, { householdId: h.id, body: { role: 'member' } });
    expect(res.status).toBe(403);
    expect(await roleOf('owner', h.id)).toBe('owner');
  });

  it('the House Owner cannot demote themselves (only transfer) → 403', async () => {
    const h = await household3();
    expect((await call('owner', 'PATCH', `/members/${await userIdOf('owner')}`, { householdId: h.id, body: { role: 'co_owner' } })).status).toBe(403);
    expect(await roleOf('owner', h.id)).toBe('owner');
  });

  it('House Member cannot change anyone → 403', async () => {
    const h = await household3();
    expect((await call('mem', 'PATCH', `/members/${await userIdOf('co')}`, { householdId: h.id, body: { role: 'member' } })).status).toBe(403);
    expect((await call('mem', 'PATCH', `/members/${await userIdOf('mem')}`, { householdId: h.id, body: { role: 'co_owner' } })).status).toBe(403);
    expect(await roleOf('mem', h.id)).toBe('member');
  });

  it.each([
    ['making someone House Owner', { role: 'owner' }],
    ['an unknown role', { role: 'admin' }],
    ['an extra field', { role: 'member', status: 'active' }],
  ])('400 for %s', async (_label, body) => {
    const h = await household3();
    expect((await call('owner', 'PATCH', `/members/${await userIdOf('mem')}`, { householdId: h.id, body })).status).toBe(400);
    expect(await roleOf('mem', h.id)).toBe('member');
  });

  it('404 for an unknown, malformed, removed or other-household user id', async () => {
    const h = await household3();
    const other = await createHousehold('someone_else');
    void other;
    await call('owner', 'DELETE', `/members/${await userIdOf('mem')}`, { householdId: h.id });
    for (const id of [new ObjectId().toHexString(), 'not-an-id', await userIdOf('mem'), await userIdOf('someone_else')]) {
      expect((await call('owner', 'PATCH', `/members/${id}`, { householdId: h.id, body: { role: 'co_owner' } })).status).toBe(404);
    }
  });
});

describe('DELETE /members/:userId (remove / leave)', () => {
  it('Co-Owner removes a House Member, whose access ends at once', async () => {
    const h = await household3();
    expect((await call('co', 'DELETE', `/members/${await userIdOf('mem')}`, { householdId: h.id })).status).toBe(204);
    expect((await call('mem', 'GET', '/household', { householdId: h.id })).status).toBe(404);
    expect(MeResponseSchema.parse(await (await call('mem', 'GET', '/me')).json()).memberships).toEqual([]);
  });

  it('House Owner removes a Co-Owner', async () => {
    const h = await household3();
    expect((await call('owner', 'DELETE', `/members/${await userIdOf('co')}`, { householdId: h.id })).status).toBe(204);
    expect(await roleOf('co', h.id)).toBeNull();
  });

  it('Co-Owner cannot remove the House Owner → 403', async () => {
    const h = await household3();
    expect((await call('co', 'DELETE', `/members/${await userIdOf('owner')}`, { householdId: h.id })).status).toBe(403);
    expect(await roleOf('owner', h.id)).toBe('owner');
  });

  it('House Member cannot remove anyone → 403', async () => {
    const h = await household3();
    expect((await call('mem', 'DELETE', `/members/${await userIdOf('co')}`, { householdId: h.id })).status).toBe(403);
    expect(await roleOf('co', h.id)).toBe('co_owner');
  });

  it.each(['co', 'mem'])('%s can leave', async (who) => {
    const h = await household3();
    expect((await call(who, 'DELETE', `/members/${await userIdOf(who)}`, { householdId: h.id })).status).toBe(204);
    expect(await roleOf(who, h.id)).toBeNull();
    expect((await db.collection(MEMBERSHIPS).findOne({ userId: new ObjectId(await userIdOf(who)) }))!.status).toBe('left');
  });

  it('the House Owner cannot leave without transferring ownership → 409', async () => {
    const h = await household3();
    const res = await call('owner', 'DELETE', `/members/${await userIdOf('owner')}`, { householdId: h.id });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'owner_must_transfer' });
    expect(await roleOf('owner', h.id)).toBe('owner');
  });

  it('404 for an unknown or malformed user id', async () => {
    const h = await household3();
    for (const id of [new ObjectId().toHexString(), 'zzz']) {
      expect((await call('owner', 'DELETE', `/members/${id}`, { householdId: h.id })).status).toBe(404);
    }
  });
});

describe('POST /members/transfer-ownership', () => {
  it('hands ownership over; the old Owner becomes Co-Owner and can then leave', async () => {
    const h = await household3();
    const res = await call('owner', 'POST', '/members/transfer-ownership', { householdId: h.id, body: { userId: await userIdOf('mem') } });
    expect(res.status).toBe(204);
    expect(await roleOf('mem', h.id)).toBe('owner');
    expect(await roleOf('owner', h.id)).toBe('co_owner');
    expect(await db.collection(MEMBERSHIPS).countDocuments({ householdId: new ObjectId(h.id), role: 'owner', status: 'active' })).toBe(1);
    expect((await call('owner', 'DELETE', `/members/${await userIdOf('owner')}`, { householdId: h.id })).status).toBe(204);
    expect((await call('mem', 'DELETE', '/household', { householdId: h.id })).status).toBe(204); // new Owner can delete
  });

  it.each(['co', 'mem'])('403 for %s (only the House Owner can transfer)', async (who) => {
    const h = await household3();
    const res = await call(who, 'POST', '/members/transfer-ownership', { householdId: h.id, body: { userId: await userIdOf(who) } });
    expect(res.status).toBe(403);
    expect(await roleOf('owner', h.id)).toBe('owner');
  });

  it('404 to someone who is not (or no longer) a member; ownership stays', async () => {
    const h = await household3();
    await call('owner', 'DELETE', `/members/${await userIdOf('mem')}`, { householdId: h.id });
    await call('stranger', 'GET', '/me');
    for (const who of ['mem', 'stranger']) {
      const res = await call('owner', 'POST', '/members/transfer-ownership', { householdId: h.id, body: { userId: await userIdOf(who) } });
      expect(res.status).toBe(404);
    }
    expect(await roleOf('owner', h.id)).toBe('owner');
  });

  it('409 to yourself; 400 for a malformed id', async () => {
    const h = await household3();
    expect((await call('owner', 'POST', '/members/transfer-ownership', { householdId: h.id, body: { userId: await userIdOf('owner') } })).status).toBe(409);
    expect((await call('owner', 'POST', '/members/transfer-ownership', { householdId: h.id, body: { userId: 'nope' } })).status).toBe(400);
    expect(await roleOf('owner', h.id)).toBe('owner');
  });
});

describe('POST /invites', () => {
  it.each([
    ['owner', 'co_owner'],
    ['owner', 'member'],
    ['co', 'co_owner'],
    ['co', 'member'],
  ] as const)('%s invites a %s: a 43-character link token; only its hash is stored; expires in 7 days', async (by, role) => {
    const h = await household3();
    const { invite: inv, token } = await invite(by, h.id, 'New.Person@Example.com', role);
    expect(inv).toMatchObject({ email: 'new.person@example.com', role });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await db.collection(INVITES).findOne({ _id: new ObjectId(inv.id) });
    expect(stored!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(new Date(inv.expiresAt).getTime() - clock.getTime()).toBe(days(INVITE_TTL_DAYS));
  });

  it('House Member cannot invite → 403', async () => {
    const h = await household3();
    expect((await call('mem', 'POST', '/invites', { householdId: h.id, body: { email: 'x@example.com', role: 'member' } })).status).toBe(403);
    expect(await db.collection(INVITES).countDocuments({ email: 'x@example.com' })).toBe(0);
  });

  it.each([
    ['inviting as House Owner', { email: 'x@example.com', role: 'owner' }],
    ['a bad email', { email: 'not-an-email', role: 'member' }],
    ['choosing the household in the body', { email: 'x@example.com', role: 'member', householdId: new ObjectId().toHexString() }],
  ])('400 for %s', async (_label, body) => {
    const h = await household3();
    expect((await call('owner', 'POST', '/invites', { householdId: h.id, body })).status).toBe(400);
  });

  it('409 when the person is already a member', async () => {
    const h = await household3();
    const res = await call('owner', 'POST', '/invites', { householdId: h.id, body: { email: 'mem@example.com', role: 'co_owner' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_member' });
  });

  it('inviting the same email again replaces the old link (old one stops working)', async () => {
    const h = await createHousehold('owner');
    const first = await invite('owner', h.id, 'ben@example.com');
    const second = await invite('owner', h.id, 'ben@example.com', 'co_owner');
    expect((await accept('ben', first.token)).status).toBe(410);
    const res = await accept('ben', second.token);
    expect(res.status).toBe(200);
    expect(AcceptInviteResponseSchema.parse(await res.json()).role).toBe('co_owner');
  });

  it(`409 once a household has ${MAX_PENDING_INVITES} pending invites`, async () => {
    const h = await createHousehold('owner');
    for (let i = 0; i < MAX_PENDING_INVITES; i++) await invite('owner', h.id, `p${i}@example.com`);
    const res = await call('owner', 'POST', '/invites', { householdId: h.id, body: { email: 'one-more@example.com', role: 'member' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'invite_limit' });
  });
});

describe('GET /invites, DELETE /invites/:id, POST /invites/:id/reissue', () => {
  it('lists only pending, unexpired invites, newest first, without tokens', async () => {
    const h = await createHousehold('owner');
    const a = await invite('owner', h.id, 'a@example.com');
    clock = new Date(clock.getTime() + 1000);
    const b = await invite('owner', h.id, 'b@example.com', 'co_owner');
    const c = await invite('owner', h.id, 'c@example.com');
    await call('owner', 'DELETE', `/invites/${c.invite.id}`, { householdId: h.id });
    const res = await call('owner', 'GET', '/invites', { householdId: h.id });
    const body = await res.json();
    expect(InvitesResponseSchema.parse(body).invites.map((i) => i.email)).toEqual(['b@example.com', 'a@example.com']);
    expect(JSON.stringify(body)).not.toContain(a.token);
    expect(JSON.stringify(body)).not.toContain(b.token);

    clock = new Date(clock.getTime() + days(8)); // all expired
    expect(InvitesResponseSchema.parse(await (await call('owner', 'GET', '/invites', { householdId: h.id })).json()).invites).toEqual([]);
  });

  it('House Member cannot see invites → 403', async () => {
    const h = await household3();
    expect((await call('mem', 'GET', '/invites', { householdId: h.id })).status).toBe(403);
  });

  it('a revoked invite can no longer be accepted; revoking twice → 404', async () => {
    const h = await createHousehold('owner');
    const { invite: inv, token } = await invite('owner', h.id, 'ben@example.com');
    expect((await call('owner', 'DELETE', `/invites/${inv.id}`, { householdId: h.id })).status).toBe(204);
    expect((await accept('ben', token)).status).toBe(410);
    expect((await call('owner', 'DELETE', `/invites/${inv.id}`, { householdId: h.id })).status).toBe(404);
  });

  it("cannot revoke or reissue another household's invite → 404", async () => {
    const mine = await createHousehold('owner');
    const theirs = await createHousehold('other');
    const { invite: inv, token } = await invite('other', theirs.id, 'ben@example.com');
    expect((await call('owner', 'DELETE', `/invites/${inv.id}`, { householdId: mine.id })).status).toBe(404);
    expect((await call('owner', 'POST', `/invites/${inv.id}/reissue`, { householdId: mine.id })).status).toBe(404);
    expect((await accept('ben', token)).status).toBe(200); // still works
  });

  it('reissue ("share again") gives a new working link and kills the old one', async () => {
    const h = await createHousehold('owner');
    const old = await invite('owner', h.id, 'ben@example.com', 'co_owner');
    const res = await call('owner', 'POST', `/invites/${old.invite.id}/reissue`, { householdId: h.id });
    expect(res.status).toBe(201);
    const fresh = CreatedInviteResponseSchema.parse(await res.json());
    expect(fresh.token).not.toBe(old.token);
    expect(fresh.invite).toMatchObject({ email: 'ben@example.com', role: 'co_owner' });
    expect((await accept('ben', old.token)).status).toBe(410);
    expect((await accept('ben', fresh.token)).status).toBe(200);
  });

  it('404 for unknown or malformed invite ids', async () => {
    const h = await createHousehold('owner');
    for (const id of [new ObjectId().toHexString(), 'bad']) {
      expect((await call('owner', 'DELETE', `/invites/${id}`, { householdId: h.id })).status).toBe(404);
      expect((await call('owner', 'POST', `/invites/${id}/reissue`, { householdId: h.id })).status).toBe(404);
    }
  });
});

describe('POST /invites/accept', () => {
  it('the invited person joins with the invited role; the household is now in /me', async () => {
    const h = await createHousehold('owner');
    await createHousehold('ben', 'Ben home'); // already has a household of their own
    const { token } = await invite('owner', h.id, 'ben@example.com', 'co_owner');
    const res = await accept('ben', token);
    expect(res.status).toBe(200);
    expect(AcceptInviteResponseSchema.parse(await res.json())).toEqual({ householdId: h.id, householdName: 'Dela Cruz', role: 'co_owner' });
    const me = MeResponseSchema.parse(await (await call('ben', 'GET', '/me')).json());
    expect(me.memberships.map((m) => [m.householdName, m.role])).toEqual([
      ['Ben home', 'owner'],
      ['Dela Cruz', 'co_owner'],
    ]);
  });

  it('a forwarded link is useless: someone with another email → 403, and it still works for the invitee', async () => {
    const h = await createHousehold('owner');
    const { token } = await invite('owner', h.id, 'ben@example.com');
    const res = await accept('mallory', token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'email_mismatch' });
    expect(await roleOf('mallory', h.id)).toBeNull();
    expect((await accept('ben', token)).status).toBe(200);
  });

  it('a sign-in without an email claim → 403', async () => {
    const h = await createHousehold('owner');
    const { token } = await invite('owner', h.id, 'ben@example.com');
    expect((await accept('ben', token, { email: null })).status).toBe(403);
  });

  it('single use: a second accept fails', async () => {
    const h = await createHousehold('owner');
    const { token } = await invite('owner', h.id, 'ben@example.com');
    expect((await accept('ben', token)).status).toBe(200);
    await call('ben', 'DELETE', `/members/${await userIdOf('ben')}`, { householdId: h.id }); // leave
    expect((await accept('ben', token)).status).toBe(410);
  });

  it('two simultaneous accepts: exactly one succeeds and there is one membership', async () => {
    const h = await createHousehold('owner');
    const { token } = await invite('owner', h.id, 'ben@example.com');
    const statuses = (await Promise.all([accept('ben', token), accept('ben', token)])).map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(await db.collection(MEMBERSHIPS).countDocuments({ householdId: new ObjectId(h.id) })).toBe(2);
  });

  it(`expires after ${INVITE_TTL_DAYS} days → 410`, async () => {
    const h = await createHousehold('owner');
    const { token } = await invite('owner', h.id, 'ben@example.com');
    clock = new Date(clock.getTime() + days(INVITE_TTL_DAYS) + 1);
    const res = await accept('ben', token);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'invite_expired' });
  });

  it('a deleted household → 410', async () => {
    const h = await createHousehold('owner');
    const { token } = await invite('owner', h.id, 'ben@example.com');
    await call('owner', 'DELETE', '/household', { householdId: h.id });
    expect((await accept('ben', token)).status).toBe(410);
  });

  it('already a member → 409 (e.g. tapping the link twice)', async () => {
    const h = await createHousehold('owner');
    const first = await invite('owner', h.id, 'ben@example.com');
    await accept('ben', first.token);
    // An Owner re-inviting someone already in is refused, so simulate a stale second invite.
    await db.collection(INVITES).insertOne({
      householdId: new ObjectId(h.id), email: 'ben@example.com', role: 'member', tokenHash: hashToken('b'.repeat(43)),
      status: 'pending', expiresAt: new Date(clock.getTime() + days(1)), invitedBy: new ObjectId(), createdAt: clock, updatedAt: clock,
    });
    const res = await accept('ben', 'b'.repeat(43));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_member' });
  });

  it('someone who left or was removed can be invited back, with the new role', async () => {
    const h = await household3();
    await call('owner', 'DELETE', `/members/${await userIdOf('mem')}`, { householdId: h.id });
    const { token } = await invite('owner', h.id, 'mem@example.com', 'co_owner');
    expect((await accept('mem', token)).status).toBe(200);
    expect(await roleOf('mem', h.id)).toBe('co_owner');
    expect(await db.collection(MEMBERSHIPS).countDocuments({ householdId: new ObjectId(h.id) })).toBe(3);
  });

  it(`at the ${MAX_HOUSEHOLDS_PER_USER}-household limit → 409, and the invite stays usable`, async () => {
    const h = await createHousehold('owner');
    for (let i = 0; i < MAX_HOUSEHOLDS_PER_USER; i++) await createHousehold('ben', `B${i}`);
    const { token } = await invite('owner', h.id, 'ben@example.com');
    expect((await accept('ben', token)).status).toBe(409);
    await call('ben', 'DELETE', '/household', { householdId: (MeResponseSchema.parse(await (await call('ben', 'GET', '/me')).json())).memberships[0]!.householdId });
    expect((await accept('ben', token)).status).toBe(200);
  });

  it.each([
    ['unknown token', { token: 'z'.repeat(43) }, 404],
    ['malformed token', { token: 'short' }, 400],
    ['operator injection', { token: { $ne: null } }, 400],
    ['not JSON', '{token', 400],
  ])('%s → %i', async (_label, body, status) => {
    expect((await call('ben', 'POST', '/invites/accept', { body })).status).toBe(status);
  });

  it(`after ${MAX_FAILED_ACCEPTS} failed attempts: 429 even for a real link, until the window passes`, async () => {
    const h = await createHousehold('owner');
    const { token } = await invite('owner', h.id, 'ben@example.com');
    for (let i = 0; i < MAX_FAILED_ACCEPTS; i++) {
      expect((await accept('ben', `${String(i).padStart(2, '0')}${'g'.repeat(41)}`)).status).toBe(404);
    }
    const blocked = await accept('ben', token);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('900');
    expect((await accept('someone_else', 'q'.repeat(43))).status).toBe(404); // per person, not global
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    expect((await accept('ben', token)).status).toBe(200);
  });

  it('401 without sign-in', async () => {
    const res = await app.request('/invites/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(43) }),
    });
    expect(res.status).toBe(401);
  });
});
