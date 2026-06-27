/**
 * Drives a real, visible Chrome window over CDP and opens the tab in the ACTIVE
 * window so you can watch the automation live (active debugging), then extracts
 * the selected element's OUTER HTML.
 *
 * Shared details (url, selector, cdp endpoint) come from ./config.mjs.
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
import { config, outPath } from './config.mjs';

const OUT = outPath('existing-window.html');
// Reuse the current tab instead of opening a new one with REUSE_TAB=1.
const REUSE_TAB = process.env.REUSE_TAB === '1';
// Hold the connection open (so the tab stays focused for debugging) unless HOLD=0.
const HOLD = process.env.HOLD !== '0';

async function main(): Promise<void> {
  const driver = new BrowserDriver({
    mode: 'connect',
    cdpEndpoint: config.cdpEndpoint,
    // Open a fresh tab in the active window (default), or drive the current tab.
    reuseExistingPage: REUSE_TAB,
  });

  await driver.launch();
  console.log('Connected to Chrome. Opening tab in the active window …');

  // bringToFront makes the driven tab the foreground tab so you can watch it.
  await driver.openUrl(config.url, { waitUntil: 'load', bringToFront: true });
  await driver.waitForElement(config.selector);
  console.log(`Loaded ${config.url} — element "${config.selector}" is visible.`);

  // Extract the OUTER HTML of the selected element.
  const outerHtml = await driver.extractHtml(config.selector, { kind: 'outer' });
  console.log(`outerHTML of "${config.selector}":\n${outerHtml}`);

  const savedPath = await driver.saveToDisk(outerHtml, OUT);
  console.log(`Saved → ${savedPath}`);

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
