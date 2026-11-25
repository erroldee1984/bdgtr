import { useAuth } from '@clerk/expo';
import {
  type AcceptInviteResponse,
  AcceptInviteResponseSchema,
  type AssignableRole,
  type CreatedInviteResponse,
  CreatedInviteResponseSchema,
  type CreateInviteInput,
  type Invite,
  InvitesResponseSchema,
  type Member,
  MembersResponseSchema,
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

// --- Members & invites (docs/PLAN.md §3) ---

export async function fetchMembers(getToken: GetToken, householdId: string): Promise<Member[]> {
  return MembersResponseSchema.parse(await apiFetch('/members', getToken, inHousehold(householdId))).members;
}

export async function changeMemberRole(
  getToken: GetToken,
  householdId: string,
  userId: string,
  role: AssignableRole,
): Promise<void> {
  await apiFetch(`/members/${encodeURIComponent(userId)}`, getToken, inHousehold(householdId, json('PATCH', { role })));
}

/** Removes someone, or leaves the household when `userId` is yourself. */
export async function removeMember(getToken: GetToken, householdId: string, userId: string): Promise<void> {
  await apiFetch(`/members/${encodeURIComponent(userId)}`, getToken, inHousehold(householdId, { method: 'DELETE' }));
}

export async function transferOwnership(getToken: GetToken, householdId: string, userId: string): Promise<void> {
  await apiFetch('/members/transfer-ownership', getToken, inHousehold(householdId, json('POST', { userId })));
}

export async function fetchInvites(getToken: GetToken, householdId: string): Promise<Invite[]> {
  return InvitesResponseSchema.parse(await apiFetch('/invites', getToken, inHousehold(householdId))).invites;
}

export async function createInvite(
  getToken: GetToken,
  householdId: string,
  input: CreateInviteInput,
): Promise<CreatedInviteResponse> {
  return CreatedInviteResponseSchema.parse(await apiFetch('/invites', getToken, inHousehold(householdId, json('POST', input))));
}

/** "Share again": a fresh link for a pending invite (the old link stops working). */
export async function reissueInvite(getToken: GetToken, householdId: string, inviteId: string): Promise<CreatedInviteResponse> {
  return CreatedInviteResponseSchema.parse(
    await apiFetch(`/invites/${encodeURIComponent(inviteId)}/reissue`, getToken, inHousehold(householdId, { method: 'POST' })),
  );
}

export async function revokeInvite(getToken: GetToken, householdId: string, inviteId: string): Promise<void> {
  await apiFetch(`/invites/${encodeURIComponent(inviteId)}`, getToken, inHousehold(householdId, { method: 'DELETE' }));
}

export async function acceptInvite(getToken: GetToken, token: string): Promise<AcceptInviteResponse> {
  return AcceptInviteResponseSchema.parse(await apiFetch('/invites/accept', getToken, json('POST', { token })));
}
