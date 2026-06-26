/**
 * Drives a real, visible Chrome window over CDP and opens the tab in the ACTIVE
 * window so you can watch the automation live (active debugging).
 *
 * 1. Start a windowed Chrome with remote debugging enabled. The bundled helper
 *    does this and prints a session id + CDP endpoint to use:
 *
 *      ./chrome-remote-debug.sh            # default port 9222
 *
 * 2. Run this example, pointing it at the printed endpoint (http or ws):
 *
 *      CDP_ENDPOINT=http://localhost:9222 npm run example:connect
 *
 * A NEW tab opens in the active window and is brought to the foreground, then
 * the page loads visibly. By default the connection is held open until you
 * press Ctrl+C so you can inspect/debug the tab; set HOLD=0 to detach right away.
 *
 * Because the driver connected (rather than launched), close() only detaches —
 * your Chrome window (and the opened tab) stays open. Stop Chrome with:
 *
 *      ./chrome-remote-debug.sh stop 9222
 */
import { BrowserDriver } from '../src/index.js';

const URL = process.env.TARGET_URL ?? 'https://example.com';
const SELECTOR = process.env.TARGET_SELECTOR ?? 'h1';
const OUT = process.env.OUT_FILE ?? 'output/existing-window.html';
// Reuse the current tab instead of opening a new one with REUSE_TAB=1.
const REUSE_TAB = process.env.REUSE_TAB === '1';
// Hold the connection open (so the tab stays focused for debugging) unless HOLD=0.
const HOLD = process.env.HOLD !== '0';

async function main(): Promise<void> {
  const driver = new BrowserDriver({
    mode: 'connect',
    cdpEndpoint: process.env.CDP_ENDPOINT ?? 'http://localhost:9222',
    // Open a fresh tab in the active window (default), or drive the current tab.
    reuseExistingPage: REUSE_TAB,
  });

  await driver.launch();
  console.log('Connected to Chrome. Opening tab in the active window …');

  // bringToFront makes the driven tab the foreground tab so you can watch it.
  await driver.openUrl(URL, { waitUntil: 'load', bringToFront: true });
  await driver.waitForElement(SELECTOR);
  console.log(`Loaded ${URL} — element "${SELECTOR}" is visible in the window.`);

  const savedPath = await driver.extractAndSave(SELECTOR, OUT);
  console.log(`Saved ${SELECTOR} HTML → ${savedPath}`);

  // Visual proof the tab was created and rendered — works even with no display
  // (e.g. a remote/headless box where you can't see the window).
  const shotPath = await driver.screenshot(OUT.replace(/\.html?$/i, '') + '.png');
  console.log(`Saved screenshot → ${shotPath}`);

  if (HOLD) {
    console.log('Tab is open and focused. Press Ctrl+C to detach (Chrome stays open).');
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }

  await driver.close(); // detaches only; your Chrome and the tab stay open
  console.log('Detached.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
