/**
 * Shared configuration for every example.
 *
 * All examples import this module so they target the SAME url / selector /
 * endpoint and stay consistent. Override any value with an environment variable.
 */
export const config = {
  /** Page to open. (env: TARGET_URL) */
  url: process.env.TARGET_URL ?? 'https://playwright.dev',

  /** Element whose OUTER HTML the examples extract. (env: TARGET_SELECTOR) */
  selector: process.env.TARGET_SELECTOR ?? 'h1',

  /** What to extract from the selected element: 'outer' (outerHTML) or 'inner'. */
  htmlKind: process.env.HTML_KIND === 'inner' ? 'inner' : 'outer',

  /** CDP endpoint for the connect example. (env: CDP_ENDPOINT) */
  cdpEndpoint: process.env.CDP_ENDPOINT ?? 'http://localhost:9222',

  /** Launch headless? (env: HEADLESS=1) */
  headless: process.env.HEADLESS === '1',

  /** Directory for saved output. (env: OUT_DIR) */
  outDir: process.env.OUT_DIR ?? 'output',
};

/** Resolve a file name inside the configured output directory. */
export function outPath(name) {
  return `${config.outDir}/${name}`;
}
