import { createHash, timingSafeEqual } from 'node:crypto';

import {
  addDays,
  BulkPostInputSchema,
  type BulkPostResponse,
  CreateFixedInputSchema,
  type FixedTransactionResponse,
  type FixedTransactionsResponse,
  isTooFarAhead,
  isValidIsoDate,
  manilaDate,
  MAX_FIXED_TRANSACTIONS,
  UpdateFixedInputSchema,
  type ValidationError,
  YEAR_MONTH_PATTERN,
  yearMonthOf,
} from '@bdgtr/shared';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { type Db, ObjectId } from 'mongodb';

import { readCutoff, toAlert } from './alerts.js';
import { findCategory } from './categories.js';
import { sendDailySummaries } from './digest.js';
import {
  autoPostDue,
  countFixed,
  createFixed,
  FIXED,
  type FixedDoc,
  findFixed,
  listFixed,
  postFixed,
  removeFixed,
  sendFixedNotices,
  toFixed,
  updateFixed,
} from './fixed.js';
import { type AppVariables, requireHousehold } from './household-routes.js';
import type { PushSender } from './push.js';
import { toTransaction } from './transactions.js';
import { parseJsonBody } from './validation.js';

type AppEnv = { Variables: AppVariables };

interface Deps {
  getDb: () => Promise<Db>;
  now: () => Date;
  sendPush: PushSender | null;
  /** Shared with the Cloudflare Worker that triggers the jobs; null = cron endpoints off. */
  cronSecret: string | null;
}

function idParam(c: Context<AppEnv>, name: string): ObjectId | null {
  const raw = c.req.param(name) ?? '';
  return /^[0-9a-f]{24}$/.test(raw) ? new ObjectId(raw) : null;
}

