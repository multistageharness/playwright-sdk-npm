/**
 * Drives a real, visible Chrome window over CDP: opens a FRESH tab in the
 * running window, brings it to the foreground so you can watch the automation
 * live, then extracts the selected element's OUTER HTML and screenshots it.
 *
 * Shared details (url, selector, cdp endpoint) come from ./config.mjs.
 *
 * Two-step workflow (connect to the externally-launched Chrome):
 *
 *   1.  ./chrome-remote-debug.sh          # start a windowed Chrome with CDP enabled
 *   2.  npm run example:connect           # this script connects and drives a fresh tab
 *
 * Because the driver connected (rather than launched), close() only detaches —
 * your Chrome window (and the opened tab) stays open. By default the connection
 * is held open until you press Ctrl+C so you can inspect the tab; set HOLD=0 to
 * detach right away. Stop Chrome with:  ./chrome-remote-debug.sh stop 9222
 */
import { BrowserDriver } from '../src/index.js';
import { config, outPath } from './config.mjs';

const OUT = outPath('existing-window.html');
// Hold the connection open (so the tab stays focused for debugging) unless HOLD=0.
const HOLD = process.env.HOLD !== '0';

async function main(): Promise<void> {
  const driver = new BrowserDriver({
    mode: 'connect',
    cdpEndpoint: config.cdpEndpoint,
    reuseExistingPage: false,
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
