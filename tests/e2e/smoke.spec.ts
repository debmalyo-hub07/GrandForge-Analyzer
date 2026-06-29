import { test, expect } from '@playwright/test';
import { gotoApp, BOARD_SELECTOR } from './helpers';

test.describe('smoke', () => {
  test('app loads, is cross-origin isolated, core UI present', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await gotoApp(page);

    // Board renders (64 squares).
    await expect(page.locator(BOARD_SELECTOR).first()).toBeVisible();
    expect(await page.locator('[data-square]').count()).toBe(64);

    // COOP + COEP(credentialless) must make the page cross-origin isolated, which
    // is what unlocks SharedArrayBuffer for the multi-threaded engine build. If
    // this is false the headers regressed.
    const isolated = await page.evaluate(() => self.crossOriginIsolated === true);
    expect(isolated, 'page must be cross-origin isolated (COOP/COEP)').toBe(true);

    // Side-panel tabs.
    await expect(page.getByRole('tab', { name: /analysis/i })).toBeVisible();

    // Eval bar (always rendered) shows a score label.
    await expect(page.locator('.eval-label').first()).toBeVisible();

    // No uncaught exceptions during boot. (Network 5xx from the /api proxy is
    // expected in the E2E env and does not surface as a pageerror.)
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
