import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

import './src/test-utils/mongo.js'; // the ProvidedContext type for 'mongoUri'

/**
 * Starts ONE MongoDB (a single-node replica set, so transactions work) for all
 * API test files; each file uses its own database name on it.
 *
 * Regressions (CI on main, random): when every file started its own server,
 * (1) with a cold cache they raced over the binary download's lock file
 * ("UnableToUnlockLockfileError"), and (2) two servers picked the same free
 * port at once ("Port … already in use"). One server avoids both.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  project.provide('mongoUri', mongo.getUri());
  return async () => {
    await mongo.stop();
  };
}
