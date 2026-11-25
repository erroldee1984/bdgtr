/**
 * Local development server. Production runs on Vercel (set up in M0's hosting step).
 * Reads apps/api/.env if present; never logs secret values.
 */
import { existsSync } from 'node:fs';

import { serve } from '@hono/node-server';

import { getAppDb } from './app-db.js';
import { createClerkVerifier } from './clerk.js';
import { createApp } from './create-app.js';
import { closeDb, pingDb } from './db.js';
import { EnvError, loadEnv } from './env.js';

if (existsSync('.env')) process.loadEnvFile('.env');

let env;
try {
  env = loadEnv(process.env);
} catch (err) {
  if (err instanceof EnvError) {
    console.error(`${err.message}\n\nCopy apps/api/.env.example to apps/api/.env and fill it in.`);
    process.exit(1);
  }
  throw err;
}

const { MONGODB_URI, MONGODB_DB, ALLOWED_ORIGINS, PORT, CLERK_JWT_KEY } = env;
const app = createApp({
  allowedOrigins: ALLOWED_ORIGINS,
  pingDb: () => pingDb(MONGODB_URI, MONGODB_DB),
  getDb: () => getAppDb(MONGODB_URI, MONGODB_DB),
  verifyToken: CLERK_JWT_KEY ? createClerkVerifier(CLERK_JWT_KEY) : null,
});
if (!CLERK_JWT_KEY) console.warn('CLERK_JWT_KEY not set: signed-in routes will answer 503.');
console.log(`Database: ${MONGODB_DB}`);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`bdgtr-api listening on http://localhost:${info.port}`);
  console.log(`  health: http://localhost:${info.port}/health`);
  console.log(`  ready:  http://localhost:${info.port}/health/ready (checks MongoDB Atlas)`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void closeDb().finally(() => process.exit(0));
  });
}
