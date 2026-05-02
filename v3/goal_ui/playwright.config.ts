/**
 * Playwright config for v3/goal_ui/ end-to-end tests.
 *
 * Step 13 (ADR-093). Subsequent steps fill in:
 *   Step 14 — smoke tests (4 routes load with 0 console errors)
 *   Step 16 — UI element coverage (≥30 assertions per ui-inventory.md)
 *   Step 17 — workflow E2E with Supabase / functions stubbed
 *
 * Trace + screenshots + video on failure only — keeps CI artifacts
 * small but gives full debug context when things break.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  /** Match `*.spec.ts` files only — keeps utility helpers out. */
  testMatch: /.*\.spec\.ts/,

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    // HTML report is only useful interactively; suppress auto-open in CI
    ['html', { open: 'never', outputFolder: 'tests/e2e/__report__' }],
  ],

  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /** Global per-action timeout — keeps tests from hanging on missing elements. */
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  /** Spin up `npm run dev` automatically when running tests. */
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Add 'firefox' / 'webkit' projects later if/when cross-browser
    // coverage is needed for the widget embed scenario.
  ],
});
