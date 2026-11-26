/**
 * Browser notifications (Web Push) for this device, with fake browser APIs.
 * Imports the .web file directly (Jest runs as native by default).
 */
import * as push from '../device-push.web';

const mockRegister = jest.fn();
const mockUnregister = jest.fn();
let mockKey: string | null = 'BPublicKey_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abc';
jest.mock('@/lib/api', () => ({
  fetchVapidKey: async () => mockKey,
  registerDevice: (...a: unknown[]) => mockRegister(...a),
  unregisterDevice: (...a: unknown[]) => mockUnregister(...a),
}));

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
type FakeSub = { endpoint: string; toJSON: () => unknown; unsubscribe: jest.Mock };
const fakeSub = (): FakeSub => ({
  endpoint: ENDPOINT,
  toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } }),
  unsubscribe: jest.fn(async () => true),
});

let existing: FakeSub | null;
let permission: NotificationPermission;
let answer: NotificationPermission;
const subscribe = jest.fn(async () => (existing = fakeSub()));
const registration = { pushManager: { getSubscription: async () => existing, subscribe } };
const listeners: ((e: { data: unknown }) => void)[] = [];
const g = globalThis as unknown as Record<string, unknown>;

function installBrowser({ ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36', pushApis = true } = {}) {
  Object.defineProperty(g, 'navigator', {
    configurable: true,
    value: {
      userAgent: ua,
      ...(pushApis
        ? {
            serviceWorker: {
              register: jest.fn(async () => registration),
              ready: Promise.resolve(registration),
              getRegistration: jest.fn(async () => registration),
              addEventListener: (_: string, l: (e: { data: unknown }) => void) => listeners.push(l),
              removeEventListener: (_: string, l: (e: { data: unknown }) => void) => listeners.splice(listeners.indexOf(l), 1),
            },
          }
        : {}),
    },
  });
  Object.defineProperty(g, 'window', {
    configurable: true,
    value: {
      ...(pushApis ? { PushManager: function PushManager() {} } : {}),
      Notification: {},
      matchMedia: () => ({ matches: false }),
    },
  });
  Object.defineProperty(g, 'Notification', {
    configurable: true,
    value: {
      get permission() {
        return permission;
      },
      requestPermission: jest.fn(async () => (permission = answer)),
    },
  });
}

const token = async () => 't';
beforeEach(() => {
  existing = null;
  permission = 'default';
  answer = 'granted';
  mockKey = 'BPublicKey_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abc';
  subscribe.mockClear();
  mockRegister.mockReset().mockResolvedValue({});
  mockUnregister.mockReset().mockResolvedValue(undefined);
  listeners.length = 0;
  installBrowser();
});

describe('status', () => {
  it.each([
    ['default', null, 'off'],
    ['denied', null, 'blocked'],
    ['granted', null, 'off'],
    ['granted', 'sub', 'on'],
  ] as const)('permission %s, subscription %s → %s', async (perm, sub, expected) => {
    permission = perm;
    existing = sub ? fakeSub() : null;
    expect(await push.pushStatus()).toBe(expected);
  });

  it('a browser without push support → unsupported', async () => {
    installBrowser({ pushApis: false });
    expect(await push.pushStatus()).toBe('unsupported');
  });

  it('iPhone Safari not added to the Home Screen → needs-install', async () => {
    installBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1' });
    expect(await push.pushStatus()).toBe('needs-install');
  });
});

describe('turning on', () => {
  it('asks permission, subscribes with the server key and registers this browser with a label', async () => {
    expect(await push.enablePush(token)).toBe('on');
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
    expect(mockRegister).toHaveBeenCalledWith(expect.any(Function), {
      kind: 'webpush',
      subscription: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } },
      deviceLabel: 'Chrome on Windows',
    });
  });

  it('reuses an existing subscription instead of making another', async () => {
    permission = 'granted';
    existing = fakeSub();
    expect(await push.enablePush(token)).toBe('on');
    expect(subscribe).not.toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('declined → blocked, nothing registered', async () => {
    answer = 'denied';
    expect(await push.enablePush(token)).toBe('blocked');
    expect(subscribe).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('prompt dismissed → still off, nothing registered', async () => {
    answer = 'default';
    expect(await push.enablePush(token)).toBe('off');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('already blocked: does not even ask', async () => {
    permission = 'denied';
    expect(await push.enablePush(token)).toBe('blocked');
    expect((g.Notification as { requestPermission: jest.Mock }).requestPermission).not.toHaveBeenCalled();
  });

  it('server has push turned off → server-off', async () => {
    mockKey = null;
    expect(await push.enablePush(token)).toBe('server-off');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('registration failing is reported to the caller (Settings shows a message)', async () => {
    mockRegister.mockRejectedValue(new TypeError('Network request failed'));
    await expect(push.enablePush(token)).rejects.toThrow();
  });
});

describe('turning off, signing out, keeping it pointed at the right person', () => {
  it('turn off: forget on the server, then unsubscribe', async () => {
    permission = 'granted';
    const sub = (existing = fakeSub());
    await push.disablePush(token);
    expect(mockUnregister).toHaveBeenCalledWith(expect.any(Function), ENDPOINT);
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('turn off still unsubscribes when the server cannot be reached', async () => {
    const sub = (existing = fakeSub());
    mockUnregister.mockRejectedValue(new TypeError('offline'));
    await push.disablePush(token);
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('sign-out never throws, even when everything fails', async () => {
    existing = fakeSub();
    existing.unsubscribe.mockRejectedValue(new Error('x'));
    mockUnregister.mockRejectedValue(new Error('x'));
    await expect(push.forgetPushOnSignOut(token)).resolves.toBeUndefined();
  });

  it('on sign-in: an already-subscribed browser is re-registered to whoever is signed in', async () => {
    permission = 'granted';
    existing = fakeSub();
    await push.syncPush(token);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('on sign-in: nothing happens without permission or a subscription, and errors are swallowed', async () => {
    await push.syncPush(token);
    permission = 'granted';
    await push.syncPush(token);
    expect(mockRegister).not.toHaveBeenCalled();
    existing = fakeSub();
    mockRegister.mockRejectedValue(new Error('offline'));
    await expect(push.syncPush(token)).resolves.toBeUndefined();
  });
});

describe('alerts arriving while the app is open', () => {
  it('passes well-formed alerts from the service worker to the handler; ignores anything else', () => {
    const got: unknown[] = [];
    const stop = push.onForegroundAlert((a) => got.push(a));
    listeners[0]!({ data: { type: 'bdgtr-alert', alert: { level: 'over', title: 'Over budget · Food', body: 'b' } } });
    listeners[0]!({ data: { type: 'something-else' } });
    listeners[0]!({ data: { type: 'bdgtr-alert', alert: { title: 42 } } });
    listeners[0]!({ data: null });
    expect(got).toEqual([{ level: 'over', title: 'Over budget · Food', body: 'b' }]);
    stop();
    expect(listeners).toHaveLength(0);
  });
});

describe('base64UrlToBytes', () => {
  it('decodes URL-safe base64 without padding', () => {
    expect([...push.base64UrlToBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });
});
