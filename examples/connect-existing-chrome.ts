/**
 * Drives your *existing* Chrome window instead of launching a fresh browser.
 *
 * 1. Quit Chrome completely, then start it with remote debugging enabled:
 *
 *      macOS:
 *        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *          --remote-debugging-port=9222
 *
 *      Linux:
 *        google-chrome --remote-debugging-port=9222
 *
 *      Windows:
 *        "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 *
 * 2. Run:  npm run example:connect
 *
 * Because the driver connected (rather than launched), close() detaches and
 * leaves your Chrome window open.
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
