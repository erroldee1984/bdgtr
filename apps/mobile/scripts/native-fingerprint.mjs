#!/usr/bin/env node
/**
 * Guards over-the-air updates (docs/PLAN.md §2c). An update only carries
 * JavaScript and images; it can't change native code. Updates go to phones
 * whose runtimeVersion matches (set by hand in app.json, so a rebuilt APK with a
 * new display version keeps getting the same updates), so a native change
 * shipped as an update without a new APK would crash those phones.
 *
 *   node scripts/native-fingerprint.mjs record   after building a release APK
 *   node scripts/native-fingerprint.mjs check    exit 0: safe to publish an update
 *                                                exit 1: native code changed; release a new APK
 *
 * Compares a hash of everything native (@expo/fingerprint) with the one
 * recorded for the current release in native-fingerprint.json. Firebase's
 * google-services.json (never in the repo) is left out, so CI and local
 * builds compute the same hash.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFingerprintAsync } from '@expo/fingerprint';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const recordFile = join(root, 'native-fingerprint.json');
process.env.GOOGLE_SERVICES_JSON = '/nonexistent/google-services.json';

const expo = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const { version, runtimeVersion } = expo;
if (typeof runtimeVersion !== 'string') throw new Error('app.json runtimeVersion must be a plain string (PLAN §2c)');
const { hash } = await createFingerprintAsync(root, { platforms: ['android'] });
const mode = process.argv[2];

if (mode === 'record') {
  writeFileSync(recordFile, `${JSON.stringify({ runtimeVersion, version, hash }, null, 2)}\n`);
  console.log(`Recorded native fingerprint for runtime ${runtimeVersion} (APK ${version}): ${hash}`);
} else if (mode === 'check') {
  const recorded = JSON.parse(readFileSync(recordFile, 'utf8'));
  if (recorded.runtimeVersion === runtimeVersion && recorded.hash === hash) {
    console.log(`Native code unchanged since the ${recorded.version} APK (runtime ${runtimeVersion}): safe to publish an update.`);
  } else {
    console.log(
      `Native code or app config changed since the ${recorded.version} APK (fingerprint ${hash}, recorded ${recorded.hash}). ` +
        'An update would not be safe: build and release a new APK, then run "record". If native code changed, also bump runtimeVersion in app.json.',
    );
    process.exit(1);
  }
} else {
  console.error('Usage: native-fingerprint.mjs record|check');
  process.exit(2);
}
