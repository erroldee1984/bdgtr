import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { ensureHouseholdIndexes, HOUSEHOLDS, MEMBERSHIPS } from './households.js';
import { ensureRateLimitIndexes, MAX_READS_PER_WINDOW, MAX_WRITES_PER_WINDOW, RATE_LIMITS, takeRequest } from './rate-limit.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';
import { ensureUserIndexes, USERS } from './users.js';

const keys = makeTestKeys();
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let clock = new Date('2026-11-26T02:00:30.000Z');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('bdgtr_rate_test');
  await Promise.all([ensureUserIndexes(db), ensureHouseholdIndexes(db), ensureRateLimitIndexes(db)]);
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  clock = new Date('2026-11-26T02:00:30.000Z');
  await Promise.all([USERS, HOUSEHOLDS, MEMBERSHIPS, RATE_LIMITS].map((c) => db.collection(c).deleteMany({})));
});

const app = createApp({
  allowedOrigins: ['https://bdgtr.erroldee.com'],
  pingDb: async () => true,
  getDb: async () => db,
  verifyToken: createClerkVerifier(keys.publicPem),
  now: () => clock,
  rateLimit: true,
  logError: () => {},
});
const me = (who: string) => app.request('/me', { headers: { Authorization: `Bearer ${signTestToken(keys.privateKey, { sub: who, email: `${who}@example.com` })}` } });

describe('takeRequest', () => {
  it('writes: the 121st in a 5-minute window is refused with how long to wait', async () => {
    for (let i = 0; i < MAX_WRITES_PER_WINDOW; i++) expect(await takeRequest(db, 'u1', 'POST', clock)).toBeNull();
    expect(await takeRequest(db, 'u1', 'DELETE', clock)).toBe(270); // window ends 02:05:00
  });

  it('reads have their own, larger allowance; people and windows are separate', async () => {
    for (let i = 0; i < MAX_WRITES_PER_WINDOW + 1; i++) await takeRequest(db, 'u1', 'PATCH', clock);
    expect(await takeRequest(db, 'u1', 'GET', clock)).toBeNull(); // reads unaffected
    expect(await takeRequest(db, 'u2', 'POST', clock)).toBeNull(); // someone else
    expect(await takeRequest(db, 'u1', 'POST', new Date('2026-11-26T02:05:00.000Z'))).toBeNull(); // next window
  });

  it('counters expire on their own (TTL two windows after they start)', async () => {
    await takeRequest(db, 'u1', 'GET', clock);
    const doc = await db.collection(RATE_LIMITS).findOne({});
    expect(doc?.expiresAt).toEqual(new Date('2026-11-26T02:10:00.000Z'));
  });
});

describe('wiring', () => {
  it('production (index.ts) and local dev (server.ts) turn the limits on', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['./index.ts', './server.ts']) expect(readFileSync(new URL(f, import.meta.url), 'utf8')).toMatch(/rateLimit: true/);
  });
});

describe('through the API', () => {
  it('a signed-in flood gets 429 with Retry-After; others are unaffected', async () => {
    await db.collection(RATE_LIMITS).insertOne({ _id: `flood:${Date.parse('2026-11-26T02:00:00.000Z')}` as never, reads: MAX_READS_PER_WINDOW, writes: 0, expiresAt: clock });
    const res = await me('flood');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('270');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect((await me('calm')).status).toBe(200);
  });
});
