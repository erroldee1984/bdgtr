import { isBudgetMonth, manilaDate, type MonthBudgets, SetBudgetInputSchema, yearMonthOf } from '@bdgtr/shared';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { type Db, ObjectId } from 'mongodb';

import { monthBudgets, resetCategoryBudget, resetMonthlyBudget, setCategoryBudget, setMonthlyBudget } from './budgets.js';
import { type CategoryDoc, ensureDefaultCategory, findCategory, isUnbudgeted } from './categories.js';
import { type AppVariables, requireHousehold } from './household-routes.js';
import { parseJsonBody } from './validation.js';

type AppEnv = { Variables: AppVariables };

interface Deps {
  getDb: () => Promise<Db>;
  now: () => Date;
}

/**
 * Budgets for a month (docs/PLAN.md §5, §6.6, §6.7). Everyone views; Owners
 * and Co-Owners set or reset a month's values. Defaults are edited where they
 * already live: the household (PATCH /households/:id) and each category
 * (PATCH /categories/:id). Every change answers with the month's budgets.
 */
export function registerBudgetRoutes(app: Hono<AppEnv>, auth: MiddlewareHandler<AppEnv>, loadUser: MiddlewareHandler<AppEnv>, deps: Deps) {
  const inHousehold = (capability: Parameters<typeof requireHousehold>[1]) => [auth, loadUser, requireHousehold(deps, capability)] as const;

  const month = (c: Context<AppEnv>): string | null => {
    const raw = c.req.param('yearMonth') ?? c.req.query('month') ?? yearMonthOf(manilaDate(deps.now()));
    return isBudgetMonth(raw) ? raw : null;
  };
  const badMonth = (c: Context<AppEnv>) => c.json({ error: 'invalid_month' }, 400);
  const answer = async (c: Context<AppEnv>, db: Db, yearMonth: string) => c.json<MonthBudgets>(await monthBudgets(db, c.get('household'), yearMonth));

  /** This household's active category from :categoryId, or the error to send. */
  async function category(c: Context<AppEnv>, db: Db): Promise<{ doc: CategoryDoc | null; res: Response | null }> {
    const raw = c.req.param('categoryId') ?? '';
    if (!/^[0-9a-f]{24}$/.test(raw)) return { doc: null, res: c.json({ error: 'not_found' }, 404) };
    const doc = await findCategory(db, c.get('household')._id, new ObjectId(raw));
    if (!doc) return { doc: null, res: c.json({ error: 'not_found' }, 404) };
    if (doc.isRemoved) return { doc: null, res: c.json({ error: 'category_removed' }, 409) };
    // Unbudgeted's budget is automatic (the rest of the month's total): never set by hand.
    if (isUnbudgeted(doc)) return { doc: null, res: c.json({ error: 'automatic_budget' }, 409) };
    return { doc, res: null };
  }

  app.get('/budgets', ...inHousehold('view'), async (c) => {
    const ym = month(c);
    if (!ym) return badMonth(c);
    const db = await deps.getDb();
    await ensureDefaultCategory(db, c.get('household')._id, c.get('user')._id, deps.now());
    return answer(c, db, ym);
  });

  app.put('/budgets/monthly/:yearMonth', ...inHousehold('manage_budget_data'), async (c) => {
    const ym = month(c);
    const { budgetMinor } = await parseJsonBody(c, SetBudgetInputSchema);
    if (!ym) return badMonth(c);
    const db = await deps.getDb();
    await setMonthlyBudget(db, c.get('household'), ym, budgetMinor, c.get('user')._id, deps.now());
    return answer(c, db, ym);
  });

  app.delete('/budgets/monthly/:yearMonth', ...inHousehold('manage_budget_data'), async (c) => {
    const ym = month(c);
    if (!ym) return badMonth(c);
    const db = await deps.getDb();
    await resetMonthlyBudget(db, c.get('household')._id, ym);
    return answer(c, db, ym);
  });

  app.put('/budgets/categories/:yearMonth/:categoryId', ...inHousehold('manage_budget_data'), async (c) => {
    const ym = month(c);
    const { budgetMinor } = await parseJsonBody(c, SetBudgetInputSchema);
    if (!ym) return badMonth(c);
    const db = await deps.getDb();
    const { doc, res } = await category(c, db);
    if (res) return res;
    await setCategoryBudget(db, doc!, ym, budgetMinor, c.get('user')._id, deps.now());
    return answer(c, db, ym);
  });

  app.delete('/budgets/categories/:yearMonth/:categoryId', ...inHousehold('manage_budget_data'), async (c) => {
    const ym = month(c);
    if (!ym) return badMonth(c);
    const db = await deps.getDb();
    const { doc, res } = await category(c, db);
    if (res) return res;
    await resetCategoryBudget(db, c.get('household')._id, ym, doc!._id);
    return answer(c, db, ym);
  });
}
