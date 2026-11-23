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
