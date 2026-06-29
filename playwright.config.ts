import { defineConfig, devices } from '@playwright/test';

/**
 * GrandForge E2E config.
 *
 * Tests run against the Vite dev server (port 5173), which sets the COOP +
 * COEP(credentialless) headers that make the page cross-origin isolated — the
 * same isolation production serves via vercel.json. The engine (Stockfish WASM)
 * and the review pipeline both run fully in the browser, so the core specs need
 * no API/MongoDB; the dev server's /api proxy may 5xx and tests tolerate it.
 *
 * Engine analysis and game review are genuinely slow (WASM load + search), so
 * timeouts are generous and workers are capped to avoid thrashing one CPU with
 * several concurrent engine instances.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'on-first-retry',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run web:dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
