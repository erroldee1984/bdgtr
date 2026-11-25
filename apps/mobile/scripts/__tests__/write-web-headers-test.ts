/// <reference types="node" />
/**
 * The web build's security headers (Content-Security-Policy etc.), written by
 * scripts/write-web-headers.mjs. Runs the real script on a tiny fake build.
 *
 * Regressions covered: the CSP blocked Clerk Protect (cdn.protect.clerk.com),
 * then its probe hosts on other ports, and Clerk rejected new sign-ups as
 * "suspicious" in production (PRs #8, #9). A custom +html.tsx once shipped
 * pages that never loaded their JavaScript.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', 'write-web-headers.mjs');
const PK_LIVE = 'pk_live_Y2xlcmsuYmRndHIuZXJyb2xkZWUuY29tJA'; // public: clerk.bdgtr.erroldee.com
const INLINE = 'window.__BOOT__=1;';
const APP_SCRIPT = '<script src="/_expo/static/js/web/entry-abc.js" defer></script>';

let dist: string;
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'bdgtr-headers-'));
  writeFileSync(join(dist, 'index.html'), `<html><head><script>${INLINE}</script></head><body>${APP_SCRIPT}</body></html>`);
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

function run(env: Record<string, string> = {}) {
  const clean = { PATH: process.env.PATH ?? '', NODE_ENV: 'production' as const }; // no inherited EXPO_PUBLIC_* values
  const options = { env: { ...clean, ...env }, encoding: 'utf8' as const, stdio: 'pipe' as const };
  return execFileSync(process.execPath, [SCRIPT, dist], options);
}
function runFails(env: Record<string, string> = {}): string {
  try {
    run(env);
  } catch (err) {
    return String((err as { stderr?: string }).stderr);
  }
  throw new Error('expected the script to fail');
}
const csp = () => /Content-Security-Policy: (.*)/.exec(readFileSync(join(dist, '_headers'), 'utf8'))![1]!;
const directive = (name: string) => csp().split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('write-web-headers (production build)', () => {
  beforeEach(() => run({ EXPO_PUBLIC_API_URL: 'https://bdgtr-api.erroldee.com/', EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: PK_LIVE }));

  it('allows the API and the Clerk host taken from the publishable key', () => {
    expect(directive('connect-src')).toContain('https://bdgtr-api.erroldee.com');
    expect(directive('connect-src')).toContain('https://clerk.bdgtr.erroldee.com');
    expect(directive('script-src')).toContain('https://clerk.bdgtr.erroldee.com');
  });

  it('allows Clerk Protect: its script and its probe hosts on any port (regression)', () => {
    expect(directive('script-src')).toContain('https://cdn.protect.clerk.com');
    expect(directive('connect-src')).toContain('https://cdn.protect.clerk.com');
    expect(directive('connect-src')).toContain('https://*.client.protect.clerk.com:*');
  });

  it("allows the inline script Expo generated, by its exact hash, and no 'unsafe-inline' scripts", () => {
    const hash = createHash('sha256').update(INLINE, 'utf8').digest('base64');
    expect(directive('script-src')).toContain(`'sha256-${hash}'`);
    expect(directive('script-src')).not.toContain('unsafe-inline');
    expect(directive('script-src')).not.toContain('unsafe-eval');
  });

  it('stays locked down: no framing, no plugins, no other origins', () => {
    expect(csp()).toContain("frame-ancestors 'none'");
    expect(csp()).toContain("object-src 'none'");
    expect(csp()).toContain("default-src 'self'");
    expect(directive('connect-src')).not.toMatch(/(^| )\*( |$)|https:\/\/\*( |$)/);
    const headers = readFileSync(join(dist, '_headers'), 'utf8');
    expect(headers).toContain('Strict-Transport-Security: max-age=63072000; includeSubDomains');
    expect(headers).toContain('X-Frame-Options: DENY');
  });
});

describe('write-web-headers (negative cases)', () => {
  it('without a Clerk key: no Clerk hosts, frames blocked', () => {
    run();
    expect(csp()).not.toContain('clerk');
    expect(directive('frame-src')).toBe("frame-src 'none'");
  });

  it.each([
    ['a secret key by mistake', 'sk_live_abc'],
    ['garbage', 'not-a-key'],
    ['a key that decodes to a non-host', `pk_live_${Buffer.from('not a host$').toString('base64')}`],
  ])('refuses to build with %s as the publishable key', (_label, key) => {
    expect(runFails({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: key })).toMatch(/not a valid Clerk publishable key/);
  });

  it('fails the build when the page never loads its JavaScript (regression: custom +html.tsx)', () => {
    writeFileSync(join(dist, 'index.html'), `<html><body><script>${INLINE}</script></body></html>`);
    expect(runFails()).toMatch(/does not load any app JavaScript/);
  });

  it('fails clearly when the build folder is missing', () => {
    rmSync(dist, { recursive: true, force: true });
    expect(runFails()).toMatch(/not found; run expo export first/);
    mkdirSync(dist); // for afterEach
  });

  it('copies the 404 page when Expo produced one', () => {
    writeFileSync(join(dist, '+not-found.html'), '<html>404</html>');
    run();
    expect(existsSync(join(dist, '404.html'))).toBe(true);
  });
});
