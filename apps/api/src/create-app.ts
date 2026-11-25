import type { HealthResponse, MeResponse, ReadyResponse } from '@bdgtr/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { Db } from 'mongodb';

import { requireAuth, type VerifyToken } from './auth.js';
import { type AppVariables, registerHouseholdRoutes } from './household-routes.js';
import { listMembershipsForUser } from './households.js';
import { registerMemberRoutes } from './member-routes.js';
import { registerSpendingRoutes } from './spending-routes.js';

export interface AppDeps {
  /** Browser origins allowed by CORS. Native Android requests send no Origin and are unaffected. */
  allowedOrigins: string[];
  /** Checks the database connection; must not throw. */
  pingDb: () => Promise<boolean>;
  /** Database handle (connection is reused across requests). */
  getDb: () => Promise<Db>;
  /** Clerk session-token verifier, or null if CLERK_JWT_KEY isn't configured. */
  verifyToken: VerifyToken | null;
  /** Origins allowed in a token's azp claim (browser sign-ins). Defaults to allowedOrigins. */
  authorizedParties?: string[];
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Error reporter; defaults to console.error. Must not receive request bodies (PII). */
  logError?: (err: unknown) => void;
}

const MAX_BODY_BYTES = 64 * 1024;

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const logError = deps.logError ?? ((err) => console.error(err));
  const app = new Hono<{ Variables: AppVariables }>();
  const auth = requireAuth<{ Variables: AppVariables }>({
    verify: deps.verifyToken,
    authorizedParties: deps.authorizedParties ?? deps.allowedOrigins,
  });

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

  const { loadUser } = registerHouseholdRoutes(app, auth, { getDb: deps.getDb, now });
  registerMemberRoutes(app, auth, loadUser, { getDb: deps.getDb, now });
  registerSpendingRoutes(app, auth, loadUser, { getDb: deps.getDb, now });

  // Signed-in user and their households. Creates the user record on first sign-in.
  app.get('/me', auth, loadUser, async (c) => {
    const user = c.get('user');
    const db = await deps.getDb();
    return c.json<MeResponse>({
      user: { id: user._id.toHexString(), email: user.email, name: user.displayName ?? null },
      memberships: await listMembershipsForUser(db, user._id),
    });
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  // Generic message only: never leak stack traces, queries or secrets to clients.
  app.onError((err, c) => {
    // Deliberate HTTP errors (e.g. 400 from input validation) carry their own response.
    if (err instanceof HTTPException) return err.getResponse();
    logError(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
