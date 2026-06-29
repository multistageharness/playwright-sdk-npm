/**
 * Page lifecycle state, mirroring Playwright's `page.waitForLoadState()`.
 * - `load`             — the `load` event has fired.
 * - `domcontentloaded` — the DOM is parsed.
 * - `networkidle`      — no network connections for at least 500ms.
 */
export type LoadState = 'load' | 'domcontentloaded' | 'networkidle';

/**
 * How the driver acquires a browser.
 *
 * - `launch`  — start a fresh, isolated Chromium instance managed by the SDK.
 * - `connect` — attach to an already-running Chrome/Chromium over the DevTools
 *               Protocol (CDP). Use this to drive your *existing* Chrome window.
 *               The target Chrome must have been started with
 *               `--remote-debugging-port=<port>` (default 9222). See the README.
 */
export type DriverMode = 'launch' | 'connect';

/** Which browser engine to launch (only used when `mode: 'launch'`). */
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

export interface DriverOptions {
  /** Acquisition strategy. Defaults to `'launch'`. */
  mode?: DriverMode;

  /** Engine to launch. Only applies to `mode: 'launch'`. Defaults to `'chromium'`. */
  engine?: BrowserEngine;

  /** Run with no visible window. Only applies to `mode: 'launch'`. Defaults to `false` (a visible window opens). */
  headless?: boolean;

  /**
   * CDP endpoint to attach to when `mode: 'connect'`.
   * Accepts either an HTTP origin (`http://localhost:9222`) or a websocket URL.
   * Defaults to `http://localhost:9222`.
   */
  cdpEndpoint?: string;

  /**
   * When connecting, reuse the existing window/tab instead of opening a new
   * blank tab. Defaults to `true` so `openUrl()` drives the window you already
   * have open.
   */
  reuseExistingPage?: boolean;

  /** Default timeout (ms) applied to navigation and waits. Defaults to 30000. */
  defaultTimeoutMs?: number;

  /**
   * Disable the page's Content-Security-Policy for the automated session so
   * injected scripts / `evaluate` are never blocked by an `unsafe-eval`
   * policy. Defaults to `true` (CSP-friendly).
   *
   * - launch mode  → applied via `newContext({ bypassCSP: true })`.
   * - connect mode → applied per page via CDP `Page.setBypassCSP`.
   *
   * Note: the SDK's HTML extraction is already eval-free (it uses the CDP DOM
   * domain / native `innerHTML`), so extraction works even with `bypassCSP:
   * false`; this option only matters if you (or the page) inject scripts.
   */
  bypassCSP?: boolean;

  /** User-Agent override for newly created contexts (launch mode only). */
  userAgent?: string;

  /** Extra args passed to the browser process (launch mode only). */
  args?: string[];
}

export interface OpenUrlOptions {
  /**
   * The lifecycle event to wait for during navigation before settling.
   * Defaults to `'load'`.
   */
  waitUntil?: LoadState;

  /**
   * After navigation, also wait for the network to go fully idle (no
   * connections for at least 500ms) before `openUrl` resolves — i.e. wait for
   * the page to *finish* loading, not just fire its `load` event. Defaults to
   * `true`. Pages that hold long-lived connections (analytics beacons,
   * websockets, SSE) may never reach idle; rather than fail, `openUrl` proceeds
   * once the navigation timeout elapses (the DOM is already loaded by then).
   */
  waitForNetworkIdle?: boolean;

  /** Per-call navigation timeout (ms). Falls back to the driver default. */
  timeoutMs?: number;

  /**
   * Activate (focus) the tab in its window before navigating, so you can watch
   * it load — useful for live/visible debugging. Defaults to `false`.
   */
  bringToFront?: boolean;
}

export interface WaitForElementOptions {
  /**
   * Required element state. Mirrors Playwright's locator states.
   * Defaults to `'visible'`.
   */
  state?: 'attached' | 'detached' | 'visible' | 'hidden';

  /** Per-call timeout (ms). Falls back to the driver default. */
  timeoutMs?: number;
}

export interface ExtractHtmlOptions {
  /**
   * `'outer'` returns the element including its own tag (`outerHTML`),
   * `'inner'` returns only its children (`innerHTML`).
   * Defaults to `'outer'`.
   */
  kind?: 'outer' | 'inner';

  /** Per-call timeout (ms) for locating the element. Falls back to the driver default. */
  timeoutMs?: number;
}

export interface SaveOptions {
  /** Text encoding for the written file. Defaults to `'utf-8'`. */
  encoding?: BufferEncoding;

  /** Create parent directories if they don't exist. Defaults to `true`. */
  mkdirp?: boolean;
}
