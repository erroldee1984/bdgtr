/**
 * bdgtr scheduler (docs/PLAN.md §1): a Cloudflare Worker whose Cron Triggers
 * call the API's internal jobs. Cloudflare runs crons in UTC; Manila is UTC+8
 * all year (no daylight saving), so:
 *   "15 16 * * *"  = 00:15 Manila → add today's fixed transactions
 *   "0 23 * * *"   = 07:00 Manila → daily summary, then fixed-transaction notices
 * Every endpoint is safe to call twice, so failed calls are simply retried.
 * The Worker has no public URL (workers_dev = false) and answers 404 to any request.
 */

export interface Env {
  /** e.g. https://bdgtr-api.erroldee.com (a plain var in wrangler.toml). */
  API_URL: string;
  /** Shared with the API (Vercel env var). A Worker secret: `wrangler secret put CRON_SECRET`. */
  CRON_SECRET: string;
}

export const POSTINGS_CRON = '15 16 * * *';
export const MORNING_CRON = '0 23 * * *';

/** Which API jobs a cron runs, in order. */
export function jobsFor(cron: string): string[] {
  if (cron === POSTINGS_CRON) return ['/internal/cron/fixed-postings'];
  if (cron === MORNING_CRON) return ['/internal/cron/daily-digest', '/internal/cron/fixed-notices'];
  return [];
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * POSTs one job with the secret. Retries network errors and 5xx (up to
 * `attempts`, waiting longer each time); a 4xx (e.g. a wrong secret) isn't
 * retried. Throws if it never succeeds, so the run shows as failed in Cloudflare.
 */
export async function runJob(
  env: Env,
  path: string,
  { fetch: doFetch = fetch as unknown as Fetch, attempts = 4, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<string> {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await wait(2 ** i * 1000);
    try {
      const res = await doFetch(`${env.API_URL.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      });
      const body = await res.text();
      if (res.status >= 200 && res.status < 300) return body;
      last = `${path} → ${res.status}`;
      if (res.status < 500) break; // the request itself is wrong: retrying won't help
    } catch (err) {
      last = `${path} → ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(`Scheduled job failed: ${last}`);
}

/** Runs a cron's jobs in order; each one is attempted even if an earlier one failed. */
export async function runCron(env: Env, cron: string, opts: Parameters<typeof runJob>[2] = {}): Promise<string[]> {
  const errors: string[] = [];
  const done: string[] = [];
  for (const path of jobsFor(cron)) {
    try {
      done.push(`${path} ${await runJob(env, path, opts)}`);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
  return done;
}

interface ScheduledController {
  cron: string;
}
interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env, controller.cron).then((lines) => lines.forEach((l) => console.log(l))));
  },
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404 });
  },
};
