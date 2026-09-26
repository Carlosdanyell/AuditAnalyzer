import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (docs/INTERFACE.md): the production build served by `vite preview`, with the real CSP, driven
 * through the screens with synthetic files. Locally they use the installed Chrome (E2E_CHANNEL overrides, e.g.
 * msedge); in CI, the Chromium downloaded by Playwright.
 */
const PORT = 4173;
const channel = process.env.CI ? undefined : (process.env.E2E_CHANNEL ?? 'chrome');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/AuditAnalyzer/`,
    acceptDownloads: true,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(channel && { channel }) } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/AuditAnalyzer/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
