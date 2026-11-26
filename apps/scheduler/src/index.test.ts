import { describe, expect, it, vi } from 'vitest';

import worker, { jobsFor, MORNING_CRON, POSTINGS_CRON, runCron, runJob } from './index.ts';

const env = { API_URL: 'https://bdgtr-api.erroldee.com/', CRON_SECRET: 's'.repeat(40) };
const noWait = async () => {};

function fakeFetch(statuses: (number | Error)[]) {
  const calls: { url: string; auth: string | undefined }[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ url, auth: init.headers.Authorization });
    const next = statuses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return { status: next, text: async () => `{"ok":${next}}` };
  };
  return { fn, calls };
}

describe('schedule', () => {
  it('00:15 Manila (16:15 UTC) adds fixed transactions; 07:00 Manila (23:00 UTC) sends the summary then the notices', () => {
    expect(jobsFor(POSTINGS_CRON)).toEqual(['/internal/cron/fixed-postings']);
    expect(jobsFor(MORNING_CRON)).toEqual(['/internal/cron/daily-digest', '/internal/cron/fixed-notices']);
    expect(jobsFor('* * * * *')).toEqual([]);
  });

  it('wrangler.toml schedules exactly those two crons', async () => {
    const toml = (await import('node:fs')).readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml).toContain(`crons = ["${POSTINGS_CRON}", "${MORNING_CRON}"]`);
    expect(toml).toContain('workers_dev = false');
    expect(toml).not.toMatch(/CRON_SECRET\s*=/); // the secret is never in the file
  });
});

describe('runJob', () => {
  it('POSTs to the API with the secret as a Bearer token', async () => {
    const f = fakeFetch([200]);
    expect(await runJob(env, '/internal/cron/fixed-postings', { fetch: f.fn, wait: noWait })).toBe('{"ok":200}');
    expect(f.calls).toEqual([{ url: 'https://bdgtr-api.erroldee.com/internal/cron/fixed-postings', auth: `Bearer ${env.CRON_SECRET}` }]);
  });

  it('retries network errors and 5xx, waiting longer each time', async () => {
    const f = fakeFetch([new Error('reset'), 503, 200]);
    const waits: number[] = [];
    await runJob(env, '/x', { fetch: f.fn, wait: async (ms) => void waits.push(ms) });
    expect(f.calls).toHaveLength(3);
    expect(waits).toEqual([2000, 4000]);
  });

  it('does not retry a 4xx (e.g. wrong secret) and fails loudly', async () => {
    const f = fakeFetch([401]);
    await expect(runJob(env, '/x', { fetch: f.fn, wait: noWait })).rejects.toThrow('Scheduled job failed: /x → 401');
    expect(f.calls).toHaveLength(1);
  });

  it('really waits between attempts by default (2 s, then 4 s)', async () => {
    vi.useFakeTimers();
    const f = fakeFetch([503, 200]);
    const done = runJob(env, '/x', { fetch: f.fn });
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBe('{"ok":200}');
    vi.useRealTimers();
  });

  it('gives up after the attempts', async () => {
    const f = fakeFetch([500, 500, 500, 500, 500]);
    await expect(runJob(env, '/x', { fetch: f.fn, wait: noWait, attempts: 4 })).rejects.toThrow('/x → 500');
    expect(f.calls).toHaveLength(4);
  });
});

describe('runCron', () => {
  it('a failed summary still lets the notices run, and the run is reported as failed', async () => {
    const f = fakeFetch([401, 200]);
    await expect(runCron(env, MORNING_CRON, { fetch: f.fn, wait: noWait })).rejects.toThrow('daily-digest → 401');
    expect(f.calls.map((c) => c.url.split('/').pop())).toEqual(['daily-digest', 'fixed-notices']);
  });

  it('reports what each job answered', async () => {
    const f = fakeFetch([200, 200]);
    expect(await runCron(env, MORNING_CRON, { fetch: f.fn, wait: noWait })).toEqual([
      '/internal/cron/daily-digest {"ok":200}',
      '/internal/cron/fixed-notices {"ok":200}',
    ]);
  });
});

describe('worker', () => {
  it('scheduled() hands the run to waitUntil', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({ cron: POSTINGS_CRON }, env, { waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    expect(spy).toHaveBeenCalledWith('https://bdgtr-api.erroldee.com/internal/cron/fixed-postings', expect.objectContaining({ method: 'POST' }));
    expect(log).toHaveBeenCalledWith('/internal/cron/fixed-postings {}');
    spy.mockRestore();
    log.mockRestore();
  });

  it('answers 404 to any web request', async () => {
    expect((await worker.fetch()).status).toBe(404);
  });
});
