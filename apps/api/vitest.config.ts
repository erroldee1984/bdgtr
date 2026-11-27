import { defineConfig } from 'vitest/config';

// Coverage targets (docs/PLAN.md §11). Enforced by `pnpm test` (which passes --coverage).
export default defineConfig({
  test: {
    // All files share one test MongoDB (vitest.global-setup.ts); 4 at a time keeps
    // memory modest on small machines and is as fast here.
    maxWorkers: 4,
    globalSetup: ['./vitest.global-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // server.ts only starts the local dev server; test-utils are test helpers.
      exclude: ['src/**/*.test.ts', 'src/test-utils/**', 'src/server.ts'],
      reporter: ['text-summary'],
      thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 },
    },
  },
});
