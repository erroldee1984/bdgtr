import { HealthResponseSchema } from '@bdgtr/shared';
import { describe, expect, it, vi } from 'vitest';

import { type AppDeps, createApp } from './create-app.js';

const FIXED_NOW = new Date('2026-11-23T05:00:00.000Z');
const WEB_ORIGIN = 'https://bdgtr.erroldee.com';

function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    allowedOrigins: [WEB_ORIGIN],
    pingDb: async () => true,
    now: () => FIXED_NOW,
    logError: () => {},
    ...overrides,
  });
}

describe('GET /health', () => {
  it('returns ok with a valid, schema-conformant body', async () => {
    const res = await makeApp().request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(HealthResponseSchema.parse(body)).toEqual({
      status: 'ok',
      service: 'bdgtr-api',
      time: FIXED_NOW.toISOString(),
    });
  });

  it('does not touch the database', async () => {
    const pingDb = vi.fn(async () => true);
    await makeApp({ pingDb }).request('/health');
    expect(pingDb).not.toHaveBeenCalled();
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when the database answers', async () => {
    const res = await makeApp().request('/health/ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('returns 503 when the database is unreachable', async () => {
    const res = await makeApp({ pingDb: async () => false }).request('/health/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unavailable', database: 'unreachable' });
  });

  it('returns 503 (not 500) and leaks nothing if the ping throws', async () => {
    const secret = 'mongodb+srv://user:hunter2@cluster.example.net';
    const res = await makeApp({
      pingDb: async () => {
        throw new Error(`connect failed for ${secret}`);
      },
    }).request('/health/ready');
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('hunter2');
  });
});

describe('error handling', () => {
  it('unknown routes return a JSON 404', async () => {
    const res = await makeApp().request('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('unexpected errors return a generic 500 without internal details', async () => {
    const logError = vi.fn();
    const app = makeApp({ logError });
    app.get('/boom', () => {
      throw new Error('secret internal detail');
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: 'internal_error' }));
    expect(logError).toHaveBeenCalledOnce();
  });

  it('rejects request bodies over 64 KB with 413', async () => {
    const app = makeApp();
    app.post('/echo', async (c) => c.json(await c.req.json()));
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});

describe('CORS', () => {
  it('allows the configured web origin', async () => {
    const res = await makeApp().request('/health', { headers: { Origin: WEB_ORIGIN } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
  });

  it('does not allow other origins', async () => {
    const res = await makeApp().request('/health', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('preflight from a disallowed origin gets no allow-origin header', async () => {
    const res = await makeApp().request('/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('security headers', () => {
  it('sets HSTS, nosniff, frame denial and a locked-down CSP', async () => {
    const res = await makeApp().request('/health');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });
});
