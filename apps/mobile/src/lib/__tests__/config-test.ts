import {
  DEV_CLERK_PUBLISHABLE_KEY,
  LOCAL_API_URL,
  PRODUCTION_API_URL,
  resolveApiUrl,
  resolveClerkKey,
} from '../config';

describe('resolveApiUrl', () => {
  it('web dev without an override uses the local API (production rejects localhost origins)', () => {
    expect(resolveApiUrl(undefined, 'web')).toBe(LOCAL_API_URL);
  });

  it('Android dev (Expo Go) without an override uses the production API', () => {
    expect(resolveApiUrl(undefined, 'android')).toBe(PRODUCTION_API_URL);
  });

  it('an explicit EXPO_PUBLIC_API_URL always wins (real builds)', () => {
    expect(resolveApiUrl('https://bdgtr-api.erroldee.com', 'web')).toBe(PRODUCTION_API_URL);
    expect(resolveApiUrl('http://10.0.2.2:8787', 'android')).toBe('http://10.0.2.2:8787');
  });

  it('strips trailing slashes so paths join cleanly', () => {
    expect(resolveApiUrl('https://api.example.com///', 'web')).toBe('https://api.example.com');
  });

  it.each(['', '   '])('treats an empty override %j as unset', (value) => {
    expect(resolveApiUrl(value, 'web')).toBe(LOCAL_API_URL);
    expect(resolveApiUrl(value, 'android')).toBe(PRODUCTION_API_URL);
  });
});


describe('resolveClerkKey', () => {
  const LIVE = 'pk_live_Y2xlcmsuYmRndHIuZXJyb2xkZWUuY29tJA';
  const TEST = 'pk_test_Zm9vLmNsZXJrLmFjY291bnRzLmRldiQ';

  it('an explicit key always wins (real builds set the production key)', () => {
    expect(resolveClerkKey(LIVE, false)).toBe(LIVE);
    expect(resolveClerkKey(TEST, true)).toBe(TEST);
  });

  it('development falls back to the development instance key', () => {
    expect(resolveClerkKey(undefined, true)).toBe(DEV_CLERK_PUBLISHABLE_KEY || null);
  });

  it('a production build without a key gets null (shows "not configured", never the dev key)', () => {
    expect(resolveClerkKey(undefined, false)).toBeNull();
    expect(resolveClerkKey('', false)).toBeNull();
  });

  it.each(['sk_test_secret', 'pk_prod_x', 'not a key', 'pk_test_has spaces'])('rejects malformed key %j', (bad) => {
    expect(resolveClerkKey(bad, false)).toBeNull();
  });
});
