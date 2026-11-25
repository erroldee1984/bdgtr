import { useAuth } from '@clerk/expo';
import {
  type CreateHouseholdInput,
  type Household,
  HouseholdResponseSchema,
  MeResponseSchema,
  type MeResponse,
  type UpdateHouseholdInput,
} from '@bdgtr/shared';
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
  if (res.status === 204) return null;
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

/** Options for calls scoped to one household (sent as X-Household-Id). */
function inHousehold(householdId: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Household-Id': householdId } };
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function createHousehold(getToken: GetToken, input: CreateHouseholdInput): Promise<Household> {
  return HouseholdResponseSchema.parse(await apiFetch('/households', getToken, json('POST', input))).household;
}

export async function fetchHousehold(getToken: GetToken, householdId: string): Promise<Household> {
  return HouseholdResponseSchema.parse(await apiFetch('/household', getToken, inHousehold(householdId))).household;
}

export async function updateHousehold(
  getToken: GetToken,
  householdId: string,
  input: UpdateHouseholdInput,
): Promise<Household> {
  return HouseholdResponseSchema.parse(
    await apiFetch('/household', getToken, inHousehold(householdId, json('PATCH', input))),
  ).household;
}

export async function deleteHousehold(getToken: GetToken, householdId: string): Promise<void> {
  await apiFetch('/household', getToken, inHousehold(householdId, { method: 'DELETE' }));
}
