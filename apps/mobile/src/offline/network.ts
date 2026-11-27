import { OFFLINE_SUPPORTED } from './vault';

/**
 * Whether the phone says it has no connection (NetInfo, Android app only).
 * Set by the OutboxProvider. While it's true, API calls fail at once with a
 * network error instead of waiting (e.g. on Clerk retrying for a token), so
 * screens show their saved copies straight away.
 */
let deviceOffline = false;

export function setDeviceOffline(offline: boolean): void {
  deviceOffline = OFFLINE_SUPPORTED && offline;
}

export function isDeviceOffline(): boolean {
  return deviceOffline;
}

/** Thrown instead of making a request the phone can't send: a network-type error. */
export class OfflineError extends TypeError {
  override name = 'OfflineError';
  constructor() {
    super('No connection');
  }
}

/** Longest wait for Clerk's sign-in token: offline it can retry for minutes. */
export const TOKEN_TIMEOUT_MS = 8_000;

/** `getToken()` with a time limit; past it, a network-type error (so offline paths take over). */
export async function tokenWithin<T>(get: () => Promise<T>, ms = TOKEN_TIMEOUT_MS): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      get(),
      new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(new OfflineError()), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}
