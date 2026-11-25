import type { MiddlewareHandler } from 'hono';

/** Who is calling, taken from a verified Clerk session token. */
export interface AuthContext {
  /** Clerk user ID (`sub` claim), e.g. "user_2Rf…". */
  userId: string;
  /** Clerk session ID (`sid` claim). */
  sessionId: string | null;
  /**
   * Primary email from the custom `email` session claim (Clerk dashboard →
   * Sessions → Customize session token). Null if the claim isn't configured.
   */
  email: string | null;
}

/** Claims we read from a verified token. Anything else is ignored. */
export interface VerifiedClaims {
  sub: string;
  sid?: string | undefined;
  azp?: string | undefined;
  email?: unknown;
}

/**
 * Verifies a raw session token and returns its claims, or throws if the token
 * is invalid or expired. Production uses Clerk's verifyToken (see clerk.ts);
 * tests inject a fake.
 */
export type VerifyToken = (token: string) => Promise<VerifiedClaims>;

export type AuthVariables = { auth: AuthContext };

const BEARER = /^Bearer\s+([A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_.+/=]*)$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Requires a valid Clerk session token: `Authorization: Bearer <jwt>`.
 * - 401 for a missing, malformed, invalid or expired token (reason never echoed).
 * - 401 if the token was issued to a browser origin not in `authorizedParties`
 *   (`azp` claim). Native Android tokens have no `azp` and are allowed.
 * - 503 if the server has no Clerk key configured (deployment mistake).
 */
export function requireAuth(options: {
  verify: VerifyToken | null;
  authorizedParties: string[];
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    if (!options.verify) return c.json({ error: 'auth_not_configured' }, 503);

    const match = BEARER.exec(c.req.header('Authorization') ?? '');
    if (!match) return unauthorized(c);

    let claims: VerifiedClaims;
    try {
      claims = await options.verify(match[1]!);
    } catch {
      return unauthorized(c);
    }

    if (typeof claims.sub !== 'string' || claims.sub.length === 0) return unauthorized(c);
    if (claims.azp && !options.authorizedParties.includes(claims.azp)) return unauthorized(c);

    const email =
      typeof claims.email === 'string' && EMAIL.test(claims.email) ? claims.email.toLowerCase() : null;

    c.set('auth', { userId: claims.sub, sessionId: claims.sid ?? null, email });
    await next();
  };
}

function unauthorized(c: Parameters<MiddlewareHandler>[0]) {
  c.header('WWW-Authenticate', 'Bearer');
  return c.json({ error: 'unauthorized' }, 401);
}
