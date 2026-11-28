/**
 * Over-the-air updates (docs/PLAN.md §2c): an update must be built with the
 * same public settings as the production APK, or phones would run a bundle
 * pointing at the wrong server or Clerk instance.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const workflow = readFileSync(join(root, '..', '..', '.github', 'workflows', 'app-update.yml'), 'utf8');
const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;

describe('Android app update workflow', () => {
  it('publishes with exactly the production build’s EXPO_PUBLIC_ settings', () => {
    const env: Record<string, string> = eas.build.production.env;
    expect(Object.keys(env).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(env)) expect(workflow).toContain(`${key}: ${value}`);
  });

  it('publishes to the channel the production APK listens on, and only after the native-change guard', () => {
    expect(eas.build.production.channel).toBe('production');
    expect(workflow).toContain('--channel production');
    expect(workflow).toMatch(/native-fingerprint\.mjs check[\s\S]*if: steps\.guard\.outputs\.safe == 'true'/);
  });

  it('the app takes updates from this project, matched by a fixed runtime version recorded with the released APK', () => {
    expect(app.updates.url).toBe(`https://u.expo.dev/${app.extra.eas.projectId}`);
    expect(typeof app.runtimeVersion).toBe('string');
    const recorded = JSON.parse(readFileSync(join(root, 'native-fingerprint.json'), 'utf8'));
    expect(recorded.runtimeVersion).toBe(app.runtimeVersion);
    expect(recorded.version).toBe(app.version); // record again after each APK release
  });
});
