#!/usr/bin/env node
/**
 * Runs after `expo export -p web`. Writes Cloudflare Pages config into dist/:
 *  - _headers: security headers (docs/PLAN.md §10), with a Content-Security-Policy
 *    that allows ONLY the exact inline scripts Expo generated (by SHA-256 hash).
 *  - 404.html: copied from +not-found.html so unknown URLs get the app's 404 page.
 *  - _redirects: serves the one pre-built invite page for every /invite/<token> link.
 *
 * Usage: node scripts/write-web-headers.mjs [distDir]
 * Reads EXPO_PUBLIC_API_URL to allow the API origin in connect-src.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const distDir = process.argv[2] ?? 'dist';
if (!existsSync(distDir)) {
  console.error(`write-web-headers: ${distDir} not found; run expo export first`);
  process.exit(1);
}

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return name.endsWith('.html') ? [p] : [];
  });
}

// Guard: a page that renders but never loads its JavaScript looks fine in a
// quick check yet is dead in the browser (happened once with a custom +html.tsx).
const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');
if (!/<script[^>]+src="\/_expo\/static\/js\//.test(indexHtml)) {
  console.error(
    'write-web-headers: FAILED, dist/index.html does not load any app JavaScript. ' +
      'Check src/app/+html.tsx renders headNodes/bodyNodes from useServerDocumentContext().',
  );
  process.exit(1);
}

const hashes = new Set();
for (const file of htmlFiles(distDir)) {
  const html = readFileSync(file, 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(attrs) || body.length === 0) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
}

const apiUrl = process.env.EXPO_PUBLIC_API_URL;
const connectSrc = ["'self'"];
if (apiUrl) connectSrc.push(new URL(apiUrl).origin);
if (process.env.CSP_EXTRA_CONNECT) connectSrc.push(...process.env.CSP_EXTRA_CONNECT.split(/\s+/).filter(Boolean));

/**
 * Clerk (sign-in) needs its Frontend API host, which is base64-encoded inside the
 * publishable key: pk_live_<base64("clerk.example.com$")>. Deriving it here keeps
 * the CSP in step with whichever Clerk instance the build uses.
 * See https://clerk.com/docs/security/clerk-csp
 */
export function clerkFrontendApiOrigin(publishableKey) {
  const m = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(publishableKey ?? '');
  if (!m) return null;
  const decoded = Buffer.from(m[2], 'base64').toString('utf8');
  const host = decoded.replace(/\$$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : null;
}

const clerkOrigin = clerkFrontendApiOrigin(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);
const CLOUDFLARE_CHALLENGES = 'https://challenges.cloudflare.com'; // Clerk bot protection (sign-up)
// Clerk Protect (fraud/bot signals) loads its bootstrap script from here. If CSP blocks
// it, Clerk can't assess the browser and rejects new sign-ups as "suspicious"
// (sign_up.rejected / action_blocked), which happened on the first production sign-up.
const CLERK_PROTECT = 'https://cdn.protect.clerk.com';
// ...and the loaded script then probes per-instance hosts under client.protect.clerk.com
// on several ports (443, 992, 2082, 8443, 18443 seen), so allow that one host family, any port.
const CLERK_PROTECT_PROBES = 'https://*.client.protect.clerk.com:*';
const scriptExtra = [];
const frameSrc = [];
const imgExtra = [];
if (clerkOrigin) {
  connectSrc.push(clerkOrigin, CLERK_PROTECT, CLERK_PROTECT_PROBES);
  scriptExtra.push(clerkOrigin, CLOUDFLARE_CHALLENGES, CLERK_PROTECT);
  frameSrc.push(CLOUDFLARE_CHALLENGES);
  imgExtra.push('https://img.clerk.com'); // profile pictures
} else if (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  console.error('write-web-headers: FAILED, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not a valid Clerk publishable key');
  process.exit(1);
}

const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes, ...scriptExtra].join(' ')}`.trim(),
  // react-native-web writes component styles inline; scripts stay locked down.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imgExtra.join(' ')}`.trim(),
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(' ')}`,
  // Clerk runs a token-refresh worker from a blob: URL.
  "worker-src 'self' blob:",
  `frame-src ${frameSrc.length ? frameSrc.join(' ') : "'none'"}`,
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const headers = `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin

/_expo/static/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache

/.well-known/assetlinks.json
  Content-Type: application/json
  Access-Control-Allow-Origin: *
`;

writeFileSync(join(distDir, '_headers'), headers);

// Dynamic routes are exported once as e.g. invite/[token].html; rewrite (200, not a
// redirect, so the URL and its token stay) every matching link to that page.
const rewrites = [];
for (const file of htmlFiles(distDir)) {
  const rel = file.slice(distDir.length).replace(/\\/g, '/').replace(/^\/?/, '/');
  const m = /^(.*)\/\[[A-Za-z0-9_]+\]\.html$/.exec(rel);
  if (m) rewrites.push(`${m[1]}/*  ${rel.replace(/\.html$/, '')}  200`);
}
writeFileSync(join(distDir, '_redirects'), rewrites.length ? `${rewrites.join('\n')}\n` : '');

const notFound = join(distDir, '+not-found.html');
if (existsSync(notFound)) copyFileSync(notFound, join(distDir, '404.html'));

console.log(`write-web-headers: wrote _headers (${hashes.size} inline script hash(es), connect-src ${connectSrc.join(' ')}${clerkOrigin ? '' : ', no Clerk key'})`);
