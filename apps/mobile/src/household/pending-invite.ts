import { INVITE_TOKEN_PATTERN } from '@bdgtr/shared';

import { getItem, removeItem, setItem } from '@/lib/storage';

/**
 * An invite link opened while signed out is remembered on this device during
 * sign-in (web sign-in leaves the page, so the URL alone would be lost), then
 * the app returns to it. Only a well-formed token is ever stored or returned.
 */
const KEY = 'bdgtr.pendingInvite';

export async function rememberPendingInvite(token: string): Promise<void> {
  if (INVITE_TOKEN_PATTERN.test(token)) await setItem(KEY, token);
}

export async function readPendingInvite(): Promise<string | null> {
  const token = await getItem(KEY);
  return token && INVITE_TOKEN_PATTERN.test(token) ? token : null;
}

export async function clearPendingInvite(): Promise<void> {
  await removeItem(KEY);
}
