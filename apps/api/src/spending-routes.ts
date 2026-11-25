import {
  type AlertsResponse,
  type CreateTransactionResponse,
  buildDashboard,
  can,
  type CategoriesResponse,
  type CategoryResponse,
  CreateCategoryInputSchema,
  CreateTransactionInputSchema,
  type Dashboard,
  isTooFarAhead,
  manilaDate,
  MAX_CATEGORIES,
  type TransactionResponse,
  type TransactionsResponse,
  UpdateCategoryInputSchema,
  UpdateTransactionInputSchema,
  type ValidationError,
  YEAR_MONTH_PATTERN,
  yearMonthOf,
} from '@bdgtr/shared';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { type Db, ObjectId } from 'mongodb';

import {
  CATEGORIES,
  type CategoryDoc,
  countCategories,
  createCategory,
  ensureDefaultCategory,
  findCategory,
  listCategories,
  removeCategory,
  restoreCategory,
  toCategory,
  updateCategory,
} from './categories.js';
import { countUnread, listAlerts, markAlertsRead, readCutoff, recordCrossings, toAlert } from './alerts.js';
import { type AppVariables, requireHousehold } from './household-routes.js';
import {
  createTransaction,
  deleteTransaction,
  findTransaction,
  listTransactions,
  spentByCategory,
  TRANSACTIONS,
  type TransactionDoc,
  toTransaction,
  updateTransaction,
} from './transactions.js';
import { parseJsonBody } from './validation.js';

type AppEnv = { Variables: AppVariables };

interface Deps {
  getDb: () => Promise<Db>;
  now: () => Date;
}

function idParam(c: Context<AppEnv>, name: string): ObjectId | null {
  const raw = c.req.param(name) ?? '';
  return /^[0-9a-f]{24}$/.test(raw) ? new ObjectId(raw) : null;
}

/** ?month=YYYY-MM, defaulting to this month in Manila; null if malformed. */
function monthParam(c: Context<AppEnv>, now: Date): string | null {
  const raw = c.req.query('month');
  if (raw === undefined) return yearMonthOf(manilaDate(now));
  return YEAR_MONTH_PATTERN.test(raw) ? raw : null;
}

const badDate = (c: Context<AppEnv>) =>
  c.json<ValidationError>(
    { error: 'invalid_input', issues: [{ path: 'date', message: 'Date is more than a year ahead' }] },
    400,
  );

/**
 * Categories, transactions and the dashboard (docs/PLAN.md §5, §6.2–6.4).
 * - Everyone views; Owners/Co-Owners manage categories.
 * - Everyone enters spends; House Members edit/delete only their own (D1).
 */
