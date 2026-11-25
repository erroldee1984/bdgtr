#!/usr/bin/env node
/**
 * `pnpm dev:phone`: run the app in Expo Go on a real phone against the LOCAL
 * API (development database + Clerk development instance).
 *
 * WSL isn't reachable from the phone's Wi-Fi, so:
 *  1. start the local API on :8787 (unless one is already running),
 *  2. open a Cloudflare quick tunnel to it (temporary https://*.trycloudflare.com URL),
 *  3. start Expo with `--tunnel` and EXPO_PUBLIC_API_URL set to that URL.
 * Ctrl+C stops everything this script started.
 *
 * Requires `cloudflared` (see README). No Cloudflare account is needed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const API_PORT = 8787;
const children = [];

function findCloudflared() {
  const onPath = spawnSync('sh', ['-c', 'command -v cloudflared'], { encoding: 'utf8' }).stdout.trim();
  if (onPath) return onPath;
  const local = join(homedir(), '.local', 'bin', 'cloudflared');
  return existsSync(local) ? local : null;
}

async function apiIsUp() {
  try {
    const res = await fetch(`http://localhost:${API_PORT}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function start(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: root, ...opts });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`\n[dev-phone] ${name} exited (code ${code}). Stopping.`);
      shutdown(1);
    }
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const cloudflared = findCloudflared();
if (!cloudflared) {
  console.error('[dev-phone] cloudflared is not installed. See README → "Testing on your phone".');
  process.exit(1);
}

// 0. Shared package build (Expo's server rendering and the API load its compiled dist/)
if (spawnSync('pnpm', ['--filter', '@bdgtr/shared', 'build'], { cwd: root, stdio: 'inherit' }).status !== 0) {
  console.error('[dev-phone] Building @bdgtr/shared failed.');
  process.exit(1);
}

// 1. Local API
if (await apiIsUp()) {
  console.log(`[dev-phone] Using the API already running on :${API_PORT}`);
} else {
  console.log('[dev-phone] Starting the local API…');
  const api = start('API', 'pnpm', ['--filter', '@bdgtr/api', 'dev'], { stdio: ['ignore', 'pipe', 'inherit'] });
  api.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
  for (let i = 0; i < 60 && !(await apiIsUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await apiIsUp())) {
    console.error('[dev-phone] The API did not start. Check apps/api/.env.');
    shutdown(1);
  }
}

// 2. Quick tunnel → public https URL for the API
console.log('[dev-phone] Opening a Cloudflare quick tunnel to the API…');
const tunnel = start('cloudflared', cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${API_PORT}`], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
const apiUrl = await new Promise((resolveUrl, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out waiting for the tunnel URL')), 45_000);
  tunnel.stderr.on('data', (chunk) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
    if (m) {
      clearTimeout(timer);
      resolveUrl(m[0]);
    }
  });
}).catch((err) => {
  console.error(`[dev-phone] ${err.message}`);
  shutdown(1);
});
if (!apiUrl) process.exit(1);

// A brand-new quick-tunnel hostname takes a few seconds to appear in DNS. If the
// phone asks too early it fails (and may cache the failure), so wait until public
// DNS resolves it and a request through it succeeds before starting Expo.
// Ask Cloudflare's resolver directly: WSL's local resolver caches "not found".
const host = new URL(apiUrl).hostname;
const publicDns = new Resolver();
publicDns.setServers(['1.1.1.1', '1.0.0.1']);
let ready = false;
process.stdout.write('[dev-phone] Waiting for the tunnel address to go live');
for (let i = 0; i < 40 && !ready; i++) {
  try {
    const [ip] = await publicDns.resolve4(host);
    // Public DNS has it. Also try a request; if WSL's resolver cached an early
    // "not found" that request fails locally even though the phone is fine, so
    // after a few attempts public DNS alone is enough.
    const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    ready = Boolean(ip) && (res === null ? i >= 3 : res.ok);
  } catch {
    /* not in DNS yet */
  }
  if (!ready) {
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1500));
  }
}
console.log(ready ? ' live.' : ' (still not confirmed; continuing anyway)');
console.log(`[dev-phone] Phone will use the API at ${apiUrl}`);

// 3. Expo Go via Expo's tunnel. --clear so the new API URL is baked into the bundle.
start('Expo', 'pnpm', ['--filter', '@bdgtr/mobile', 'exec', 'expo', 'start', '--dev-client', '--tunnel', '--clear'], {
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl },
});
