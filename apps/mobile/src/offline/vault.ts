import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { fromUtf8, toUtf8 } from './utf8';

/**
 * Offline data on the device (docs/PLAN.md §15), Android app only: the
 * website never stores spending data (owner's decision).
 *
 * Values are JSON, encrypted with XChaCha20-Poly1305 (@noble/ciphers, pure
 * JavaScript, so no extra native module) under a random 256-bit key kept in
 * the Android Keystore through expo-secure-store. AsyncStorage only ever holds
 * ciphertext. Anything that can't be decrypted or read reads as missing.
 */
export const OFFLINE_SUPPORTED = Platform.OS !== 'web';

const KEY_NAME = 'bdgtr.offlineKey';
const PREFIX = 'offline:';
let keyPromise: Promise<Uint8Array> | null = null;

async function key(): Promise<Uint8Array> {
  keyPromise ??= (async () => {
    const stored = await SecureStore.getItemAsync(KEY_NAME);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return hexToBytes(stored);
    const fresh = Crypto.getRandomBytes(32);
    await SecureStore.setItemAsync(KEY_NAME, bytesToHex(fresh));
    return fresh;
  })().catch((err: unknown) => {
    keyPromise = null; // try again next time
    throw err;
  });
  return keyPromise;
}

/** Encrypts `value` (as JSON): hex(24-byte nonce ‖ ciphertext+tag). */
export async function seal(value: unknown): Promise<string> {
  const nonce = Crypto.getRandomBytes(24);
  const box = xchacha20poly1305(await key(), nonce).encrypt(toUtf8(JSON.stringify(value)));
  return bytesToHex(nonce) + bytesToHex(box);
}

/** Decrypts what `seal` made; null if it was tampered with, from another key, or not ours. */
export async function open(sealed: string): Promise<unknown> {
  try {
    if (!/^[0-9a-f]+$/.test(sealed) || sealed.length < 48 + 32) return null;
    const bytes = hexToBytes(sealed);
    const plain = xchacha20poly1305(await key(), bytes.slice(0, 24)).decrypt(bytes.slice(24));
    return JSON.parse(fromUtf8(plain));
  } catch {
    return null;
  }
}

export async function vaultGet(name: string): Promise<unknown> {
  if (!OFFLINE_SUPPORTED) return null;
  try {
    const raw = await AsyncStorage.getItem(PREFIX + name);
    return raw === null ? null : await open(raw);
  } catch {
    return null;
  }
}

/** Saves `value`; false if it couldn't be (offline data is a convenience, never critical). */
export async function vaultSet(name: string, value: unknown): Promise<boolean> {
  if (!OFFLINE_SUPPORTED) return false;
  try {
    await AsyncStorage.setItem(PREFIX + name, await seal(value));
    return true;
  } catch {
    return false;
  }
}

export async function vaultRemove(name: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + name);
  } catch {
    /* non-critical */
  }
}

/** On sign-out: every offline entry and cached screen on this device. */
export async function vaultClear(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    /* non-critical */
  }
}
