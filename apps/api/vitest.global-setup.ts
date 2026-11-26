import { MongoBinary } from 'mongodb-memory-server';

/**
 * Downloads the MongoDB test binary once, before any test file starts.
 * Regression (M5b, CI): with a cold cache, several test files started their
 * own MongoMemoryServer at once and raced over the download's lock file
 * ("UnableToUnlockLockfileError: Cannot unlock file …/mongodb-binaries/8.2.6.lock"),
 * failing CI at random.
 */
export default async function setup(): Promise<void> {
  await MongoBinary.getPath();
}
