import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The one test MongoDB every API test file connects to (each uses its own database). */
    mongoUri: string;
  }
}

/**
 * The shared test MongoDB started by vitest.global-setup.ts, with the same
 * shape the test files used for their own server (getUri / stop). `stop`
 * does nothing: the global setup stops the server after every file has run.
 */
export interface SharedMongo {
  getUri: () => string;
  stop: () => Promise<void>;
}

export async function sharedMongo(): Promise<SharedMongo> {
  const uri = inject('mongoUri');
  return { getUri: () => uri, stop: async () => {} };
}
