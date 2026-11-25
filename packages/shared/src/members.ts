import { z } from 'zod';

import { ROLES } from './roles.ts';

/**
 * Members and invites (docs/PLAN.md §3). The House Owner is never invited and
 * never assigned through a role change: only transferred.
 */

/** Roles that can be invited or set by a role change. */
export const ASSIGNABLE_ROLES = ['co_owner', 'member'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const INVITE_TTL_DAYS = 7;
/** Abuse guard: pending invites one household may have at once. */
export const MAX_PENDING_INVITES = 50;
/** Invite tokens: 32 random bytes as base64url (43 characters, no padding). */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');

const inviteEmail = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const CreateInviteInputSchema = z
  .object({
    email: inviteEmail,
    role: z.enum(ASSIGNABLE_ROLES, { error: 'Choose Co-Owner or House Member' }),
  })
  .strict();
export type CreateInviteInput = z.infer<typeof CreateInviteInputSchema>;

export const AcceptInviteInputSchema = z
  .object({ token: z.string().regex(INVITE_TOKEN_PATTERN, 'Invalid invite link') })
  .strict();
export type AcceptInviteInput = z.infer<typeof AcceptInviteInputSchema>;

export const ChangeRoleInputSchema = z
  .object({ role: z.enum(ASSIGNABLE_ROLES, { error: 'Choose Co-Owner or House Member' }) })
  .strict();
export type ChangeRoleInput = z.infer<typeof ChangeRoleInputSchema>;

export const TransferOwnershipInputSchema = z.object({ userId: objectId }).strict();
export type TransferOwnershipInput = z.infer<typeof TransferOwnershipInputSchema>;

export const MemberSchema = z.object({
  userId: objectId,
  /** Display name from the sign-in provider, if known. */
  name: z.string().nullable(),
  email: z.email().nullable(),
  role: z.enum(ROLES),
  joinedAt: z.iso.datetime(),
  /** True for the signed-in caller's own row. */
  isYou: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

export const MembersResponseSchema = z.object({ members: z.array(MemberSchema) });
export type MembersResponse = z.infer<typeof MembersResponseSchema>;

export const InviteSchema = z.object({
  id: objectId,
  email: z.email(),
  role: z.enum(ASSIGNABLE_ROLES),
  expiresAt: z.iso.datetime(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const InvitesResponseSchema = z.object({ invites: z.array(InviteSchema) });
export type InvitesResponse = z.infer<typeof InvitesResponseSchema>;

/** POST /invites and POST /invites/:id/reissue. The token is shown only here, once. */
export const CreatedInviteResponseSchema = z.object({
  invite: InviteSchema,
  token: z.string().regex(INVITE_TOKEN_PATTERN),
});
export type CreatedInviteResponse = z.infer<typeof CreatedInviteResponseSchema>;

export const AcceptInviteResponseSchema = z.object({
  householdId: objectId,
  householdName: z.string().min(1),
  role: z.enum(ROLES),
});
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;

/** The link people share: opens the app (Android App Links) or the website. */
export function inviteUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/+$/, '')}/invite/${token}`;
}

/**
 * Orders members for display: House Owner first, then Co-Owners, then House
 * Members, each by when they joined (docs/PLAN.md §3).
 */
export function sortMembers<T extends { role: (typeof ROLES)[number]; joinedAt: string }>(members: T[]): T[] {
  const rank = { owner: 0, co_owner: 1, member: 2 } as const;
  return [...members].sort((a, b) => rank[a.role] - rank[b.role] || a.joinedAt.localeCompare(b.joinedAt));
}
