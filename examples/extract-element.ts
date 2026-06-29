/**
 * End-to-end example matching the SDK's core flow:
 *   connect → open URL → wait for load → wait for element → extract OUTER HTML → save.
 *
 * Shared details (url, selector, cdp endpoint, output dir) come from ./config.mjs
 * so every example stays consistent.
 *
 * Two-step workflow (all examples connect to the SAME externally-launched Chrome):
 *
 *   1.  ./chrome-remote-debug.sh          # start a windowed Chrome with CDP enabled
 *   2.  npm run example                   # this script connects and drives a fresh tab
 *
 * The example opens a FRESH tab in the running Chrome and brings it to front, so you
 * can watch it load. Because the driver connected (rather than launched), close()
 * only detaches — your Chrome window and the opened tab stay open.
 *
 * Env vars:
 *   HOLD_MS=0    detach immediately after saving
 *   HOLD_MS=N    keep the tab focused for N milliseconds, then detach
 *   (see ./config.mjs for TARGET_URL / TARGET_SELECTOR / CDP_ENDPOINT / OUT_DIR)
 *
 * Run with:  npm run example
 */
import { BrowserDriver } from '../src/index.js';
import { config, outPath } from './config.mjs';

const OUT = outPath('element.html');
const HOLD_MS = process.env.HOLD_MS !== undefined ? Number(process.env.HOLD_MS) : null;

async function main(): Promise<void> {
  // Connect-only: attach to the Chrome launched by ./chrome-remote-debug.sh and
  // open a fresh tab to drive (never reuse the user's current tab).
  const driver = new BrowserDriver({
    mode: 'connect',
    cdpEndpoint: config.cdpEndpoint,
    reuseExistingPage: false,
  });

  await driver.launch();
  console.log(`Connected. Opening ${config.url} in a fresh tab …`);

  // openUrl navigates, then waits for the network to go idle (fully loaded).
  // bringToFront makes the driven tab the foreground tab so you can watch it load.
  await driver.openUrl(config.url, { bringToFront: true });
  console.log('Page loaded (network idle).');

  // Then wait for the target element (returns at once if it's already present).
  await driver.waitForElement(config.selector, { state: 'visible' });
  console.log(`Element "${config.selector}" is visible.`);

  // Extract the OUTER HTML of the selected element (the element incl. its own tag).
  const outerHtml = await driver.extractHtml(config.selector, { kind: 'outer' });
  console.log(`outerHTML of "${config.selector}":\n${outerHtml}`);

  const savedPath = await driver.saveToDisk(outerHtml, OUT);
  console.log(`Saved → ${savedPath}`);

  if (HOLD_MS === 0) {
    // HOLD_MS=0 → detach immediately.
  } else if (HOLD_MS && HOLD_MS > 0) {
    console.log(`Holding the tab focused for ${HOLD_MS}ms …`);
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
  } else {
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
