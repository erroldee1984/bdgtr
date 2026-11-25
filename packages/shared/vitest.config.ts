import { defineConfig } from 'vitest/config';

// Coverage targets (docs/PLAN.md §11). Enforced by `pnpm test` (which passes --coverage).
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text-summary'],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
