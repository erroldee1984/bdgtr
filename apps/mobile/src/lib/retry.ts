import { ApiError } from './api-error';

export interface RetryOptions {
  /** Delays between attempts in ms; attempts = delays.length + 1. */
  delaysMs?: number[];
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Network-level failures (no response at all: offline, DNS not ready, timeout)
 * are worth retrying. An HTTP answer from the server (ApiError: 401, 500, …) is
 * not; retrying wouldn't change it and would hide the real error.
 */
export function isRetryableNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError) && !(err instanceof SyntaxError) && !isZodError(err);
}

function isZodError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ZodError';
}

/** Runs `fn`, retrying network failures with backoff (default ~1s, 2s, 4s). */
export async function withNetworkRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? [1000, 2000, 4000];
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = delays[attempt];
      if (delay === undefined || !isRetryableNetworkError(err)) throw err;
      await sleep(delay);
    }
  }
}
