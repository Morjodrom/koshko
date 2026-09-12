import { chromium, expect, test } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extensionPath = resolve(process.cwd(), 'apps/extension/.output/chrome-mv3-dev/chrome-mv3');

test.describe('extension coexistence smoke', () => {
  test.skip(!process.env.KOSHKO_RUN_EXTENSION_SMOKE, 'Set KOSHKO_RUN_EXTENSION_SMOKE=1 after building the unpacked extension.');

  test('receives a capture over a real MV3 runtime port while the embedded inspector is active', async () => {
    test.skip(!existsSync(extensionPath), 'Run npm run build --workspace=@koshko/extension first.');
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'koshko-extension-'));
    const fixtureExtensionPath = join(fixtureRoot, 'extension');
    cpSync(extensionPath, fixtureExtensionPath, { recursive: true });
    const manifestPath = join(fixtureExtensionPath, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    // Avoid an unautomatable browser permission bubble without widening the
    // production manifest: only this temporary unpacked copy gets localhost.
    manifest.host_permissions = ['http://127.0.0.1/*'];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    let context: import('@playwright/test').BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: false,
        args: [`--disable-extensions-except=${fixtureExtensionPath}`, `--load-extension=${fixtureExtensionPath}`],
      });
      await expect.poll(() => context.serviceWorkers().length).toBeGreaterThan(0);
      const extensionWorker = context.serviceWorkers()[0]!;
      const extensionId = new URL(extensionWorker.url()).host;
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await expect(options.locator('#origin-list')).toContainText('http://127.0.0.1');

      const page = await context.newPage();
      await page.goto('http://127.0.0.1:5173');
      await page.bringToFront();
      const tabId = await options.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id === undefined) throw new Error('Demo tab is unavailable.');
        return tab.id;
      });
      await options.evaluate((id) => {
        const port = chrome.runtime.connect({ name: `koshko-panel:${id}` });
        (window as Window & { __koshkoPort?: chrome.runtime.Port; __koshkoCaptures?: unknown[] }).__koshkoPort = port;
        (window as Window & { __koshkoCaptures?: unknown[] }).__koshkoCaptures = [];
        port.onMessage.addListener((message) => (window as Window & { __koshkoCaptures?: unknown[] }).__koshkoCaptures?.push(message));
      }, tabId);
      await page.reload();
      await page.getByRole('button', { name: 'Run successful flow' }).click();
      await expect(page.frameLocator('#koshko-inspector').getByTestId('capture-status')).not.toContainText('0 events captured');
      await expect.poll(() => options.evaluate(() => {
        const captures = (window as Window & { __koshkoCaptures?: Array<{ type?: unknown }> }).__koshkoCaptures ?? [];
        return captures.filter((message) => message.type === 'koshko:capture').length;
      })).toBeGreaterThan(0);
    } finally {
      await context?.close();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
