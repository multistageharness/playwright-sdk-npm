/**
 * Drives your *existing* Chrome window instead of launching a fresh browser.
 *
 * 1. Start a windowed Chrome with remote debugging enabled. The bundled helper
 *    does this and prints a session id + CDP endpoint to use:
 *
 *      ./chrome-remote-debug.sh            # default port 9222
 *
 * 2. Run this example, pointing it at the printed endpoint:
 *
 *      CDP_ENDPOINT=http://localhost:9222 npm run example:connect
 *
 * Because the driver connected (rather than launched), close() detaches and
 * leaves your Chrome window open. Stop Chrome with:
 *
 *      ./chrome-remote-debug.sh stop 9222
 */
import { BrowserDriver } from '../src/index.js';

const URL = process.env.TARGET_URL ?? 'https://example.com';
const SELECTOR = process.env.TARGET_SELECTOR ?? 'h1';
const OUT = process.env.OUT_FILE ?? 'output/existing-window.html';

async function main(): Promise<void> {
  const driver = new BrowserDriver({
    mode: 'connect',
    cdpEndpoint: process.env.CDP_ENDPOINT ?? 'http://localhost:9222',
    reuseExistingPage: true, // drive the tab you already have open
  });

  await driver.launch();
  console.log('Connected to existing Chrome.');

  await driver.openUrl(URL, { waitUntil: 'load' });
  await driver.waitForElement(SELECTOR);

  const savedPath = await driver.extractAndSave(SELECTOR, OUT);
  console.log(`Saved ${SELECTOR} HTML → ${savedPath}`);

  await driver.close(); // detaches only; your Chrome stays open
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