export function registerSpendingRoutes(
  app: Hono<AppEnv>,
  auth: MiddlewareHandler<AppEnv>,
  loadUser: MiddlewareHandler<AppEnv>,
  deps: Deps,
) {
  const inHousehold = (capability: Parameters<typeof requireHousehold>[1]) =>
    [auth, loadUser, requireHousehold(deps, capability)] as const;

  // --- Categories ---

  app.get('/categories', ...inHousehold('view'), async (c) => {
    const db = await deps.getDb();
    await ensureDefaultCategory(db, c.get('household')._id, c.get('user')._id, deps.now());
    return c.json<CategoriesResponse>({ categories: await listCategories(db, c.get('household')._id, deps.now()) });
  });

  app.post('/categories', ...inHousehold('manage_budget_data'), async (c) => {
    const input = await parseJsonBody(c, CreateCategoryInputSchema);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    if ((await countCategories(db, householdId)) >= MAX_CATEGORIES) return c.json({ error: 'category_limit' }, 409);
    const doc = await createCategory(db, householdId, input, c.get('user')._id, deps.now());
    if (!doc) return c.json({ error: 'category_exists' }, 409);
    return c.json<CategoryResponse>({ category: toCategory(doc) }, 201);
  });

  app.patch('/categories/:id', ...inHousehold('manage_budget_data'), async (c) => {
    const id = idParam(c, 'id');
    const input = await parseJsonBody(c, UpdateCategoryInputSchema);
    if (!id) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    const { doc, error } = await updateCategory(db, c.get('household')._id, id, input, deps.now());
    if (error === 'category_exists') return c.json({ error }, 409);
    if (!doc) return c.json({ error: 'not_found' }, 404);
    return c.json<CategoryResponse>({ category: toCategory(doc) });
  });

  // Soft remove: past spending keeps showing the category. Never the last one.
  app.delete('/categories/:id', ...inHousehold('manage_budget_data'), async (c) => {
    const id = idParam(c, 'id');
    if (!id) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    const result = await removeCategory(db, c.get('household')._id, id, deps.now());
    if (result === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (result === 'last_category') return c.json({ error: 'last_category' }, 409);
    return c.body(null, 204);
  });

  app.post('/categories/:id/restore', ...inHousehold('manage_budget_data'), async (c) => {
    const id = idParam(c, 'id');
    if (!id) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    const result = await restoreCategory(db, c.get('household')._id, id, deps.now());
    if (result === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (result === 'category_exists') return c.json({ error: 'category_exists' }, 409);
    return c.body(null, 204);
  });

  // --- Transactions ---

  /** The category must be this household's and not removed. Null when fine. */
  async function categoryProblem(c: Context<AppEnv>, db: Db, categoryId: string) {
    const category = await findCategory(db, c.get('household')._id, new ObjectId(categoryId));
    if (!category) return c.json({ error: 'category_not_found' }, 404);
    if (category.isRemoved) return c.json({ error: 'category_removed' }, 409);
    return null;
  }

  app.get('/transactions', ...inHousehold('view'), async (c) => {
    const month = monthParam(c, deps.now());
    if (!month) return c.json({ error: 'invalid_month' }, 400);
    const db = await deps.getDb();
    const docs = await listTransactions(db, c.get('household')._id, month);
    const me = c.get('user')._id;
    return c.json<TransactionsResponse>({ transactions: docs.map((d) => toTransaction(d, me)) });
  });

  app.post('/transactions', ...inHousehold('enter_transaction'), async (c) => {
    const input = await parseJsonBody(c, CreateTransactionInputSchema);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    const me = c.get('user')._id;
    const now = deps.now();

    // A retry of a save that already went through: return the original, change nothing
    // (its alerts went out the first time).
    const existing = await db.collection<TransactionDoc>(TRANSACTIONS).findOne({ householdId, clientId: input.clientId });
    if (existing) return c.json<CreateTransactionResponse>({ transaction: toTransaction(existing, me), alerts: [] }, 200);

    if (isTooFarAhead(input.date, now)) return badDate(c);
    const problem = await categoryProblem(c, db, input.categoryId);
    if (problem) return problem;

    const { doc, created } = await createTransaction(db, householdId, input, me, now);
    if (!created) return c.json<CreateTransactionResponse>({ transaction: toTransaction(doc, me), alerts: [] }, 200);
    // Thresholds crossed by this spend (docs/PLAN.md §6.3). Pushing them to every
    // member's devices arrives in M2b-2/3; the person who entered it sees a toast now.
    const alerts = await recordCrossings(db, c.get('household'), doc, now);
    const cutoff = readCutoff(c.get('membership'));
    return c.json<CreateTransactionResponse>(
      { transaction: toTransaction(doc, me), alerts: alerts.map((a) => toAlert(a, cutoff, null)) },
      201,
    );
  });

  /** House Members may change only what they entered themselves (D1). */
  async function editable(
    c: Context<AppEnv>,
    db: Db,
    id: ObjectId | null,
  ): Promise<{ tx: TransactionDoc | null; res: Response | null }> {
    if (!id) return { tx: null, res: c.json({ error: 'not_found' }, 404) };
    const tx = await findTransaction(db, c.get('household')._id, id);
    if (!tx) return { tx: null, res: c.json({ error: 'not_found' }, 404) };
    const mine = tx.createdBy.equals(c.get('user')._id);
    if (!mine && !can(c.get('membership').role, 'edit_any_transaction')) {
      return { tx: null, res: c.json({ error: 'forbidden' }, 403) };
    }
    return { tx, res: null };
  }

  app.patch('/transactions/:id', ...inHousehold('enter_transaction'), async (c) => {
    const id = idParam(c, 'id');
    const input = await parseJsonBody(c, UpdateTransactionInputSchema);
    const db = await deps.getDb();
    const { tx, res } = await editable(c, db, id);
    if (res) return res;
    if (input.date !== undefined && isTooFarAhead(input.date, deps.now())) return badDate(c);
    if (input.categoryId !== undefined && input.categoryId !== tx!.categoryId.toHexString()) {
      const problem = await categoryProblem(c, db, input.categoryId);
      if (problem) return problem;
    }
    const updated = await updateTransaction(db, c.get('household')._id, tx!._id, input, deps.now());
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json<TransactionResponse>({ transaction: toTransaction(updated, c.get('user')._id) });
  });

  app.delete('/transactions/:id', ...inHousehold('enter_transaction'), async (c) => {
    const db = await deps.getDb();
    const { tx, res } = await editable(c, db, idParam(c, 'id'));
    if (res) return res;
    await deleteTransaction(db, c.get('household')._id, tx!._id);
    return c.body(null, 204);
  });

  // --- Alerts (docs/PLAN.md §6.10) ---

  app.get('/alerts', ...inHousehold('view'), async (c) => {
    const month = monthParam(c, deps.now());
    if (!month) return c.json({ error: 'invalid_month' }, 400);
    const db = await deps.getDb();
    const householdId = c.get('household')._id;
    const cutoff = readCutoff(c.get('membership'));
    const [alerts, unreadCount] = await Promise.all([listAlerts(db, householdId, month, cutoff), countUnread(db, householdId, cutoff)]);
    return c.json<AlertsResponse>({ alerts, unreadCount });
  });

  // Marks every alert in this household read, for the caller only.
  app.post('/alerts/read', ...inHousehold('view'), async (c) => {
    const db = await deps.getDb();
    await markAlertsRead(db, c.get('membership')._id, deps.now());
    return c.body(null, 204);
  });

  // --- Dashboard ---

  app.get('/dashboard', ...inHousehold('view'), async (c) => {
    const month = monthParam(c, deps.now());
    if (!month) return c.json({ error: 'invalid_month' }, 400);
    const db = await deps.getDb();
    const household = c.get('household');
    await ensureDefaultCategory(db, household._id, c.get('user')._id, deps.now());
    const [categories, spent] = await Promise.all([
      db.collection<CategoryDoc>(CATEGORIES).find({ householdId: household._id }).toArray(),
      spentByCategory(db, household._id, month),
    ]);
    // Monthly overrides arrive in M3; until then the defaults apply to every month.
    return c.json<Dashboard>(
      buildDashboard({
        month,
        totalBudgetMinor: household.defaultMonthlyBudgetMinor,
        categories: categories.map((d) => ({
          id: d._id.toHexString(),
          name: d.name,
          icon: d.icon,
          colour: d.colour,
          budgetMinor: d.defaultBudgetMinor,
          isRemoved: d.isRemoved,
        })),
        spentByCategory: spent,
      }),
    );
  });
}
