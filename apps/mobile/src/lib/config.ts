/**
 * Public, non-secret configuration baked into the app at build time.
 * EXPO_PUBLIC_* values are visible to anyone who has the app, so NEVER put
 * secrets here (docs/PLAN.md §10). Must be read with dot notation so Expo can inline it.
 */
const DEFAULT_API_URL = 'http://localhost:8787';

export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');
