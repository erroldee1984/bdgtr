import { HealthResponseSchema } from '@bdgtr/shared';

import { withNetworkRetry } from './retry';

export type ApiStatus = 'connected' | 'unreachable' | 'unexpected_response';

/**
 * Calls GET /health and checks the response shape. Never throws: the UI shows
 * a plain status rather than an error screen.
 */
/** Health check with automatic retries while the network or a new tunnel comes up. */
export async function checkApiHealthWithRetry(baseUrl: string): Promise<ApiStatus> {
  return withNetworkRetry(async () => {
    const status = await checkApiHealth(baseUrl);
    if (status === 'unreachable') throw new TypeError('unreachable'); // retryable
    return status;
  }).catch(() => 'unreachable' as const);
}

export async function checkApiHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<ApiStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal });
    if (!res.ok) return 'unexpected_response';
    const body: unknown = await res.json().catch(() => null);
    return HealthResponseSchema.safeParse(body).success ? 'connected' : 'unexpected_response';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}
