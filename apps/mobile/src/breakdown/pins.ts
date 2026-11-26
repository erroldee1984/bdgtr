import type { PinMap } from '@bdgtr/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Pinned spends, kept on this device only (docs/PLAN.md §6.8): AsyncStorage on
 * Android, localStorage on the web (AsyncStorage uses it there). The API never
 * sees pins. Stored per user and household as { transactionId: "YYYY-MM" }.
 * Failures are non-critical: a pin that can't be read or saved is just unpinned.
 */
const PREFIX = 'pins:';

export function pinKey(userId: string, householdId: string): string {
  return `${PREFIX}${userId}:${householdId}`;
}

export async function loadPins(key: string): Promise<PinMap> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

export async function savePins(key: string, pins: PinMap): Promise<void> {
  try {
    if (Object.keys(pins).length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(pins));
  } catch {
    /* non-critical */
  }
}

/** On sign-out: forget every pin on this device, so a shared computer keeps none. */
export async function clearAllPins(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    /* non-critical */
  }
}
