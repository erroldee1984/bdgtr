import { afterEach, describe, expect, it, vi } from 'vitest';

const VALID_URI = 'mongodb+srv://bdgtr_app:s3cretPass@bdgtr-cluster.abcde.mongodb.net/?retryWrites=true';

async function importEntry() {
  vi.resetModules();
  return (await import('./index')).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Vercel entry (src/index.ts)', () => {
  it('serves the real app when configuration is valid', async () => {
    vi.stubEnv('MONGODB_URI', VALID_URI);
    vi.stubEnv('ALLOWED_ORIGINS', 'https://bdgtr.erroldee.com');
    const app = await importEntry();

    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'bdgtr-api' });
  });

  it('answers 503 for every route when configuration is missing, without crashing', async () => {
    vi.stubEnv('MONGODB_URI', '');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = await importEntry();

    for (const path of ['/health', '/health/ready', '/anything']) {
      const res = await app.request(path);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'service_misconfigured' });
    }
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('MONGODB_URI is required'));
  });

  it('never logs the secret when configuration is invalid', async () => {
    vi.stubEnv('MONGODB_URI', 'postgres://admin:TopSecret123@db.internal');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await importEntry();

    const output = logged.mock.calls.flat().map(String).join('\n');
    expect(output).not.toContain('TopSecret123');
  });
});
