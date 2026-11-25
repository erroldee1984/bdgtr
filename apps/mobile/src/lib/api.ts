import { useAuth } from '@clerk/expo';
import { MeResponseSchema, type MeResponse } from '@bdgtr/shared';
import { useCallback } from 'react';

import { ApiError } from './api-error';
import { API_URL } from './config';
import { withNetworkRetry } from './retry';

export { ApiError };

type GetToken = () => Promise<string | null>;

/**
 * Calls the bdgtr API with the current Clerk session token. Clerk caches the
 * token (about 60 seconds) and refreshes it, so ask for it on every request
 * rather than storing it.
 */
export async function apiFetch(
  path: string,
  getToken: GetToken,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const token = await getToken();
  if (!token) throw new ApiError(401, 'not_signed_in');
  const res = await fetchImpl(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = typeof body === 'object' && body && 'error' in body ? String(body.error) : 'request_failed';
    throw new ApiError(res.status, code);
  }
  return body;
}

export async function fetchMe(getToken: GetToken, fetchImpl: typeof fetch = fetch): Promise<MeResponse> {
  return MeResponseSchema.parse(await apiFetch('/me', getToken, {}, fetchImpl));
}

/** Hook form: `const loadMe = useFetchMe(); await loadMe()`. Retries network failures. */
export function useFetchMe() {
  const { getToken } = useAuth();
  return useCallback(() => withNetworkRetry(() => fetchMe(() => getToken())), [getToken]);
}