/** Constant-time check of "Authorization: Bearer <secret>" (docs/PLAN.md §10). */
export function hasCronSecret(header: string | undefined, secret: string): boolean {
  const given = /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

/**
 * Monthly fixed transactions (docs/PLAN.md §5, §6.5). Everyone views;
 * Owners/Co-Owners add, change, remove and bulk-add. The auto-post job is
 * an internal endpoint for the scheduler.
 */
export function registerFixedRoutes(app: Hono<AppEnv>, auth: MiddlewareHandler<AppEnv>, loadUser: MiddlewareHandler<AppEnv>, deps: Deps) {
  const inHousehold = (capability: Parameters<typeof requireHousehold>[1]) => [auth, loadUser, requireHousehold(deps, capability)] as const;

  /** The category must be this household's and not removed. Null when fine. */
  async function categoryProblem(c: Context<AppEnv>, db: Db, categoryId: string) {
    const category = await findCategory(db, c.get('household')._id, new ObjectId(categoryId));
    if (!category) return c.json({ error: 'category_not_found' }, 404);
    if (category.isRemoved) return c.json({ error: 'category_removed' }, 409);
    return null;
  }

  app.get('/fixed-transactions', ...inHousehold('view'), async (c) => {
    const raw = c.req.query('month');
    const month = raw ?? yearMonthOf(manilaDate(deps.now()));
    if (!YEAR_MONTH_PATTERN.test(month)) return c.json({ error: 'invalid_month' }, 400);
    const db = await deps.getDb();
    return c.json<FixedTransactionsResponse>({ month, items: await listFixed(db, c.get('household')._id, month) });
  });

  app.post('/fixed-transactions', ...inHousehold('manage_budget_data'), async (c) => {
    const input = await parseJsonBody(c, CreateFixedInputSchema);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    if ((await countFixed(db, householdId)) >= MAX_FIXED_TRANSACTIONS) return c.json({ error: 'fixed_limit' }, 409);
    const problem = await categoryProblem(c, db, input.categoryId);
    if (problem) return problem;
    const doc = await createFixed(db, householdId, input, c.get('user')._id, deps.now());
    return c.json<FixedTransactionResponse>({ item: toFixed(doc, null) }, 201);
  });

  app.patch('/fixed-transactions/:id', ...inHousehold('manage_budget_data'), async (c) => {
    const id = idParam(c, 'id');
    const input = await parseJsonBody(c, UpdateFixedInputSchema);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    const existing = await findFixed(db, householdId, id);
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (input.categoryId !== undefined && input.categoryId !== existing.categoryId.toHexString()) {
      const problem = await categoryProblem(c, db, input.categoryId);
      if (problem) return problem;
    }
    const doc = await updateFixed(db, householdId, id, input, deps.now());
    if (!doc) return c.json({ error: 'not_found' }, 404);
    const month = yearMonthOf(manilaDate(deps.now()));
    const postedOn = (await listFixed(db, householdId, month)).find((f) => f.id === id.toHexString())?.postedOn ?? null;
    return c.json<FixedTransactionResponse>({ item: toFixed(doc, postedOn) });
  });

  // Soft remove: spends already added from it stay as they are.
  app.delete('/fixed-transactions/:id', ...inHousehold('manage_budget_data'), async (c) => {
    const id = idParam(c, 'id');
    if (!id) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    if (!(await removeFixed(db, c.get('household')._id, id, deps.now()))) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  app.post('/fixed-transactions/bulk-post', ...inHousehold('manage_budget_data'), async (c) => {
    const input = await parseJsonBody(c, BulkPostInputSchema);
    const now = deps.now();
    if (isTooFarAhead(input.date, now)) {
      return c.json<ValidationError>({ error: 'invalid_input', issues: [{ path: 'date', message: 'Date is more than a year ahead' }] }, 400);
    }
    const db = await deps.getDb();
    const household = c.get('household');
    const ids = input.items.map((i) => new ObjectId(i.id));
    const docs = await db.collection<FixedDoc>(FIXED).find({ _id: { $in: ids }, householdId: household._id, isRemoved: false }).toArray();
    if (docs.length !== ids.length) return c.json({ error: 'not_found' }, 404);
    const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));
    for (const d of docs) {
      const category = await findCategory(db, household._id, d.categoryId);
      if (!category || category.isRemoved) return c.json({ error: 'category_removed', id: d._id.toHexString() }, 409);
    }
    const me = c.get('user')._id;
    const cutoff = readCutoff(c.get('membership'));
    const out: BulkPostResponse = { transactions: [], alerts: [] };
    for (const item of input.items) {
      const { tx, alerts } = await postFixed(db, household, byId.get(item.id)!, {
        date: input.date,
        clientId: item.clientId,
        source: 'fixed-bulk',
        by: me,
        now,
        sendPush: deps.sendPush,
      });
      out.transactions.push(toTransaction(tx, me));
      out.alerts.push(...alerts.map((a) => toAlert(a, cutoff, null)));
    }
    return c.json<BulkPostResponse>(out, 201);
  });

  // --- Scheduler (Cloudflare Worker cron, docs/PLAN.md §1) ---

  /**
   * Checks the secret and works out the Manila date to run for: today, or an
   * optional { date } from the last 7 days (re-running a missed day). Returns
   * a Response to send instead when the call is refused.
   */
  async function cronDate(c: Context<AppEnv>): Promise<{ date: string; now: Date } | { res: Response }> {
    if (!deps.cronSecret) return { res: c.json({ error: 'cron_not_configured' }, 503) };
    if (!hasCronSecret(c.req.header('Authorization'), deps.cronSecret)) return { res: c.json({ error: 'unauthorized' }, 401) };
    const now = deps.now();
    const today = manilaDate(now);
    const body: unknown = await c.req.json().catch((): null => null);
    if (body && typeof body === 'object' && 'date' in body) {
      const d = (body as { date: unknown }).date;
      if (typeof d !== 'string' || !isValidIsoDate(d) || d > today || d < addDays(today, -7)) {
        return {
          res: c.json<ValidationError>({ error: 'invalid_input', issues: [{ path: 'date', message: 'Date must be within the last 7 days' }] }, 400),
        };
      }
      return { date: d, now };
    }
    return { date: today, now };
  }

  // 00:15 Manila: add the items due today.
  app.post('/internal/cron/fixed-postings', async (c): Promise<Response> => {
    const r = await cronDate(c);
    if ('res' in r) return r.res;
    return c.json(await autoPostDue(await deps.getDb(), r.date, r.now, deps.sendPush));
  });

  // 07:00 Manila: yesterday's spending for every household (docs/PLAN.md §6.11).
  app.post('/internal/cron/daily-digest', async (c): Promise<Response> => {
    const r = await cronDate(c);
    if ('res' in r) return r.res;
    return c.json(await sendDailySummaries(await deps.getDb(), r.date, r.now, deps.sendPush));
  });

  // 07:00 Manila: tell the household what was added automatically, and remind
  // the House Owner and Co-Owners about items due today that aren't.
  app.post('/internal/cron/fixed-notices', async (c): Promise<Response> => {
    const r = await cronDate(c);
    if ('res' in r) return r.res;
    return c.json(await sendFixedNotices(await deps.getDb(), r.date, r.now, deps.sendPush));
  });
}
