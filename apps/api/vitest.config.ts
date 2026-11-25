import { defineConfig } from 'vitest/config';

// Coverage targets (docs/PLAN.md §11). Enforced by `pnpm test` (which passes --coverage).
export default defineConfig({
  test: {
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
