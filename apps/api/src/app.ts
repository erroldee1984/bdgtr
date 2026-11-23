import type { HealthResponse, ReadyResponse } from '@bdgtr/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

export interface AppDeps {
  /** Browser origins allowed by CORS. Native Android requests send no Origin and are unaffected. */
  allowedOrigins: string[];
  /** Checks the database connection; must not throw. */
  pingDb: () => Promise<boolean>;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Error reporter; defaults to console.error. Must not receive request bodies (PII). */
  logError?: (err: unknown) => void;
}

const MAX_BODY_BYTES = 64 * 1024;

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const logError = deps.logError ?? ((err) => console.error(err));
  const app = new Hono();

  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains',
      xFrameOptions: 'DENY',
      referrerPolicy: 'no-referrer',
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  );

  app.use(
    '*',
    cors({
      origin: (origin) => (deps.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Authorization', 'Content-Type', 'X-Household-Id'],
      maxAge: 600,
    }),
  );

  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
  );

  app.get('/health', (c) =>
    c.json<HealthResponse>({ status: 'ok', service: 'bdgtr-api', time: now().toISOString() }),
  );

  app.get('/health/ready', async (c) => {
    const dbOk = await deps.pingDb().catch(() => false);
    const body: ReadyResponse = dbOk
      ? { status: 'ok', database: 'ok' }
      : { status: 'unavailable', database: 'unreachable' };
    return c.json(body, dbOk ? 200 : 503);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  // Generic message only: never leak stack traces, queries or secrets to clients.
  app.onError((err, c) => {
    logError(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
