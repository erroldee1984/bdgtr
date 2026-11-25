/**
 * Household roles and what each may do: the single source of truth for the
 * permission matrix in docs/PLAN.md §3. The API enforces these on every
 * request; the app only uses them to hide controls a role can't use.
 */

export const ROLES = ['owner', 'co_owner', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'House Owner',
  co_owner: 'Co-Owner',
  member: 'House Member',
};

export type Capability =
  /** See dashboard, budgets, categories, fixed transactions, alerts, members. */
  | 'view'
  /** Enter a spend. */
  | 'enter_transaction'
  /** Edit or delete a transaction someone else entered (own ones are always allowed). */
  | 'edit_any_transaction'
  /** Categories, fixed transactions, monthly and category budgets, bulk-posting. */
  | 'manage_budget_data'
  /** Rename the household, change its default monthly budget. */
  | 'manage_household'
  /** Send, re-share or revoke invites; change roles between Co-Owner and House Member; remove non-owners. */
  | 'manage_members'
  /** Hand the House Owner role to someone else. */
  | 'transfer_ownership'
  /** Delete the whole household. */
  | 'delete_household';

const MATRIX: Record<Capability, readonly Role[]> = {
  view: ['owner', 'co_owner', 'member'],
  enter_transaction: ['owner', 'co_owner', 'member'],
  edit_any_transaction: ['owner', 'co_owner'],
  manage_budget_data: ['owner', 'co_owner'],
  manage_household: ['owner', 'co_owner'],
  manage_members: ['owner', 'co_owner'],
  transfer_ownership: ['owner'],
  delete_household: ['owner'],
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Whether `actor` may change or remove the member `target`.
 * - Nobody may change or remove the House Owner (only the Owner, by transferring).
 * - Owners and Co-Owners may manage Co-Owners and House Members.
 * - Anyone may act on themselves only by leaving (handled separately).
 */
export function canManageMember(actor: Role, target: Role): boolean {
  if (target === 'owner') return false;
  return can(actor, 'manage_members');
}
