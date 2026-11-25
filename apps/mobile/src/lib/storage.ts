import * as SecureStore from 'expo-secure-store';

/**
 * Small device-local key/value storage (docs/PLAN.md §1 "Local Storage").
 * Android: expo-secure-store (already in the development build). Web: see
 * storage.web.ts. For small, non-critical values only (e.g. the active
 * household id); failures are swallowed and treated as "not stored".
 * Keys may only use [A-Za-z0-9._-] (a SecureStore requirement).
 */
export async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* non-critical */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* non-critical */
  }
}
