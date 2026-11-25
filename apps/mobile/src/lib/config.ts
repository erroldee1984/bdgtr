import { Platform } from 'react-native';

/**
 * Public, non-secret configuration baked into the app at build time.
 * EXPO_PUBLIC_* values are visible to anyone who has the app, so NEVER put
 * secrets here (docs/PLAN.md §10). Must be read with dot notation so Expo can inline it.
 */

export const LOCAL_API_URL = 'http://localhost:8787';
export const PRODUCTION_API_URL = 'https://bdgtr-api.erroldee.com';

/**
 * Which API the app talks to when EXPO_PUBLIC_API_URL isn't set (local development):
 * - web (`pnpm dev:web`): the local API. The production API only allows the real
 *   website origin, so a browser on localhost must use the local one.
 * - Android (Expo Go via `pnpm dev:phone`): the production API. A phone can't reach
 *   the API running inside WSL, and native requests aren't subject to CORS.
 * Real builds always set EXPO_PUBLIC_API_URL (Cloudflare Pages env, eas.json).
 */
export function resolveApiUrl(envValue: string | undefined, platform: string): string {
  const fallback = platform === 'web' ? LOCAL_API_URL : PRODUCTION_API_URL;
  const value = envValue?.trim() || fallback;
  return value.replace(/\/+$/, '');
}

export const API_URL: string = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, Platform.OS);

export const PRODUCTION_WEB_URL = 'https://bdgtr.erroldee.com';

/**
 * Website address used in invite links. On the web it's wherever the app is
 * running (so local testing makes local links); on Android it's the real
 * website, which opens the app through App Links. EXPO_PUBLIC_WEB_URL overrides.
 */
export function resolveWebUrl(envValue: string | undefined, platform: string, browserOrigin: string | undefined): string {
  const value = envValue?.trim() || (platform === 'web' && browserOrigin ? browserOrigin : PRODUCTION_WEB_URL);
  return value.replace(/\/+$/, '');
}

export function webUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
  return resolveWebUrl(process.env.EXPO_PUBLIC_WEB_URL, Platform.OS, origin);
}

/**
 * Clerk publishable key. PUBLIC by design (it's in every copy of the app).
 * - Development (`pnpm dev:web`, `pnpm dev:phone`): the Clerk *development*
 *   instance key below, so test sign-ins never touch production users.
 * - Real builds set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to the production key
 *   (Cloudflare Pages env, eas.json).
 */
// Development instance: wise-swift-3855.clerk.accounts.dev
export const DEV_CLERK_PUBLISHABLE_KEY = 'pk_test_d2lzZS1zd2lmdC0zODU1LmNsZXJrLmFjY291bnRzLmRldiQ';

export function resolveClerkKey(envValue: string | undefined, isDev: boolean): string | null {
  const value = envValue?.trim() || (isDev ? DEV_CLERK_PUBLISHABLE_KEY : '');
  return /^pk_(test|live)_[A-Za-z0-9+/=_-]+$/.test(value) ? value : null;
}

export const CLERK_PUBLISHABLE_KEY: string | null = resolveClerkKey(
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  __DEV__,
);
