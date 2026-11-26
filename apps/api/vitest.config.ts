import { defineConfig } from 'vitest/config';

// Coverage targets (docs/PLAN.md §11). Enforced by `pnpm test` (which passes --coverage).
export default defineConfig({
  test: {
    // Each test file starts its own MongoDB (mongodb-memory-server), which refuses to
    // start with < 500 MB free where it keeps its files (the OS temp dir). On machines
    // where /tmp is a small RAM disk (e.g. WSL), 16 at once ran out; 4 at a time fits.
    maxWorkers: 4,
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
