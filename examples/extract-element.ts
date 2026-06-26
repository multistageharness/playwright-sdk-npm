/**
 * End-to-end example matching the SDK's core flow:
 *   launch → open URL → wait for load → wait for element → extract HTML → save.
 *
 * Run with:  npm run example
 */
import { BrowserDriver } from '../src/index.js';

const URL = process.env.TARGET_URL ?? 'https://example.com';
const SELECTOR = process.env.TARGET_SELECTOR ?? 'h1';
const OUT = process.env.OUT_FILE ?? 'output/element.html';

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

  await driver.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
