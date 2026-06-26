/**
 * CSP-friendly extraction.
 *
 * Some sites ship a strict Content-Security-Policy (no `unsafe-eval`). This
 * example loads such a page and extracts its HTML WITHOUT running any page
 * script:
 *   - `extractHtml(selector)` reads outerHTML via the CDP DOM domain (no eval),
 *   - `kind: 'inner'` uses native `innerHTML`,
 *   - `bypassCSP: true` (the default) additionally disables the page CSP for the
 *     session, so even injected scripts would work.
 *
 * Run with:  npm run example:csp
 * Override the page with TARGET_URL=... (defaults to the bundled CSP fixture).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { BrowserDriver } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = 'file://' + resolve(here, 'fixtures/csp-page.html');

const URL = process.env.TARGET_URL ?? FIXTURE;
const OUT = process.env.OUT_FILE ?? 'output/csp-page.html';

async function main(): Promise<void> {
  // bypassCSP defaults to true; pass { bypassCSP: false } to keep the page CSP.
  const driver = new BrowserDriver({
    mode: 'launch',
    headless: process.env.HEADLESS !== '0',
  });

  await driver.launch();
  await driver.openUrl(URL, { waitUntil: 'load' });
  console.log(`Loaded ${URL} (strict CSP, no unsafe-eval).`);

  // Eval-free outerHTML (CDP DOM.getOuterHTML).
  const headline = await driver.extractHtml('#headline');
  console.log('outerHTML  :', headline);

  // Eval-free innerHTML (native).
  const summary = await driver.extractHtml('.card', { kind: 'inner' });
  console.log('innerHTML  :', summary.trim().replace(/\s+/g, ' '));

  const savedPath = await driver.extractAndSave('#headline', OUT);
  console.log(`Saved → ${savedPath}`);

  await driver.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
