#!/usr/bin/env node
/**
 * Guards against "works locally, crashes on Vercel" (FUNCTION_INVOCATION_FAILED).
 *
 * tsx and Vitest quietly resolve extensionless imports like './app', but Vercel
 * compiles each .ts file to .js and runs it with Node's strict ESM loader, which
 * needs './app.js'. This script reproduces that: compile src/ with tsc, then
 * import the compiled entry with plain Node and call /health.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const apiDir = resolve(import.meta.dirname, '..');

// Vercel's zero-config Hono detection takes the FIRST match in this order:
// app, index, server, src/app, src/index, src/server (.js/.cjs/.mjs/.ts/.cts/.mts).
// Our entry is src/index.ts, so nothing earlier in the list may exist.
const EXTS = ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'];
const shadowing = ['app', 'index', 'server', 'src/app']
  .flatMap((base) => EXTS.map((ext) => `${base}.${ext}`))
  .filter((file) => existsSync(join(apiDir, file)));
if (shadowing.length > 0) {
  console.error(
    `verify-deploy-build: FAILED, Vercel would use ${shadowing[0]} as the entry instead of src/index.ts. Rename it.`,
  );
  process.exit(1);
}

// Vercel type-checks with looser settings than our tsconfig (strictNullChecks
// off, seen in its build log), where some narrowing that passes locally fails
// (e.g. on an { ok: true | false } union). Check that mode too.
try {
  execFileSync(
    process.execPath,
    [
      join(apiDir, 'node_modules/typescript/bin/tsc'),
      '-p', join(apiDir, 'tsconfig.json'),
      '--noEmit',
      '--strictNullChecks', 'false',
      '--exactOptionalPropertyTypes', 'false',
    ],
    { stdio: 'inherit' },
  );
} catch {
  console.error('verify-deploy-build: FAILED, the API does not type-check the way Vercel compiles it (strictNullChecks off).');
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), 'bdgtr-api-verify-'));

try {
  execFileSync(
    process.execPath,
    [
      join(apiDir, 'node_modules/typescript/bin/tsc'),
      '-p', join(apiDir, 'tsconfig.json'),
      '--noEmit', 'false',
      '--outDir', outDir,
      '--rootDir', join(apiDir, 'src'),
    ],
    { stdio: 'inherit' },
  );
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'module' }));
  symlinkSync(join(apiDir, 'node_modules'), join(outDir, 'node_modules'), 'dir');

  // Dummy, non-secret values so the real app (not the misconfigured fallback) loads.
  process.env.MONGODB_URI = 'mongodb+srv://verify:verify@example.invalid/';
  process.env.ALLOWED_ORIGINS = 'https://bdgtr.erroldee.com';

  const { default: app } = await import(pathToFileURL(join(outDir, 'index.js')).href);
  const res = await app.request('/health');
  const body = await res.json();
  if (res.status !== 200 || body.status !== 'ok') {
    throw new Error(`Compiled app answered ${res.status} ${JSON.stringify(body)}`);
  }
  console.log('verify-deploy-build: compiled API loads under plain Node and /health is ok');
} catch (err) {
  console.error('verify-deploy-build: FAILED, this would crash on Vercel:');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
