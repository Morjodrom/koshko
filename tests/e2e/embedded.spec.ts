import { expect, test } from '@playwright/test';

function inspector(page: import('@playwright/test').Page) {
  return page.frameLocator('#koshko-inspector');
}

test.describe('embedded Koshko Inspector', () => {
  test('captures top-level and registered widget signals independently', async ({ page }) => {
    await page.goto('/');
    const panel = inspector(page);
    await expect(panel.getByTestId('capture-status')).toContainText('0 events captured');

    await page.getByRole('button', { name: 'Run successful flow' }).click();

    await expect(panel.getByTestId('capture-status')).not.toContainText('0 events captured');
    await panel.getByRole('button', { name: 'Log', exact: true }).click();
    await expect(panel.locator('[data-signal-name="user.checkout.requested"]')).toHaveCount(1);
    await expect(panel.locator('[data-signal-name="widget.command.received"]')).toHaveCount(2);
  });

  test('supports state, Nano Stores, filters, pause, clear, and export', async ({ page }) => {
    await page.goto('/');
    const panel = inspector(page);
    await page.getByRole('button', { name: 'Add global state' }).click();
    await page.getByRole('button', { name: 'Increment counter' }).click();

    await panel.getByRole('button', { name: 'Global State' }).click();
    await expect(panel.getByTestId('global-state')).toContainText('nanostores');
    await expect(panel.getByTestId('global-state')).toContainText('demo');

    await page.getByRole('button', { name: 'Run metadata-rich flow' }).click();
    await page.evaluate(() => console.error('embedded inspector e2e error'));
    await panel.getByRole('button', { name: 'Log', exact: true }).click();
    await panel.getByLabel('Search log').fill('metadata');
    await expect(panel.locator('[data-signal-name="user.demo.inspected"]')).toHaveCount(1);
    await panel.getByLabel('Search log').fill('embedded inspector e2e error');
    await expect(panel.locator('[data-error-name="console.error"]')).toHaveCount(1);

    await panel.getByTestId('pause-button').click();
    const pausedStatus = panel.getByTestId('capture-status');
    await page.getByRole('button', { name: 'Run failure and recovery' }).click();
    await expect(pausedStatus).toContainText('paused');
    await panel.getByTestId('pause-button').click();
    await expect(panel.getByTestId('capture-status')).not.toContainText('paused');

    const download = page.waitForEvent('download');
    await panel.getByTestId('export-button').click();
    expect((await download).suggestedFilename()).toBe('koshko.jsonl');

    await panel.getByTestId('clear-button').click();
    await expect(panel.getByTestId('capture-status')).toContainText('0 events captured');
  });

  test('rejects spoofed observers, stacks on narrow displays, and starts clean after reload', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto('/');
    const panel = inspector(page);
    await expect(page.locator('#koshko-inspector-dock')).toHaveCSS('border-top-width', '1px');

    await page.evaluate(() => {
      window.postMessage({
        protocol: 'koshko:demo-observer', version: 1, type: 'capture',
        capture: { kind: 'signal', observedAt: Date.now(), navigationId: 'spoof', frameUrl: location.href, frameOrigin: location.origin },
      }, location.origin);
    });
    await expect(panel.getByTestId('capture-status')).toContainText('0 events captured');

    await page.getByRole('button', { name: 'Run successful flow' }).click();
    await expect(panel.getByTestId('capture-status')).not.toContainText('0 events captured');
    await page.reload();
    await expect(inspector(page).getByTestId('capture-status')).toContainText('0 events captured');
  });

  test('collapses, expands, and accepts a deterministic dock width', async ({ page }) => {
    await page.setViewportSize({ width: 1_400, height: 900 });
    await page.goto('/');
    const dock = page.locator('#koshko-inspector-dock');
    const inspectorFrame = page.locator('#koshko-inspector');
    await expect(dock).toHaveCSS('resize', 'horizontal');

    await page.getByRole('button', { name: 'Hide inspector', exact: true }).click();
    await expect(inspectorFrame).toBeHidden();
    await page.getByRole('button', { name: 'Show inspector', exact: true }).click();
    await expect(inspectorFrame).toBeVisible();

    await dock.evaluate((element) => { element.style.width = '480px'; });
    await expect.poll(() => dock.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(480);
  });

  test('does not replay acknowledged history after inspector reconnect', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Run successful flow' }).click();
    await expect(inspector(page).getByTestId('capture-status')).not.toContainText('0 events captured');

    await page.locator('#koshko-inspector').evaluate((element: HTMLIFrameElement) => element.contentWindow?.location.reload());
    await expect(inspector(page).getByTestId('capture-status')).toContainText('0 events captured');
    await page.getByRole('button', { name: 'Run failure and recovery' }).click();
    await expect(inspector(page).getByTestId('capture-status')).not.toContainText('0 events captured');
  });
});
