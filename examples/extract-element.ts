/**
 * End-to-end example matching the SDK's core flow:
 *   launch → open URL → wait for load → wait for element → extract HTML → save.
 *
 * By default the window is left OPEN so you can see the loaded tab — the script
 * waits until you press Ctrl+C. (Without this, the browser navigates and closes
 * in a split second, so on a virtual/remote desktop the tab just "flashes by".)
 *
 * Env vars:
 *   HEADLESS=1   run without a visible window
 *   HOLD_MS=0    close immediately after saving (the old behavior)
 *   HOLD_MS=N    keep the window open for N milliseconds, then close
 *
 * Note: a launch-mode browser is a child of this Node process, so it closes
 * when the script exits. For a window that persists after the terminal closes,
 * use ./chrome-remote-debug.sh + the connect example instead.
 *
 * Run with:  npm run example
 */
import { BrowserDriver } from '../src/index.js';

const URL = process.env.TARGET_URL ?? 'https://example.com';
const SELECTOR = process.env.TARGET_SELECTOR ?? 'h1';
const OUT = process.env.OUT_FILE ?? 'output/element.html';
const HOLD_MS = process.env.HOLD_MS !== undefined ? Number(process.env.HOLD_MS) : null;

async function main(): Promise<void> {
  // Non-headless: a real Chromium window opens and the tab loads visibly.
  // Set HEADLESS=1 to run without a window.
  const driver = new BrowserDriver({
    mode: 'launch',
    headless: process.env.HEADLESS === '1',
  });

  await driver.launch();
  console.log(`Launched. Opening ${URL} …`);

  await driver.openUrl(URL, { waitUntil: 'load' });
  await driver.waitForLoad('networkidle');
  console.log('Page loaded.');

  await driver.waitForElement(SELECTOR, { state: 'visible' });
  console.log(`Element "${SELECTOR}" is visible.`);

  const savedPath = await driver.extractAndSave(SELECTOR, OUT, { kind: 'outer' });
  console.log(`Saved ${SELECTOR} HTML → ${savedPath}`);

  if (HOLD_MS === 0) {
    // HOLD_MS=0 → close immediately (old behavior).
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
