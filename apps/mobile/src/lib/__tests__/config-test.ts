import { LOCAL_API_URL, PRODUCTION_API_URL, resolveApiUrl } from '../config';

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
