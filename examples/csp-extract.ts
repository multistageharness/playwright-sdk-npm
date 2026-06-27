/**
 * CSP-friendly extraction from the configured URL.
 *
 * Some sites ship a strict Content-Security-Policy (no `unsafe-eval`). This
 * example extracts the selected element's OUTER HTML from the SAME url as the
 * other examples (./config.mjs) WITHOUT running any page script:
 *   - `extractHtml(selector, { kind: 'outer' })` reads outerHTML via the CDP DOM
 *     domain (no eval),
 *   - `bypassCSP: true` (the SDK default) additionally disables the page CSP for
 *     the session, so even injected scripts would work.
 *
 * Run with:  npm run example:csp
 * Point it at a strict-CSP page to really exercise it, e.g.
 *   TARGET_URL='https://your-strict-csp-site' npm run example:csp
 * A bundled strict-CSP fixture is available too:
 *   TARGET_URL="file://$PWD/examples/fixtures/csp-page.html" TARGET_SELECTOR='#headline' npm run example:csp
 */
import { BrowserDriver } from '../src/index.js';
import { config, outPath } from './config.mjs';

const OUT = outPath('csp-page.html');

async function main(): Promise<void> {
  // bypassCSP defaults to true; pass { bypassCSP: false } to keep the page CSP
  // (extraction is eval-free, so it works either way).
  const driver = new BrowserDriver({ mode: 'launch', headless: config.headless });

  await driver.launch();
  await driver.openUrl(config.url, { waitUntil: 'load' });
  console.log(`Loaded ${config.url} (CSP-friendly, eval-free extraction).`);

  await driver.waitForElement(config.selector, { state: 'attached' });

  // Extract the OUTER HTML of the selected element — no page script runs, so a
  // strict `unsafe-eval` CSP is never tripped.
  const outerHtml = await driver.extractHtml(config.selector, { kind: 'outer' });
  console.log(`outerHTML of "${config.selector}":\n${outerHtml}`);

  const savedPath = await driver.saveToDisk(outerHtml, OUT);
  console.log(`Saved → ${savedPath}`);

  await driver.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
