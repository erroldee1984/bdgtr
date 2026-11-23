#!/usr/bin/env node
/**
 * Runs after `expo export -p web`. Writes Cloudflare Pages config into dist/:
 *  - _headers: security headers (docs/PLAN.md §10), with a Content-Security-Policy
 *    that allows ONLY the exact inline scripts Expo generated (by SHA-256 hash).
 *  - 404.html: copied from +not-found.html so unknown URLs get the app's 404 page.
 *
 * Usage: node scripts/write-web-headers.mjs [distDir]
 * Reads EXPO_PUBLIC_API_URL to allow the API origin in connect-src.
 */
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
// Added when sign-in is set up in M1: Clerk's frontend API origin.
if (process.env.CSP_EXTRA_CONNECT) connectSrc.push(...process.env.CSP_EXTRA_CONNECT.split(/\s+/).filter(Boolean));

const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')}`.trim(),
  // react-native-web writes component styles inline; scripts stay locked down.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(' ')}`,
  "worker-src 'self'",
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
`;

writeFileSync(join(distDir, '_headers'), headers);

const notFound = join(distDir, '+not-found.html');
if (existsSync(notFound)) copyFileSync(notFound, join(distDir, '404.html'));

console.log(`write-web-headers: wrote _headers (${hashes.size} inline script hash(es), connect-src ${connectSrc.join(' ')})`);
