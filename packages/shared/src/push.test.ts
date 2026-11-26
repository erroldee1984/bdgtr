import { describe, expect, it } from 'vitest';

import {
  deviceAddress,
  deviceLabelFromUserAgent,
  isAllowedPushEndpoint,
  RegisterDeviceInputSchema,
  UpdateMembershipSettingsSchema,
} from './push.ts';

const P256 = 'B'.repeat(87);
const AUTH = 'a'.repeat(22);
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const sub = (endpoint: string) => ({ endpoint, expirationTime: null, keys: { p256dh: P256, auth: AUTH } });

describe('isAllowedPushEndpoint (the server only talks to real push services)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
    'https://web.push.apple.com/QGsj5',
  ])('allows %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(true));

  it.each([
    ['plain http', 'http://fcm.googleapis.com/fcm/send/x'],
    ['another site', 'https://evil.example.com/fcm/send/x'],
    ['look-alike host', 'https://fcm.googleapis.com.evil.com/x'],
    ['look-alike suffix', 'https://evilfcm.googleapis.com/x'],
    ['internal address', 'https://169.254.169.254/latest/meta-data'],
    ['localhost', 'https://localhost:8787/me'],
    ['explicit port', 'https://fcm.googleapis.com:8443/x'],
    ['credentials in URL', 'https://user:pw@fcm.googleapis.com/x'],
    ['not a URL', 'fcm.googleapis.com/x'],
    ['empty', ''],
  ])('refuses %s', (_label, url) => expect(isAllowedPushEndpoint(url)).toBe(false));
});

describe('RegisterDeviceInputSchema', () => {
  it('accepts a browser push subscription with a label', () => {
    const r = RegisterDeviceInputSchema.parse({ kind: 'webpush', subscription: sub('https://fcm.googleapis.com/fcm/send/x'), deviceLabel: ' Chrome on Windows ' });
    expect(r.deviceLabel).toBe('Chrome on Windows');
    expect(deviceAddress(r)).toBe('https://fcm.googleapis.com/fcm/send/x');
  });

  it.each([TOKEN, 'ExpoPushToken[abc-DEF_123]'])('accepts the Android app’s Expo push token %s', (token) => {
    const r = RegisterDeviceInputSchema.parse({ kind: 'expo', expoPushToken: token, deviceLabel: 'Samsung Galaxy A54' });
    expect(deviceAddress(r)).toBe(token);
  });

  it.each([
    ['an endpoint that is not a push service', { kind: 'webpush', subscription: sub('https://evil.example.com/x'), deviceLabel: 'x' }],
    ['missing keys', { kind: 'webpush', subscription: { endpoint: 'https://fcm.googleapis.com/x' }, deviceLabel: 'x' }],
    ['malformed key', { kind: 'webpush', subscription: { ...sub('https://fcm.googleapis.com/x'), keys: { p256dh: 'short', auth: AUTH } }, deviceLabel: 'x' }],
    ['unknown kind', { kind: 'sms', subscription: sub('https://fcm.googleapis.com/x'), deviceLabel: 'x' }],
    ['blank label', { kind: 'webpush', subscription: sub('https://fcm.googleapis.com/x'), deviceLabel: '  ' }],
    ['label too long', { kind: 'webpush', subscription: sub('https://fcm.googleapis.com/x'), deviceLabel: 'x'.repeat(61) }],
    ['choosing the owner in the body', { kind: 'webpush', subscription: sub('https://fcm.googleapis.com/x'), deviceLabel: 'x', userId: 'someone' }],
    ['overlong endpoint', { kind: 'webpush', subscription: sub(`https://fcm.googleapis.com/${'x'.repeat(1000)}`), deviceLabel: 'x' }],
    ['a browser without its subscription', { kind: 'webpush', deviceLabel: 'x' }],
    ['a browser with an Expo token too', { kind: 'webpush', subscription: sub('https://fcm.googleapis.com/x'), expoPushToken: TOKEN, deviceLabel: 'x' }],
    ['the app without its token', { kind: 'expo', deviceLabel: 'x' }],
    ['the app with a browser subscription', { kind: 'expo', subscription: sub('https://fcm.googleapis.com/x'), deviceLabel: 'x' }],
    ['the app with a URL instead of a token', { kind: 'expo', expoPushToken: 'https://169.254.169.254/', deviceLabel: 'x' }],
    ['a token with extra text', { kind: 'expo', expoPushToken: `${TOKEN} x`, deviceLabel: 'x' }],
    ['an empty token', { kind: 'expo', expoPushToken: 'ExponentPushToken[]', deviceLabel: 'x' }],
  ])('rejects %s', (_label, input) => {
    expect(RegisterDeviceInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('UpdateMembershipSettingsSchema', () => {
  it('accepts either setting', () => {
    expect(UpdateMembershipSettingsSchema.safeParse({ alertsMuted: true }).success).toBe(true);
    expect(UpdateMembershipSettingsSchema.safeParse({ dailyDigestEnabled: false }).success).toBe(true);
  });
  it.each([
    ['empty', {}],
    ['not a boolean', { alertsMuted: 'yes' }],
    ['changing role', { role: 'owner' }],
  ])('rejects %s', (_l, input) => expect(UpdateMembershipSettingsSchema.safeParse(input).success).toBe(false));
});

describe('deviceLabelFromUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Linux; Android 14; SM-F956B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
    ['something odd', 'Browser on this device'],
  ])('%s → %s', (ua, label) => expect(deviceLabelFromUserAgent(ua)).toBe(label));
});
