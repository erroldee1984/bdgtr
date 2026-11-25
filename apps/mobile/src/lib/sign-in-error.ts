/**
 * Message for a failed sign-in. When Clerk gives a reason code (e.g.
 * `resource_missmatch` for a return link the instance doesn't allow), it's
 * shown so a problem can be diagnosed from a screenshot of a release build.
 * Codes are short machine words, never personal data; anything else is dropped.
 */
export function signInErrorMessage(err: unknown): string {
  const code = clerkErrorCode(err);
  return code
    ? `Sign-in didn't complete. Try again; if it keeps happening, the reason is: ${code}`
    : "Sign-in didn't complete. Check your connection and try again.";
}

export function clerkErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { errors?: { code?: unknown }[]; code?: unknown };
  const raw = Array.isArray(e.errors) && e.errors.length > 0 ? e.errors[0]?.code : e.code;
  return typeof raw === 'string' && /^[a-z0-9_]{1,60}$/.test(raw) ? raw : null;
}
