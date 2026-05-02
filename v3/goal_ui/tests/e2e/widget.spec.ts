/**
 * Widget verification — Step 24 (ADR-093).
 *
 * Loads `public/widget-test.html` (a minimal embedder) via the
 * dev server. Asserts:
 *   - widget.js loads (HTTP 200, no `Failed to load resource`)
 *   - the widget bootstraps (window.RufloResearchWidget present)
 *   - the container gets populated by the widget's mount
 *   - CSP envelope (same as main app per Step 22d) doesn't block
 *     any of widget.js's runtime needs — no console.error
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

function attachConsoleErrorGuard(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGE_ERROR: ' + e.message));
  page.on('weberror', (e) => errors.push('WEB_ERROR: ' + e.error().message));
  return { errors, warnings };
}

test.describe('widget — embeds cleanly under same-origin CSP', () => {
  test('widget.js loads, mounts, and renders without console errors', async ({ page }) => {
    const guard = attachConsoleErrorGuard(page);

    // Track network status of widget.js and widget.css
    const widgetJsResponses: number[] = [];
    const widgetCssResponses: number[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('/widget.js')) widgetJsResponses.push(r.status());
      if (r.url().endsWith('/widget.css')) widgetCssResponses.push(r.status());
    });

    const resp = await page.goto('/widget-test.html');
    expect(resp?.status()).toBe(200);

    // Page heading visible (sanity)
    await expect(page.getByTestId('page-heading')).toHaveText('Widget Test Page');

    // Probe window.RufloResearchWidget — IIFE bundle assigns to window.
    // Poll via waitForFunction (some bundles take a tick to attach).
    await page.waitForFunction(
      () => typeof (window as unknown as { RufloResearchWidget?: unknown }).RufloResearchWidget !== 'undefined',
      null,
      { timeout: 15000 }
    );

    // Widget container should have been populated by the mounted widget
    const containerHasContent = await page.evaluate(() => {
      const c = document.getElementById('ruflo-research-widget-container');
      return c ? (c.children.length > 0 || (c.textContent ?? '').trim().length > 0) : false;
    });
    expect(containerHasContent, 'widget should populate its container').toBe(true);

    // widget.js + widget.css both loaded with 200
    expect(widgetJsResponses, 'widget.js fetched').toContain(200);
    expect(widgetCssResponses, 'widget.css fetched').toContain(200);

    // Settle async error-boundary triggers + log any CSP violations
    await page.waitForTimeout(1000);
    expect(guard.errors, 'no console errors during widget mount').toEqual([]);
  });
});
