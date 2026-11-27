import { MeResponseSchema } from '@bdgtr/shared';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VerifyToken } from './auth.js';
import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';
import { ensureUserIndexes, USERS } from './users.js';
import { sharedMongo, type SharedMongo } from './test-utils/mongo.js';

const WEB_ORIGIN = 'https://bdgtr.erroldee.com';
const keys = makeTestKeys();

let mongo: SharedMongo;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await sharedMongo();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_test');
  await ensureUserIndexes(db);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  await db.collection(USERS).deleteMany({});
});

function makeApp(verifyToken: VerifyToken | null = createClerkVerifier(keys.publicPem)) {
  return createApp({
    allowedOrigins: [WEB_ORIGIN],
    pingDb: async () => true,
    getDb: async () => db,
    verifyToken,
    logError: () => {},
  });
}

const bearer = (claims: Record<string, unknown>) => ({
  Authorization: `Bearer ${signTestToken(keys.privateKey, claims)}`,
});

describe('GET /me (happy paths)', () => {
  it('creates the user on first sign-in and returns a schema-valid body', async () => {
    const res = await makeApp().request('/me', { headers: bearer({ sub: 'user_ana', email: 'Ana@Example.com' }) });
    expect(res.status).toBe(200);
    const body = MeResponseSchema.parse(await res.json());
    expect(body.user.email).toBe('ana@example.com'); // normalised to lower case
    expect(body.memberships).toEqual([]);
    expect(await db.collection(USERS).countDocuments()).toBe(1);
  });

  it('returns the same user on later sign-ins (no duplicates)', async () => {
    const app = makeApp();
    const first = MeResponseSchema.parse(await (await app.request('/me', { headers: bearer({ sub: 'user_ana' }) })).json());
    const second = MeResponseSchema.parse(await (await app.request('/me', { headers: bearer({ sub: 'user_ana' }) })).json());
    expect(second.user.id).toBe(first.user.id);
    expect(await db.collection(USERS).countDocuments()).toBe(1);
  });

  it('concurrent first requests still create exactly one user', async () => {
    const app = makeApp();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => app.request('/me', { headers: bearer({ sub: 'user_race' }) })),
    );
    // Either all succeed, or a losing upsert hits the unique index and returns 500; never 2 users.
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(await db.collection(USERS).countDocuments({ clerkUserId: 'user_race' })).toBe(1);
  });

  it('keeps a known email when a later token lacks the claim', async () => {
    const app = makeApp();
    await app.request('/me', { headers: bearer({ sub: 'user_ana', email: 'ana@example.com' }) });
    const body = MeResponseSchema.parse(await (await app.request('/me', { headers: bearer({ sub: 'user_ana' }) })).json());
    expect(body.user.email).toBe('ana@example.com');
  });

  it('accepts a browser token from the real website origin', async () => {
    const res = await makeApp().request('/me', { headers: bearer({ sub: 'user_web', azp: WEB_ORIGIN }) });
    expect(res.status).toBe(200);
  });

  it('accepts a native (Android) token, which has no azp claim', async () => {
    const res = await makeApp().request('/me', { headers: bearer({ sub: 'user_android' }) });
    expect(res.status).toBe(200);
  });
});

describe('GET /me (negative cases)', () => {
  it.each([
    ['no Authorization header', {}],
    ['a non-Bearer scheme', { Authorization: 'Basic dXNlcjpwYXNz' }],
    ['a malformed token', { Authorization: 'Bearer not-a-jwt' }],
    ['an empty bearer', { Authorization: 'Bearer ' }],
  ])('401 for %s', async (_label, headers) => {
    const res = await makeApp().request('/me', { headers });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(await db.collection(USERS).countDocuments()).toBe(0);
  });

  it('401 for an expired token', async () => {
    const token = signTestToken(keys.privateKey, { sub: 'user_ana' }, { expiresInSec: -120 });
    const res = await makeApp().request('/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('401 for a token signed by another Clerk instance', async () => {
    const other = makeTestKeys();
    const token = signTestToken(other.privateKey, { sub: 'user_ana' });
    const res = await makeApp().request('/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('401 for a browser token issued to a different website (azp)', async () => {
    const res = await makeApp().request('/me', { headers: bearer({ sub: 'user_ana', azp: 'https://evil.example.com' }) });
    expect(res.status).toBe(401);
    expect(await db.collection(USERS).countDocuments()).toBe(0);
  });

  it('401 for a token without a subject', async () => {
    const res = await makeApp().request('/me', { headers: bearer({ sub: '' }) });
    expect(res.status).toBe(401);
  });

  it('ignores an email claim that is not a valid address', async () => {
    const res = await makeApp().request('/me', { headers: bearer({ sub: 'user_ana', email: 'not an email' }) });
    expect(MeResponseSchema.parse(await res.json()).user.email).toBeNull();
  });

  it('503 (not 500) when the server has no Clerk key configured', async () => {
    const res = await makeApp(null).request('/me', { headers: bearer({ sub: 'user_ana' }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'auth_not_configured' });
  });

  it('500 with a generic body if the database fails, without leaking details', async () => {
    const logError = vi.fn();
    const app = createApp({
      allowedOrigins: [WEB_ORIGIN],
      pingDb: async () => false,
      getDb: async () => {
        throw new Error('connect ECONNREFUSED mongodb+srv://user:hunter2@cluster');
      },
      verifyToken: createClerkVerifier(keys.publicPem),
      logError,
    });
    const res = await app.request('/me', { headers: bearer({ sub: 'user_ana' }) });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('hunter2');
    expect(logError).toHaveBeenCalledOnce();
  });
});
