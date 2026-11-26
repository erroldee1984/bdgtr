/* eslint-disable import/namespace -- ESLint resolves '../device-push' to the .web file; Jest (native) loads device-push.ts. */
/**
 * Phone notifications (Android, Expo push) for this device, with fake
 * expo-notifications / expo-device / secure storage.
 */
import { Platform } from 'react-native';

import * as push from '../device-push';

type Perm = { granted: boolean; canAskAgain: boolean };
type Response = { actionIdentifier: string; notification: { request: { identifier: string; content: { title: string | null; body: string | null; data: unknown } } } };

const mockN = {
  handler: null as null | { handleNotification: () => Promise<Record<string, boolean>> },
  perm: { granted: false, canAskAgain: true } as Perm,
  answer: { granted: true, canAskAgain: true } as Perm,
  token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]',
  tokenFails: false,
  last: null as Response | null,
  received: [] as ((n: unknown) => void)[],
  responses: [] as ((r: Response) => void)[],
  calls: [] as string[],
};
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 6 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: (h: typeof mockN.handler) => (mockN.handler = h),
  setNotificationChannelAsync: async (id: string) => {
    mockN.calls.push(`channel:${id}`);
    return null;
  },
  getPermissionsAsync: async () => mockN.perm,
  requestPermissionsAsync: async () => {
    mockN.calls.push('request');
    mockN.perm = mockN.answer;
    return mockN.answer;
  },
  getExpoPushTokenAsync: async (o: { projectId?: string }) => {
    mockN.calls.push(`token:${o.projectId}`);
    if (mockN.tokenFails) throw new Error('FIREBASE_NOT_CONFIGURED');
    return { type: 'expo', data: mockN.token };
  },
  unregisterForNotificationsAsync: async () => void mockN.calls.push('unregister-fcm'),
  addNotificationReceivedListener: (l: (n: unknown) => void) => {
    mockN.received.push(l);
    return { remove: () => mockN.received.splice(mockN.received.indexOf(l), 1) };
  },
  addNotificationResponseReceivedListener: (l: (r: Response) => void) => {
    mockN.responses.push(l);
    return { remove: () => mockN.responses.splice(mockN.responses.indexOf(l), 1) };
  },
  getLastNotificationResponseAsync: async () => mockN.last,
  clearLastNotificationResponseAsync: async () => {
    mockN.last = null;
  },
}));

const mockDevice = { isDevice: true, manufacturer: 'samsung' as string | null, modelName: 'SM-A546E' as string | null };
jest.mock('expo-device', () => ({
  __esModule: true, // live values (not a copy taken at import)
  get isDevice() {
    return mockDevice.isDevice;
  },
  get manufacturer() {
    return mockDevice.manufacturer;
  },
  get modelName() {
    return mockDevice.modelName;
  },
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'proj-123' } } } } }));

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));

const mockRegister = jest.fn();
const mockUnregister = jest.fn();
jest.mock('@/lib/api', () => ({
  registerDevice: (...a: unknown[]) => mockRegister(...a),
  unregisterDevice: (...a: unknown[]) => mockUnregister(...a),
}));

