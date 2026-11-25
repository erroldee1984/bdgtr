/**
 * Device storage (active household id). Android uses SecureStore, web uses
 * localStorage. Failures must never crash the app: treat as "not stored".
 */
import * as SecureStore from 'expo-secure-store';

// Two different files: Jest resolves '../storage' to storage.ts (native), while the
// lint resolver maps it to storage.web.ts and wrongly reports a duplicate import.
// eslint-disable-next-line import/no-duplicates
import * as native from '../storage';
// eslint-disable-next-line import/no-duplicates
import * as web from '../storage.web';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const secure = jest.mocked(SecureStore);

describe('storage (Android, SecureStore)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('reads, writes and removes through SecureStore', async () => {
    secure.getItemAsync.mockResolvedValue('h1');
    await expect(native.getItem('k')).resolves.toBe('h1');
    await native.setItem('k', 'h2');
    await native.removeItem('k');
    expect(secure.setItemAsync).toHaveBeenCalledWith('k', 'h2');
    expect(secure.deleteItemAsync).toHaveBeenCalledWith('k');
  });

  it('a missing value reads as null', async () => {
    secure.getItemAsync.mockResolvedValue(null);
    await expect(native.getItem('k')).resolves.toBeNull();
  });

  it('never throws when SecureStore fails (e.g. keystore unavailable)', async () => {
    secure.getItemAsync.mockRejectedValue(new Error('keystore'));
    secure.setItemAsync.mockRejectedValue(new Error('keystore'));
    secure.deleteItemAsync.mockRejectedValue(new Error('keystore'));
    await expect(native.getItem('k')).resolves.toBeNull();
    await expect(native.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(native.removeItem('k')).resolves.toBeUndefined();
  });
});

describe('storage (web, localStorage)', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const setLocalStorage = (value: unknown) =>
    Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('reads, writes and removes', async () => {
    const map = new Map<string, string>();
    setLocalStorage({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
    await web.setItem('k', 'h1');
    await expect(web.getItem('k')).resolves.toBe('h1');
    await web.removeItem('k');
    await expect(web.getItem('k')).resolves.toBeNull();
  });

  it('never throws when storage is blocked (private mode, storage full)', async () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    setLocalStorage({ getItem: boom, setItem: boom, removeItem: boom });
    await expect(web.getItem('k')).resolves.toBeNull();
    await expect(web.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(web.removeItem('k')).resolves.toBeUndefined();
  });

  it('works (as "not stored") when localStorage does not exist at all', async () => {
    setLocalStorage(undefined);
    await expect(web.getItem('k')).resolves.toBeNull();
    await expect(web.setItem('k', 'v')).resolves.toBeUndefined();
  });
});
