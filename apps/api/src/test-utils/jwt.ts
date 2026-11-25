import { createSign, generateKeyPairSync } from 'node:crypto';

/** An RSA key pair standing in for a Clerk instance in tests. */
export function makeTestKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  };
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** Signs an RS256 JWT shaped like a Clerk session token. */
export function signTestToken(
  privateKey: ReturnType<typeof makeTestKeys>['privateKey'],
  claims: Record<string, unknown>,
  { expiresInSec = 60, notBeforeOffsetSec = -5 }: { expiresInSec?: number; notBeforeOffsetSec?: number } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  // cat = Clerk's session-token category marker; @clerk/backend rejects tokens without it.
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ins_test', cat: 'cl_B7d4PD111AAA' }));
  const payload = b64url(
    JSON.stringify({
      iss: 'https://test.clerk.accounts.dev',
      iat: now,
      nbf: now + notBeforeOffsetSec,
      exp: now + expiresInSec,
      sid: 'sess_test',
      ...claims,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}
