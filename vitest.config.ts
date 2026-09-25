import { defineConfig } from 'vitest/config';

// Synthetic tests only: they run in CI and never read local/.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
