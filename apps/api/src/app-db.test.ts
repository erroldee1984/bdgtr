import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getAppDb } from './app-db.js';
import { closeDb, getDb, pingDb } from './db.js';
import { MEMBERSHIPS } from './households.js';
import { USERS } from './users.js';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
}, 120_000);

afterEach(async () => {
  await closeDb();
});

afterAll(async () => {
  await mongo?.stop();
});

const indexNames = async (db: Awaited<ReturnType<typeof getDb>>, coll: string) =>
  (await db.collection(coll).indexes()).map((i) => i.name);

describe('getAppDb (database handle for requests)', () => {
  it('creates the unique indexes the data model relies on, on a fresh database', async () => {
    const db = await getAppDb(mongo.getUri(), 'bdgtr_appdb_fresh');
    expect(await indexNames(db, MEMBERSHIPS)).toContain('household_user_unique');
    expect((await indexNames(db, USERS)).length).toBeGreaterThan(1);
  });

  it('many concurrent first requests share one connection and one database', async () => {
    const dbs = await Promise.all(Array.from({ length: 10 }, () => getAppDb(mongo.getUri(), 'bdgtr_appdb_concurrent')));
    expect(new Set(dbs.map((d) => d.databaseName))).toEqual(new Set(['bdgtr_appdb_concurrent']));
    expect(new Set(dbs.map((d) => d.client)).size).toBe(1);
  });
});

describe('pingDb', () => {
  it('is true when the database answers', async () => {
    expect(await pingDb(mongo.getUri(), 'bdgtr_ping')).toBe(true);
  });

  it('is false (never throws) when the database is unreachable', async () => {
    expect(await pingDb('mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500', 'bdgtr_ping')).toBe(false);
  }, 20_000);
});
