import { ApiError } from '@/lib/api-error';

/** Why accepting failed, in plain words, and whether trying again could help. */
export function acceptErrorMessage(err: unknown): { text: string; final: boolean } {
  if (!(err instanceof ApiError)) return { text: "Couldn't reach the server. Check your connection and try again.", final: false };
  switch (err.code) {
    case 'email_mismatch':
      return {
        text: 'This invite was sent to a different email address. Sign in with that email, or ask for a new invite.',
        final: true,
      };
    case 'invite_expired':
    case 'invite_used':
      return { text: 'This invite has expired or was already used. Ask for a new one.', final: true };
    case 'not_found':
    case 'invalid_input':
      return { text: "This invite link isn't valid. Check it was copied completely, or ask for a new one.", final: true };
    case 'already_member':
      return { text: "You're already a member of this household.", final: true };
    case 'household_limit':
      return { text: "You've reached the maximum number of households. Leave one to join this one.", final: true };
    case 'too_many_attempts':
      return { text: 'Too many attempts. Try again in 15 minutes.', final: true };
    default:
      return { text: "Couldn't accept the invite. Try again.", final: false };
  }
}
