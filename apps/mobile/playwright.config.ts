import { defineConfig, devices } from '@playwright/test';

/** Accessibility checks against the exported website (e2e/a11y.spec.ts). Build first: `pnpm build:web`. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: 'http://localhost:4321', ...devices['Desktop Chrome'] },
  webServer: { command: 'node e2e/serve.mjs dist 4321', url: 'http://localhost:4321/privacy', reuseExistingServer: !process.env.CI },
});
