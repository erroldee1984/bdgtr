import { useAuth } from '@clerk/expo';
import {
  type Device,
  DeviceResponseSchema,
  DevicesResponseSchema,
  type MembershipSettings,
  MembershipSettingsSchema,
  type MonthBudgets,
  MonthBudgetsSchema,
  type RegisterDeviceInput,
  type UpdateMembershipSettings,
  VapidKeyResponseSchema,
  type AlertsResponse,
  AlertsResponseSchema,
  type CreateTransactionResponse,
  CreateTransactionResponseSchema,
  type Category,
  CategoriesResponseSchema,
  CategoryResponseSchema,
  type CreateCategoryInput,
  type CreateTransactionInput,
  type Transaction,
  TransactionsResponseSchema,
  type Dashboard,
  DashboardSchema,
  type UpdateCategoryInput,
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

// --- Categories, transactions, dashboard (docs/PLAN.md §6.2–6.4) ---

export async function fetchCategories(getToken: GetToken, householdId: string): Promise<Category[]> {
  return CategoriesResponseSchema.parse(await apiFetch('/categories', getToken, inHousehold(householdId))).categories;
}

export async function createCategory(getToken: GetToken, householdId: string, input: CreateCategoryInput): Promise<Category> {
  return CategoryResponseSchema.parse(await apiFetch('/categories', getToken, inHousehold(householdId, json('POST', input)))).category;
}

export async function updateCategory(
  getToken: GetToken,
  householdId: string,
  id: string,
  input: UpdateCategoryInput,
): Promise<Category> {
  return CategoryResponseSchema.parse(
    await apiFetch(`/categories/${encodeURIComponent(id)}`, getToken, inHousehold(householdId, json('PATCH', input))),
  ).category;
}

/** Soft remove: past spending keeps the category. */
export async function removeCategory(getToken: GetToken, householdId: string, id: string): Promise<void> {
  await apiFetch(`/categories/${encodeURIComponent(id)}`, getToken, inHousehold(householdId, { method: 'DELETE' }));
}

export async function restoreCategory(getToken: GetToken, householdId: string, id: string): Promise<void> {
  await apiFetch(`/categories/${encodeURIComponent(id)}/restore`, getToken, inHousehold(householdId, { method: 'POST' }));
}

/** Saves a spend. Sending the same clientId again returns the original (safe to retry). */
export async function createTransaction(
  getToken: GetToken,
  householdId: string,
  input: CreateTransactionInput,
): Promise<CreateTransactionResponse> {
  return CreateTransactionResponseSchema.parse(
    await apiFetch('/transactions', getToken, inHousehold(householdId, json('POST', input))),
  );
}

/** Every spend in a month, unfiltered: the app filters, sorts and pins (docs/PLAN.md §6.8). */
export async function fetchTransactions(getToken: GetToken, householdId: string, month: string): Promise<Transaction[]> {
  return TransactionsResponseSchema.parse(
    await apiFetch(`/transactions?month=${encodeURIComponent(month)}`, getToken, inHousehold(householdId)),
  ).transactions;
}

/** Deletes a spend. House Members get 403 for one they didn't enter. */
export async function deleteTransaction(getToken: GetToken, householdId: string, id: string): Promise<void> {
  await apiFetch(`/transactions/${encodeURIComponent(id)}`, getToken, inHousehold(householdId, { method: 'DELETE' }));
}

/** A month's alerts (default: this month) plus the unread count across all months. */
export async function fetchAlerts(getToken: GetToken, householdId: string, month?: string): Promise<AlertsResponse> {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return AlertsResponseSchema.parse(await apiFetch(`/alerts${query}`, getToken, inHousehold(householdId)));
}

/** Marks this household's alerts read for the signed-in member. */
export async function markAlertsRead(getToken: GetToken, householdId: string): Promise<void> {
  await apiFetch('/alerts/read', getToken, inHousehold(householdId, { method: 'POST' }));
}

export async function fetchDashboard(getToken: GetToken, householdId: string, month?: string): Promise<Dashboard> {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return DashboardSchema.parse(await apiFetch(`/dashboard${query}`, getToken, inHousehold(householdId)));
}

// --- Notifications: devices and per-household settings (docs/PLAN.md §2b) ---

/** The Web Push public key (no sign-in needed). Null when the server has push turned off. */
export async function fetchVapidKey(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchImpl(`${API_URL}/push/vapid-public-key`);
  if (res.status === 503) return null;
  if (!res.ok) throw new ApiError(res.status, 'request_failed');
  return VapidKeyResponseSchema.parse(await res.json()).publicKey;
}

export async function registerDevice(getToken: GetToken, input: RegisterDeviceInput): Promise<Device> {
  return DeviceResponseSchema.parse(await apiFetch('/push-subscriptions', getToken, json('POST', input))).device;
}

/** Forget this browser (sign-out, "turn off here"). */
export async function unregisterDevice(getToken: GetToken, endpoint: string): Promise<void> {
  await apiFetch('/push-subscriptions/unregister', getToken, json('POST', { endpoint }));
}

export async function fetchDevices(getToken: GetToken): Promise<Device[]> {
  return DevicesResponseSchema.parse(await apiFetch('/push-subscriptions', getToken)).devices;
}

export async function removeDevice(getToken: GetToken, id: string): Promise<void> {
  await apiFetch(`/push-subscriptions/${encodeURIComponent(id)}`, getToken, { method: 'DELETE' });
}

export async function fetchMembershipSettings(getToken: GetToken, householdId: string): Promise<MembershipSettings> {
  return MembershipSettingsSchema.parse(await apiFetch('/membership/me', getToken, inHousehold(householdId)));
}

export async function updateMembershipSettings(
  getToken: GetToken,
  householdId: string,
  input: UpdateMembershipSettings,
): Promise<MembershipSettings> {
  return MembershipSettingsSchema.parse(await apiFetch('/membership/me', getToken, inHousehold(householdId, json('PATCH', input))));
}

// --- Budgets for a month (docs/PLAN.md §6.6, §6.7). Each change answers with the month's budgets. ---

export async function fetchBudgets(getToken: GetToken, householdId: string, month: string): Promise<MonthBudgets> {
  return MonthBudgetsSchema.parse(await apiFetch(`/budgets?month=${encodeURIComponent(month)}`, getToken, inHousehold(householdId)));
}

export async function setMonthlyBudget(getToken: GetToken, householdId: string, month: string, budgetMinor: number): Promise<MonthBudgets> {
  return MonthBudgetsSchema.parse(
    await apiFetch(`/budgets/monthly/${encodeURIComponent(month)}`, getToken, inHousehold(householdId, json('PUT', { budgetMinor }))),
  );
}

/** "Reset to default" for the month's total. */
export async function resetMonthlyBudget(getToken: GetToken, householdId: string, month: string): Promise<MonthBudgets> {
  return MonthBudgetsSchema.parse(await apiFetch(`/budgets/monthly/${encodeURIComponent(month)}`, getToken, inHousehold(householdId, { method: 'DELETE' })));
}

export async function setCategoryMonthBudget(
  getToken: GetToken,
  householdId: string,
  month: string,
  categoryId: string,
  budgetMinor: number,
): Promise<MonthBudgets> {
  return MonthBudgetsSchema.parse(
    await apiFetch(
      `/budgets/categories/${encodeURIComponent(month)}/${encodeURIComponent(categoryId)}`,
      getToken,
      inHousehold(householdId, json('PUT', { budgetMinor })),
    ),
  );
}

/** "Reset to default" for one category this month. */
export async function resetCategoryMonthBudget(getToken: GetToken, householdId: string, month: string, categoryId: string): Promise<MonthBudgets> {
  return MonthBudgetsSchema.parse(
    await apiFetch(
      `/budgets/categories/${encodeURIComponent(month)}/${encodeURIComponent(categoryId)}`,
      getToken,
      inHousehold(householdId, { method: 'DELETE' }),
    ),
  );
}
