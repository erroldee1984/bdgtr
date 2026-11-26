import type { Db } from 'mongodb';

import { getDb } from './db.js';
import { ensureHouseholdIndexes } from './households.js';
import { ensureAlertIndexes } from './alerts.js';
import { ensureBudgetIndexes } from './budgets.js';
import { ensureCategoryIndexes } from './categories.js';
import { ensureInviteIndexes } from './invites.js';
import { ensurePushIndexes } from './push.js';
import { ensureTransactionIndexes } from './transactions.js';
import { ensureUserIndexes } from './users.js';

let indexesReady: Promise<void> | undefined;

/**
 * Database handle for request handlers. Creates the unique indexes the data
 * model relies on once per process (idempotent in MongoDB), so a fresh
 * database is safe without a separate migration step.
 */
export async function getAppDb(uri: string, dbName: string): Promise<Db> {
  const db = await getDb(uri, dbName);
  indexesReady ??= Promise.all([
    ensureUserIndexes(db),
    ensureHouseholdIndexes(db),
    ensureInviteIndexes(db),
    ensureCategoryIndexes(db),
    ensureTransactionIndexes(db),
    ensureAlertIndexes(db),
    ensurePushIndexes(db),
    ensureBudgetIndexes(db),
  ]).then((): void => undefined).catch((err) => {
    indexesReady = undefined; // retry on the next request
    throw err;
  });
  await indexesReady;
  return db;
}
