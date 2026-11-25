import type { ValidationError } from '@bdgtr/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

/**
 * Reads the JSON body and validates it with a (strict) shared schema, returning
 * the parsed data. On bad input it throws an HTTPException carrying the 400
 * response, which the app's error handler returns as-is.
 *
 * Throwing (instead of returning an { ok } union) keeps callers type-safe even
 * when the code is compiled without strictNullChecks, as Vercel's build does.
 * Errors list field paths and messages only, never the submitted values.
 */
export async function parseJsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { res: c.json({ error: 'invalid_json' }, 400) });
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message }));
    throw new HTTPException(400, { res: c.json<ValidationError>({ error: 'invalid_input', issues }, 400) });
  }
  return result.data;
}
