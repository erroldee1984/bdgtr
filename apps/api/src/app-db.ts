import type { Db } from 'mongodb';

import { getDb } from './db.js';
import { ensureHouseholdIndexes } from './households.js';
import { ensureUserIndexes } from './users.js';

let indexesReady: Promise<void> | undefined;

/**
 * Database handle for request handlers. Creates the unique indexes the data
 * model relies on once per process (idempotent in MongoDB), so a fresh
 * database is safe without a separate migration step.
 */
export async function getAppDb(uri: string, dbName: string): Promise<Db> {
  const db = await getDb(uri, dbName);
  indexesReady ??= Promise.all([ensureUserIndexes(db), ensureHouseholdIndexes(db)]).then((): void => undefined).catch((err) => {
    indexesReady = undefined; // retry on the next request
    throw err;
  });
  await indexesReady;
  return db;
}
