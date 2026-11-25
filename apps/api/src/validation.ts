import type { ValidationError } from '@bdgtr/shared';
import type { Context } from 'hono';
import type { z } from 'zod';

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Reads the JSON body and validates it with a (strict) shared schema.
 * Errors list field paths and messages only, never the submitted values.
 */
export async function parseJsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<Parsed<z.infer<S>>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: 'invalid_json' }, 400) };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message }));
    return { ok: false, response: c.json<ValidationError>({ error: 'invalid_input', issues }, 400) };
  }
  return { ok: true, data: result.data };
}