const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const KEY = push.PUSH_TOKEN_KEY;
const token = async () => 't';

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  mockDevice.isDevice = true;
  mockDevice.manufacturer = 'samsung';
  mockDevice.modelName = 'SM-A546E';
  Object.assign(mockN, {
    perm: { granted: false, canAskAgain: true },
    answer: { granted: true, canAskAgain: true },
    token: TOKEN,
    tokenFails: false,
    last: null,
    calls: [],
  });
  mockN.received.length = 0;
  mockN.responses.length = 0;
  mockStore.clear();
  mockRegister.mockReset().mockResolvedValue({});
  mockUnregister.mockReset().mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('while bdgtr is open and in front', () => {
  it('no system notification (it shows as a toast instead)', async () => {
    mockN.handler = null;
    push.onForegroundAlert(() => {})();
    expect(await mockN.handler!.handleNotification()).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});

describe('status', () => {
  it.each([
    [{ granted: false, canAskAgain: true }, false, 'off'],
    [{ granted: false, canAskAgain: false }, false, 'blocked'],
    [{ granted: true, canAskAgain: true }, false, 'off'],
    [{ granted: true, canAskAgain: true }, true, 'on'],
  ] as const)('permission %j, registered %s → %s', async (perm, registered, expected) => {
    mockN.perm = { ...perm };
    if (registered) mockStore.set(KEY, TOKEN);
    expect(await push.pushStatus()).toBe(expected);
  });

  it('an emulator, or not Android → unsupported', async () => {
    mockDevice.isDevice = false;
    expect(await push.pushStatus()).toBe('unsupported');
    mockDevice.isDevice = true;
    jest.replaceProperty(Platform, 'OS', 'ios');
    expect(await push.pushStatus()).toBe('unsupported');
  });
});

describe('turning on', () => {
  it('creates the alert channel BEFORE asking (Android 13), then registers this phone with a label', async () => {
    expect(await push.enablePush(token)).toBe('on');
    expect(mockN.calls).toEqual(['channel:budget-alerts', 'request', 'token:proj-123']);
    expect(mockRegister).toHaveBeenCalledWith(expect.any(Function), {
      kind: 'expo',
      expoPushToken: TOKEN,
      deviceLabel: 'Samsung SM-A546E',
    });
    expect(mockStore.get(KEY)).toBe(TOKEN);
    expect(await push.pushStatus()).toBe('on');
  });

  it('declined (can ask again) → off; declined for good → blocked; nothing registered', async () => {
    mockN.answer = { granted: false, canAskAgain: true };
    expect(await push.enablePush(token)).toBe('off');
    mockN.answer = { granted: false, canAskAgain: false };
    expect(await push.enablePush(token)).toBe('blocked');
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockStore.has(KEY)).toBe(false);
  });

  it('already blocked in Android settings: does not ask', async () => {
    mockN.perm = { granted: false, canAskAgain: false };
    expect(await push.enablePush(token)).toBe('blocked');
    expect(mockN.calls).not.toContain('request');
  });

  it('no push token (e.g. Firebase not set up) or the server failing is reported; not marked on', async () => {
    mockN.tokenFails = true;
    await expect(push.enablePush(token)).rejects.toThrow();
    mockN.tokenFails = false;
    mockRegister.mockRejectedValue(new TypeError('Network request failed'));
    await expect(push.enablePush(token)).rejects.toThrow();
    expect(mockStore.has(KEY)).toBe(false);
  });

  it('an emulator → unsupported, nothing asked', async () => {
    mockDevice.isDevice = false;
    expect(await push.enablePush(token)).toBe('unsupported');
    expect(mockN.calls).toEqual([]);
  });
});

describe('turning off, signing out, keeping it pointed at the right person', () => {
  beforeEach(() => {
    mockN.perm = { granted: true, canAskAgain: true };
    mockStore.set(KEY, TOKEN);
  });

  it('turn off: the server forgets this phone', async () => {
    await push.disablePush(token);
    expect(mockUnregister).toHaveBeenCalledWith(expect.any(Function), TOKEN);
    expect(await push.pushStatus()).toBe('off');
  });

  it('turn off while offline: says so (throws) and stays on, since alerts would keep coming', async () => {
    mockUnregister.mockRejectedValue(new TypeError('Network request failed'));
    await expect(push.disablePush(token)).rejects.toThrow();
    expect(await push.pushStatus()).toBe('on');
  });

  it('sign-out: forgets this phone on the server', async () => {
    await push.forgetPushOnSignOut(token);
    expect(mockUnregister).toHaveBeenCalledWith(expect.any(Function), TOKEN);
    expect(mockN.calls).not.toContain('unregister-fcm');
    expect(mockStore.has(KEY)).toBe(false);
  });

  it('sign-out while offline: drops the phone’s push registration so the previous person’s alerts stop; never throws', async () => {
    mockUnregister.mockRejectedValue(new TypeError('Network request failed'));
    await expect(push.forgetPushOnSignOut(token)).resolves.toBeUndefined();
    expect(mockN.calls).toContain('unregister-fcm');
    expect(mockStore.has(KEY)).toBe(false);
  });

  it('sign-out when notifications were never on: nothing to do', async () => {
    mockStore.clear();
    await push.forgetPushOnSignOut(token);
    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it('on sign-in / app start: re-registers to whoever is signed in', async () => {
    await push.syncPush(token);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it('a rotated token: registers the new one and drops the old', async () => {
    mockN.token = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
    await push.syncPush(token);
    expect(mockRegister).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ expoPushToken: mockN.token }));
    expect(mockUnregister).toHaveBeenCalledWith(expect.any(Function), TOKEN);
    expect(mockStore.get(KEY)).toBe(mockN.token);
  });

  it('nothing happens when off, and errors are swallowed', async () => {
    mockStore.clear();
    await push.syncPush(token);
    expect(mockRegister).not.toHaveBeenCalled();
    mockStore.set(KEY, TOKEN);
    mockRegister.mockRejectedValue(new Error('offline'));
    await expect(push.syncPush(token)).resolves.toBeUndefined();
  });
});

const response = (data: unknown, id = 'n1', action = 'expo.modules.notifications.actions.DEFAULT'): Response => ({
  actionIdentifier: action,
  notification: { request: { identifier: id, content: { title: 'Over budget · Food', body: 'b', data } } },
});

describe('alerts arriving while the app is open', () => {
  it('passes well-formed alerts to the handler; ignores anything else', () => {
    const got: unknown[] = [];
    const stop = push.onForegroundAlert((a) => got.push(a));
    const fire = (content: unknown) => mockN.received[0]!({ request: { content } });
    fire({ title: 'Over budget · Food', body: 'b', data: { type: 'alert', level: 'over' } });
    fire({ title: 'Nearly at budget · Food', body: 'b', data: { type: 'alert', level: 'near' } });
    fire({ title: 'x', body: 'b', data: { type: 'marketing' } });
    fire({ title: null, body: 'b', data: { type: 'alert' } });
    fire({ title: 'x', body: 'b', data: null });
    expect(got).toEqual([
      { level: 'over', title: 'Over budget · Food', body: 'b' },
      { level: 'near', title: 'Nearly at budget · Food', body: 'b' },
    ]);
    stop();
    expect(mockN.received).toHaveLength(0);
  });

  it('does nothing on an emulator', () => {
    mockDevice.isDevice = false;
    mockN.handler = null;
    push.onForegroundAlert(() => {})();
    expect(mockN.received).toHaveLength(0);
    expect(mockN.handler).toBeNull();
  });
});

describe('tapping a notification', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('opens the alerts for that household', async () => {
    const opened: string[] = [];
    const stop = push.onNotificationTap((p) => opened.push(p));
    mockN.responses[0]!(response({ type: 'alert', url: '/alerts?household=h1' }));
    expect(opened).toEqual(['/alerts?household=h1']);
    stop();
    expect(mockN.responses).toHaveLength(0);
  });

  it('a tap that launched the app opens it too, once (even if the listener also hears it)', async () => {
    mockN.last = response({ type: 'alert', url: '/alerts?household=h2' }, 'cold');
    const opened: string[] = [];
    push.onNotificationTap((p) => opened.push(p));
    await flush();
    mockN.responses[0]!(response({ type: 'alert', url: '/alerts?household=h2' }, 'cold'));
    expect(opened).toEqual(['/alerts?household=h2']);
    expect(mockN.last).toBeNull(); // cleared, so it doesn't reopen next time
  });

  it.each([
    ['another site', 'https://evil.example.com/'],
    ['a protocol-relative link', '//evil.example.com/x'],
    ['no link', undefined],
    ['not text', 42],
  ])('ignores %s', async (_label, url) => {
    const opened: string[] = [];
    push.onNotificationTap((p) => opened.push(p));
    mockN.responses[0]!(response({ type: 'alert', url }));
    expect(opened).toEqual([]);
  });

  it('ignores a dismiss or other action', () => {
    const opened: string[] = [];
    push.onNotificationTap((p) => opened.push(p));
    mockN.responses[0]!(response({ url: '/alerts' }, 'n2', 'expo.modules.notifications.actions.DISMISS'));
    expect(opened).toEqual([]);
  });

  it('closed before the launch tap is read: does not navigate', async () => {
    mockN.last = response({ url: '/alerts?household=h3' }, 'late');
    const opened: string[] = [];
    push.onNotificationTap((p) => opened.push(p))();
    await flush();
    expect(opened).toEqual([]);
  });
});

describe('phoneLabel', () => {
  it.each([
    ['samsung', 'SM-A546E', 'Samsung SM-A546E'],
    ['Google', 'Pixel 8', 'Google Pixel 8'],
    ['Google', 'Google Pixel 8', 'Google Pixel 8'],
    [null, null, 'Android phone'],
    ['  ', '\u0000', 'Android phone'],
    ['X', 'y'.repeat(80), `X ${'y'.repeat(58)}`],
  ])('%s + %s → %s', (maker, model, expected) => {
    expect(push.phoneLabel(maker, model)).toBe(expected);
  });
});
