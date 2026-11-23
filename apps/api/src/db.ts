import { type Db, MongoClient } from 'mongodb';

/**
 * One MongoClient per process. On Vercel the module stays loaded between warm
 * invocations, so the connection pool is reused instead of reconnecting per request.
 */
let client: MongoClient | undefined;
let connecting: Promise<MongoClient> | undefined;

export async function getDb(uri: string, dbName: string): Promise<Db> {
  if (!client) {
    connecting ??= new MongoClient(uri, {
      appName: 'bdgtr-api',
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5_000,
    })
      .connect()
      .then((c) => {
        client = c;
        return c;
      })
      .finally(() => {
        connecting = undefined;
      });
    await connecting;
  }
  return client!.db(dbName);
}

/** Returns true if the database answers a ping. Never throws. */
export async function pingDb(uri: string, dbName: string): Promise<boolean> {
  try {
    const db = await getDb(uri, dbName);
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = undefined;
}
