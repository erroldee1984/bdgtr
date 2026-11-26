/** The encrypted offline store (docs/PLAN.md §15). */
/* eslint-disable @typescript-eslint/no-require-imports -- the vault is re-required after jest.resetModules() so each test reads its key afresh */
import { fromUtf8, toUtf8 } from '@/offline/utf8';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('crypto').randomBytes(n)) }));

// Imported after the mocks; reset between tests so the key is re-read.
let vault: typeof import('@/offline/vault');
let AsyncStorage: typeof import('@react-native-async-storage/async-storage').default;
beforeEach(async () => {
  jest.resetModules();
  mockSecure.clear();
  const mod = require('@react-native-async-storage/async-storage');
  AsyncStorage = mod.default ?? mod;
  await AsyncStorage.clear();
  vault = require('@/offline/vault');
});
afterEach(() => jest.restoreAllMocks());

describe('utf8', () => {
  it.each(['plain', '₱1,500.00', 'Ñanay at kapatid', 'emoji 🍚🧾', ''])('round-trips %p', (s) => {
    expect(fromUtf8(toUtf8(s))).toBe(s);
  });
  it('matches the standard encoding', () => {
    expect(Array.from(toUtf8('₱'))).toEqual([0xe2, 0x82, 0xb1]);
  });
});

describe('seal / open', () => {
  it('round-trips JSON; the stored text shows nothing readable', async () => {
    const value = { amount: 150000, note: 'Rent for Ñanay' };
    const sealed = await vault.seal(value);
    expect(sealed).toMatch(/^[0-9a-f]+$/);
    expect(sealed).not.toContain('Rent');
    expect(await vault.open(sealed)).toEqual(value);
  });

  it('a fresh nonce each time: the same value never looks the same', async () => {
    expect(await vault.seal({ a: 1 })).not.toBe(await vault.seal({ a: 1 }));
  });

  it('tampered, truncated or foreign data reads as nothing', async () => {
    const sealed = await vault.seal({ a: 1 });
    const flipped = sealed.slice(0, -2) + (sealed.endsWith('0') ? '1' : '0');
    expect(await vault.open(flipped)).toBeNull();
    expect(await vault.open(sealed.slice(0, 40))).toBeNull();
    expect(await vault.open('not hex')).toBeNull();
  });

  it('the key lives in secure storage; another key can’t open it', async () => {
    const sealed = await vault.seal({ a: 1 });
    expect(mockSecure.get('bdgtr.offlineKey')).toMatch(/^[0-9a-f]{64}$/);
    mockSecure.set('bdgtr.offlineKey', 'ab'.repeat(32));
    jest.resetModules();
    const other: typeof import('@/offline/vault') = require('@/offline/vault');
    expect(await other.open(sealed)).toBeNull();
  });
});

describe('vault storage', () => {
  it('set / get / remove; AsyncStorage only holds ciphertext under offline:', async () => {
    await vault.vaultSet('x', { secret: 'Tuition' });
    const raw = await AsyncStorage.getItem('offline:x');
    expect(raw).not.toContain('Tuition');
    expect(await vault.vaultGet('x')).toEqual({ secret: 'Tuition' });
    await vault.vaultRemove('x');
    expect(await vault.vaultGet('x')).toBeNull();
  });

  it('vaultClear removes only offline entries (sign-out)', async () => {
    await vault.vaultSet('a', 1);
    await AsyncStorage.setItem('other', 'keep');
    await vault.vaultClear();
    expect(await AsyncStorage.getAllKeys()).toEqual(['other']);
  });

  it('storage failures never throw (offline copies are a convenience)', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('full'));
    expect(await vault.vaultSet('a', 1)).toBe(false);
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await vault.vaultGet('a')).toBeNull();
  });
});
