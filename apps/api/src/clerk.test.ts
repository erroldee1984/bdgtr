import { describe, expect, it } from 'vitest';

import { createClerkVerifier } from './clerk.js';
import { makeTestKeys, signTestToken } from './test-utils/jwt.js';

const keys = makeTestKeys();
const otherKeys = makeTestKeys();

describe('createClerkVerifier (real signature checks)', () => {
  it('accepts a valid token and returns its claims', async () => {
    const verify = createClerkVerifier(keys.publicPem);
    const token = signTestToken(keys.privateKey, { sub: 'user_1', email: 'ana@example.com', azp: 'https://bdgtr.erroldee.com' });
    await expect(verify(token)).resolves.toEqual({
      sub: 'user_1',
      sid: 'sess_test',
      azp: 'https://bdgtr.erroldee.com',
      email: 'ana@example.com',
    });
  });

  it('accepts a PEM stored with literal \\n sequences (as env vars often are)', async () => {
    const verify = createClerkVerifier(keys.publicPem.replace(/\n/g, '\\n'));
    const token = signTestToken(keys.privateKey, { sub: 'user_1' });
    await expect(verify(token)).resolves.toMatchObject({ sub: 'user_1' });
  });

  it('rejects a token signed by a different key', async () => {
    const verify = createClerkVerifier(keys.publicPem);
    const forged = signTestToken(otherKeys.privateKey, { sub: 'user_1' });
    await expect(verify(forged)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const verify = createClerkVerifier(keys.publicPem);
    const expired = signTestToken(keys.privateKey, { sub: 'user_1' }, { expiresInSec: -120 });
    await expect(verify(expired)).rejects.toThrow();
  });

  it('rejects a token that is not valid yet', async () => {
    const verify = createClerkVerifier(keys.publicPem);
    const future = signTestToken(keys.privateKey, { sub: 'user_1' }, { notBeforeOffsetSec: 600, expiresInSec: 900 });
    await expect(verify(future)).rejects.toThrow();
  });

  it('rejects a token whose payload was tampered with', async () => {
    const verify = createClerkVerifier(keys.publicPem);
    const [h, , s] = signTestToken(keys.privateKey, { sub: 'user_1' }).split('.');
    const evilPayload = Buffer.from(JSON.stringify({ sub: 'user_admin', exp: 9_999_999_999 })).toString('base64url');
    await expect(verify(`${h}.${evilPayload}.${s}`)).rejects.toThrow();
  });

  it('rejects an unsigned ("alg": "none") token', async () => {
    const verify = createClerkVerifier(keys.publicPem);
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user_1', exp: 9_999_999_999 })).toString('base64url');
    await expect(verify(`${header}.${payload}.`)).rejects.toThrow();
  });
});
