/// <reference types="node" />
/**
 * Every icon the app, the web page, the PWA manifest and the service worker
 * point at exists, is a real image, and has the size it claims (the icon pack).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const PUBLIC = join(ROOT, 'public');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;

describe('app icons', () => {
  test('app.json icons exist at the sizes Expo expects', () => {
    const adaptive = app.android.adaptiveIcon;
    expect(pngSize(join(ROOT, app.icon))).toEqual([1024, 1024]);
    expect(pngSize(join(ROOT, adaptive.foregroundImage))).toEqual([1024, 1024]);
    expect(pngSize(join(ROOT, adaptive.monochromeImage))).toEqual([1024, 1024]);
    expect(adaptive.backgroundColor).toBe('#161A31');
    const plugin = (name: string) => app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === name)[1];
    expect(existsSync(join(ROOT, plugin('expo-splash-screen').image))).toBe(true);
    expect(pngSize(join(ROOT, plugin('expo-notifications').icon))).toEqual([96, 96]);
  });

  test('the web page links the favicons and manifest, and they exist', () => {
    const html = readFileSync(join(ROOT, 'src', 'app', '+html.tsx'), 'utf8');
    const hrefs = [...html.matchAll(/<link rel="[^"]+" href="\/([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs).toEqual(['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest']);
    for (const h of hrefs) expect(existsSync(join(PUBLIC, h))).toBe(true);
    expect(pngSize(join(PUBLIC, 'apple-touch-icon.png'))).toEqual([180, 180]);
  });

  test('every manifest icon exists at its stated size, with any and maskable versions', () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'site.webmanifest'), 'utf8'));
    expect(manifest.theme_color).toBe('#12152B'); // matches the page (theme/tokens bg)
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(join(PUBLIC, icon.src))).toEqual([w, h]);
    }
    const purposes = new Set(manifest.icons.map((i: { purpose: string }) => i.purpose));
    expect(purposes).toEqual(new Set(['any', 'maskable']));
    // A stable app identity, and long-press shortcuts that open real pages.
    expect(manifest).toMatchObject({ id: '/', scope: '/', start_url: '/', display: 'standalone' });
    for (const sc of manifest.shortcuts) {
      expect(existsSync(join(ROOT, 'src', 'app', `${sc.url.slice(1)}.tsx`)) || existsSync(join(ROOT, 'src', 'app', '(tabs)', `${sc.url.slice(1)}.tsx`))).toBe(true);
      for (const icon of sc.icons) expect(existsSync(join(PUBLIC, icon.src))).toBe(true);
    }
  });

  test('the service worker notification icon and badge exist', () => {
    const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
    for (const [, file] of sw.matchAll(/(?:icon|badge): '\/([^']+)'/g)) expect(existsSync(join(PUBLIC, file!))).toBe(true);
  });
});
