/** Device-only pin storage (docs/PLAN.md §6.8). */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAllPins, loadPins, pinKey, savePins } from '@/breakdown/pins';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('pins', () => {
  it('keyed per user and household', () => {
    expect(pinKey('user_1', 'h9')).toBe('pins:user_1:h9');
  });

  it('save then load round-trips; saving none removes the key', async () => {
    await savePins('pins:u:h', { a: '2026-11' });
    expect(await loadPins('pins:u:h')).toEqual({ a: '2026-11' });
    await savePins('pins:u:h', {});
    expect(await AsyncStorage.getItem('pins:u:h')).toBeNull();
    expect(await loadPins('pins:u:h')).toEqual({});
  });

  it('bad stored data reads as no pins (never crashes the screen)', async () => {
    for (const bad of ['not json', '[1,2]', 'null', '{"a":5,"b":"2026-11"}']) {
      await AsyncStorage.setItem('k', bad);
      expect(await loadPins('k')).toEqual(bad.startsWith('{') ? { b: '2026-11' } : {});
    }
  });

  it('storage failures are swallowed', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('full'));
    jest.spyOn(AsyncStorage, 'getAllKeys').mockRejectedValueOnce(new Error('disk'));
    expect(await loadPins('k')).toEqual({});
    await expect(savePins('k', { a: '2026-11' })).resolves.toBeUndefined();
    await expect(clearAllPins()).resolves.toBeUndefined();
  });

  it('clearAllPins removes only pin keys', async () => {
    await AsyncStorage.multiSet([['pins:a:b', '{}'], ['keep', '1']]);
    await clearAllPins();
    expect(await AsyncStorage.getAllKeys()).toEqual(['keep']);
  });
});
