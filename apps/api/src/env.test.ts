import { describe, expect, it } from 'vitest';

import { EnvError, loadEnv } from './env';

const VALID_URI = 'mongodb+srv://bdgtr_app:s3cretPass@bdgtr-cluster.abcde.mongodb.net/?retryWrites=true';

describe('loadEnv', () => {
  it('accepts a complete configuration', () => {
    const env = loadEnv({
      MONGODB_URI: VALID_URI,
      MONGODB_DB: 'bdgtr',
      ALLOWED_ORIGINS: 'http://localhost:8081, https://bdgtr.erroldee.com',
      PORT: '9000',
    });
    expect(env).toEqual({
      MONGODB_URI: VALID_URI,
      MONGODB_DB: 'bdgtr',
      ALLOWED_ORIGINS: ['http://localhost:8081', 'https://bdgtr.erroldee.com'],
      PORT: 9000,
    });
  });

  it('applies defaults for optional values', () => {
    const env = loadEnv({ MONGODB_URI: VALID_URI });
    expect(env.MONGODB_DB).toBe('bdgtr');
    expect(env.ALLOWED_ORIGINS).toEqual([]);
    expect(env.PORT).toBe(8787);
  });

  it('fails when MONGODB_URI is missing', () => {
    expect(() => loadEnv({})).toThrow(EnvError);
    expect(() => loadEnv({})).toThrow(/MONGODB_URI is required/);
  });

  it.each([
    ['https://example.com', /must start with mongodb/],
    ['mongodb+srv://<db_user>:<db_password>@cluster/', /placeholder/],
  ])('rejects MONGODB_URI %j', (uri, message) => {
    expect(() => loadEnv({ MONGODB_URI: uri })).toThrow(message);
  });

  it('never includes the secret value in error messages', () => {
    const secretish = 'postgres://admin:TopSecret123@db.internal';
    try {
      loadEnv({ MONGODB_URI: secretish });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('TopSecret123');
    }
  });

  it.each([
    [{ MONGODB_DB: 'bad name; drop' }, /simple database name/],
    [{ ALLOWED_ORIGINS: 'not a url' }, /ALLOWED_ORIGINS/],
    [{ ALLOWED_ORIGINS: 'ftp://files.example.com' }, /ALLOWED_ORIGINS/],
    [{ PORT: '70000' }, /./],
    [{ PORT: 'abc' }, /./],
  ])('rejects invalid optional value %j', (extra, message) => {
    expect(() => loadEnv({ MONGODB_URI: VALID_URI, ...extra })).toThrow(message);
  });
});
