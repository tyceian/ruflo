/**
 * Step 13 placeholder so `npm run test:e2e` returns 0 even before
 * Step 14 lands real smoke tests.
 *
 * This file exists primarily to:
 *   1. Confirm Playwright config resolves
 *   2. Confirm the testDir + testMatch glob picks up *.spec.ts
 *   3. Verify the webServer hook (auto-start `npm run dev`) works
 *
 * Step 14 deletes/renames this file when it adds smoke.spec.ts.
 */

import { test, expect } from '@playwright/test';

test('placeholder — Playwright harness is wired', async ({ page }) => {
  // Touches the dev server but doesn't assert anything UI-specific
  // (Step 14 covers route loads + zero console errors).
  const resp = await page.goto('/');
  expect(resp?.status()).toBe(200);
});
