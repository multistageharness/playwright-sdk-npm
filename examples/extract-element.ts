/**
 * End-to-end example matching the SDK's core flow:
 *   launch → open URL → wait for load → wait for element → extract OUTER HTML → save.
 *
 * Shared details (url, selector, headless, output dir) come from ./config.mjs so
 * every example stays consistent.
 *
 * By default the window is left OPEN so you can see the loaded tab — the script
 * waits until you press Ctrl+C. (Without this, the browser navigates and closes
 * in a split second, so on a virtual/remote desktop the tab just "flashes by".)
 *
 * Env vars:
 *   HOLD_MS=0    close immediately after saving (the old behavior)
 *   HOLD_MS=N    keep the window open for N milliseconds, then close
 *   (see ./config.mjs for TARGET_URL / TARGET_SELECTOR / HEADLESS / OUT_DIR)
 *
 * Note: a launch-mode browser is a child of this Node process, so it closes
 * when the script exits. For a window that persists after the terminal closes,
 * use ./chrome-remote-debug.sh + the connect example instead.
 *
 * Run with:  npm run example
 */
import { BrowserDriver } from '../src/index.js';
import { config, outPath } from './config.mjs';

const OUT = outPath('element.html');
const HOLD_MS = process.env.HOLD_MS !== undefined ? Number(process.env.HOLD_MS) : null;

async function main(): Promise<void> {
  // Non-headless by default: a real Chromium window opens and the tab loads
  // visibly. Set HEADLESS=1 to run without a window.
  const driver = new BrowserDriver({ mode: 'launch', headless: config.headless });

  await driver.launch();
  console.log(`Launched. Opening ${config.url} …`);

  await driver.openUrl(config.url, { waitUntil: 'load' });
  await driver.waitForLoad('networkidle');
  console.log('Page loaded.');

  await driver.waitForElement(config.selector, { state: 'visible' });
  console.log(`Element "${config.selector}" is visible.`);

  // Extract the OUTER HTML of the selected element (the element incl. its own tag).
  const outerHtml = await driver.extractHtml(config.selector, { kind: 'outer' });
  console.log(`outerHTML of "${config.selector}":\n${outerHtml}`);

  const savedPath = await driver.saveToDisk(outerHtml, OUT);
  console.log(`Saved → ${savedPath}`);

  if (HOLD_MS === 0) {
    // HOLD_MS=0 → close immediately.
  } else if (HOLD_MS && HOLD_MS > 0) {
    console.log(`Holding the window open for ${HOLD_MS}ms …`);
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
  } else {
    console.log('Browser is open — the tab is loaded. Press Ctrl+C to close.');
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }

  await driver.close();
  console.log('Closed.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
