/**
 * Vercel entry point (zero-config Hono: Vercel detects src/index.ts and serves
 * the default-exported app as a Vercel Function). Local dev uses src/server.ts.
 */
import { Hono } from 'hono';

import { createApp } from './create-app.js';
import { pingDb } from './db.js';
import { loadEnv } from './env.js';

function buildApp() {
  try {
    const env = loadEnv(process.env);
    return createApp({
      allowedOrigins: env.ALLOWED_ORIGINS,
      pingDb: () => pingDb(env.MONGODB_URI, env.MONGODB_DB),
    });
  } catch (err) {
    // Misconfigured deployment: log the reason (EnvError never contains secret
    // values) and answer every request with a generic 503 instead of crashing.
    console.error(err instanceof Error ? err.message : err);
    const fallback = new Hono();
    fallback.all('*', (c) => c.json({ error: 'service_misconfigured' }, 503));
    return fallback;
  }
}

const app = buildApp();

export default app;
