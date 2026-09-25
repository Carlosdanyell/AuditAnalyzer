import { defineConfig } from 'vitest/config';

// Tests against real files in local/ (developer machine only; skipped when local/ is absent).
export default defineConfig({
  test: {
    include: ['tests/local/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
