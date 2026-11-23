import { verifyToken } from '@clerk/backend';

import type { VerifyToken } from './auth.js';

/**
 * Networkless Clerk session-token verification: checks the signature against
 * the instance's JWT public key (PEM) plus expiry and not-before, with no call
 * to Clerk per request. The key is PUBLIC (Clerk dashboard → API keys →
 * "JWT public key"), so it isn't a secret, but it's still configured per environment.
 */
export function createClerkVerifier(jwtKeyPem: string): VerifyToken {
  // Env vars often store the PEM with literal "\n" sequences.
  const jwtKey = jwtKeyPem.replace(/\\n/g, '\n').trim();
  return async (token) => {
    const payload = await verifyToken(token, { jwtKey });
    return {
      sub: payload.sub,
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
      azp: typeof payload.azp === 'string' ? payload.azp : undefined,
      email: (payload as Record<string, unknown>).email,
    };
  };
}
