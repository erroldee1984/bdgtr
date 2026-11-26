/** "Fetch, or the last copy when offline" (docs/PLAN.md §15). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { cacheName, fetchWithCache } from '@/offline/cached';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('crypto').randomBytes(n)) }));

const schema = z.array(z.object({ id: z.string() }));
const name = cacheName('user_a', 'h1', 'categories');
const at = () => new Date('2026-11-27T00:42:00.000Z');
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => AsyncStorage.clear());

describe('fetchWithCache', () => {
  it('online: fresh data, and a copy is kept', async () => {
    expect(await fetchWithCache(name, async () => [{ id: 'a' }], schema, at)).toEqual({ data: [{ id: 'a' }], cachedAt: null });
    await flush();
    expect(await fetchWithCache(name, async () => Promise.reject(new TypeError('Network request failed')), schema)).toEqual({
      data: [{ id: 'a' }],
      cachedAt: '2026-11-27T00:42:00.000Z',
    });
  });

  it('offline with no copy yet: the network error comes through', async () => {
    await expect(fetchWithCache(name, async () => Promise.reject(new TypeError('offline')), schema)).rejects.toThrow('offline');
  });

  it('a server answer (e.g. 403) is never hidden behind an old copy', async () => {
    await fetchWithCache(name, async () => [{ id: 'a' }], schema, at);
    await flush();
    await expect(fetchWithCache(name, async () => Promise.reject(new ApiError(403, 'forbidden')), schema)).rejects.toBeInstanceOf(ApiError);
  });

  it('a copy that no longer matches the shape is ignored', async () => {
    await fetchWithCache(name, async () => [{ wrong: 1 }] as never, schema, at);
    await flush();
    await expect(fetchWithCache(name, async () => Promise.reject(new TypeError('offline')), schema)).rejects.toThrow('offline');
  });

  it('no name (signed out): nothing kept', async () => {
    await fetchWithCache(null, async () => [{ id: 'a' }], schema);
    await flush();
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('offline:'))).toEqual([]);
  });

  it('names are per person and household', () => {
    expect(cacheName('u', 'h', 'categories')).toBe('cache:u:h:categories');
  });
});
