import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Locator,
  type Page,
} from 'playwright';

import {
  BrowserDriverError,
  ElementNotFoundError,
  NoActivePageError,
  NotLaunchedError,
} from './errors.js';
import type {
  DriverOptions,
  ExtractHtmlOptions,
  LoadState,
  OpenUrlOptions,
  SaveOptions,
  WaitForElementOptions,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CDP_ENDPOINT = 'http://localhost:9222';

const ENGINES: Record<NonNullable<DriverOptions['engine']>, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

/**
 * Conservatively decide whether a selector is a plain CSS selector that the CDP
 * `DOM.querySelector` can resolve. Playwright engine selectors (text=, xpath=,
 * chained `>>`, `:has-text(...)`, etc.) are not CSS — those fall back to the
 * isolated-world evaluate path.
 */
function isPlainCssSelector(selector: string): boolean {
  const s = selector.trim();
  if (/^(text|xpath|css|id|data-testid|role|internal:)\s*=/i.test(s)) return false;
  if (s.startsWith('//') || s.startsWith('..')) return false; // xpath
  if (s.includes('>>')) return false; // chained engines
  if (/:(has-text|text|visible|nth-match|has|near|right-of|left-of|above|below)\b/.test(s)) {
    return false;
  }
  return true;
}

/**
 * High-level wrapper around Playwright that exposes a small, task-focused API:
 * launch (or connect to) a browser, open a URL, wait for it / for an element,
 * extract HTML, and save it to disk.
 *
 * @example
 * ```ts
 * const driver = new BrowserDriver({ headless: true });
 * await driver.launch();
 * await driver.openUrl('https://example.com');
 * await driver.waitForElement('h1');
 * await driver.extractAndSave('h1', 'output/heading.html');
 * await driver.close();
 * ```
 */
export class BrowserDriver {
  private readonly options: Required<
    Pick<
      DriverOptions,
      'mode' | 'engine' | 'headless' | 'cdpEndpoint' | 'reuseExistingPage' | 'defaultTimeoutMs' | 'bypassCSP'
    >
  > &
    DriverOptions;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(options: DriverOptions = {}) {
    this.options = {
      mode: options.mode ?? 'launch',
      engine: options.engine ?? 'chromium',
      headless: options.headless ?? false,
      cdpEndpoint: options.cdpEndpoint ?? DEFAULT_CDP_ENDPOINT,
      reuseExistingPage: options.reuseExistingPage ?? true,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      bypassCSP: options.bypassCSP ?? true,
      userAgent: options.userAgent,
      args: options.args,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Acquire a browser according to the configured `mode`.
   * - `launch`  → starts a fresh browser the driver owns and will close.
   * - `connect` → attaches to an existing Chrome over CDP; `close()` only
   *               detaches and leaves your window running.
   */
  async launch(): Promise<this> {
    if (this.browser) return this; // idempotent

    if (this.options.mode === 'connect') {
      await this.connectOverCdp();
    } else {
      await this.launchFresh();
    }

    this.context?.setDefaultTimeout(this.options.defaultTimeoutMs);
    this.context?.setDefaultNavigationTimeout(this.options.defaultTimeoutMs);
    return this;
  }

  private async launchFresh(): Promise<void> {
    const browserType = ENGINES[this.options.engine];
    try {
      this.browser = await browserType.launch({
        headless: this.options.headless,
        args: this.options.args,
      });
    } catch (cause) {
      throw new BrowserDriverError(
        'LAUNCH_FAILED',
        `Failed to launch ${this.options.engine}. Did you run "npx playwright install"?`,
        { cause },
      );
    }
    this.context = await this.browser.newContext({
      userAgent: this.options.userAgent,
      bypassCSP: this.options.bypassCSP,
    });
    this.page = await this.context.newPage();
  }

  private async connectOverCdp(): Promise<void> {
    try {
      // CDP attach is Chromium-only; that's the relevant engine for "existing Chrome".
      this.browser = await chromium.connectOverCDP(this.options.cdpEndpoint);
    } catch (cause) {
      throw new BrowserDriverError(
        'CONNECT_FAILED',
        `Could not connect to Chrome at "${this.options.cdpEndpoint}". ` +
          'Start Chrome with --remote-debugging-port=9222 (see README).',
        { cause },
      );
    }

    // A real Chrome exposes its already-open window as the first context.
    const existingContexts = this.browser.contexts();
    this.context = existingContexts[0] ?? (await this.browser.newContext());

    if (this.options.reuseExistingPage) {
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
    } else {
      this.page = await this.context.newPage();
    }

    // launch mode sets bypassCSP at context creation; over CDP the context
    // already exists, so disable CSP per page via the protocol instead.
    if (this.options.bypassCSP) {
      await this.enableCspBypassViaCdp(this.page);
    }
  }

  /** Disable CSP for a connected page (Chromium CDP). Safe no-op on failure. */
  private async enableCspBypassViaCdp(page: Page): Promise<void> {
    try {
      const session = await this.context!.newCDPSession(page);
      await session.send('Page.setBypassCSP', { enabled: true });
    } catch {
      // Non-Chromium or unsupported — leave the page's CSP in effect.
    }
  }

  /**
   * Close the active page/context. When the driver launched the browser it
   * also closes the browser process; when connected over CDP it only detaches,
   * leaving your existing Chrome untouched.
   */
  async close(): Promise<void> {
    try {
      // For an owned browser this terminates the process; for a CDP connection
      // Playwright's close() only detaches, leaving the user's Chrome running.
      await this.browser?.close();
    } finally {
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation & waiting
  // ---------------------------------------------------------------------------

  /**
   * Navigate the active page to `url` and wait for it to finish loading.
   *
   * The full settle sequence is:
   *   1. navigate, waiting for `waitUntil` (default `'load'`), then
   *   2. wait for the network to go idle (no connections for 500ms) so the page
   *      is fully loaded — unless `waitForNetworkIdle: false`, then
   *   3. defensively confirm `document.readyState === 'complete'` — unless
   *      `waitForComplete: false`.
   *
   * After this resolves the page is settled; the typical next step is
   * `waitForElement(selector)` (which returns immediately if the element is
   * already present). Returns the active `Page`.
   */
  async openUrl(url: string, options: OpenUrlOptions = {}): Promise<Page> {
    const page = this.requirePage();
    const waitUntil: LoadState = options.waitUntil ?? 'load';
    const timeout = options.timeoutMs ?? this.options.defaultTimeoutMs;
    // Activate the tab first so the navigation is visible in the window.
    if (options.bringToFront) {
      await page.bringToFront();
    }
    try {
      await page.goto(url, { waitUntil, timeout });
    } catch (cause) {
      throw new BrowserDriverError(
        'NAVIGATION_FAILED',
        `Failed to navigate to "${url}".`,
        { cause },
      );
    }

    // Wait for the network to fully settle so the page is done loading (not just
    // past its `load` event). Best-effort: a page that holds a long-lived
    // connection never reaches 'networkidle', so a timeout here is not fatal —
    // the DOM is already loaded and the caller's element wait is the real gate.
    if (options.waitForNetworkIdle ?? true) {
      try {
        await page.waitForLoadState('networkidle', { timeout });
      } catch {
        // Never idled within the timeout — proceed with the loaded DOM.
      }
    }

    // Defensive readiness guard. Event-based waits can race: if the page
    // finished loading before we started listening, the load event is already
    // gone. A synchronous document.readyState read can't miss it.
    if (options.waitForComplete ?? true) {
      await this.waitForDocumentComplete(page, timeout);
    }
    return page;
  }

  /**
   * Ensure `document.readyState === 'complete'`. Reads the state synchronously
   * first and returns at once if already complete (no event wait, no race);
   * otherwise waits for it to reach 'complete'. Best-effort — a page that never
   * completes within the timeout is left to the caller's element wait.
   *
   * Note: `page.evaluate` / `waitForFunction` run via the DevTools protocol, so
   * this readiness check is exempt from the page's CSP (consistent with the
   * SDK's eval-free extraction).
   */
  private async waitForDocumentComplete(page: Page, timeout: number): Promise<void> {
    let state: DocumentReadyState;
    try {
      state = await page.evaluate(() => document.readyState);
    } catch {
      // Page navigated/closed mid-check — let the next step surface any error.
      return;
    }
    if (state === 'complete') return; // already done — no wait, no race
    try {
      await page.waitForFunction(() => document.readyState === 'complete', undefined, {
        timeout,
      });
    } catch {
      // Never reached 'complete' in time — proceed; waitForElement is the gate.
    }
  }

  /**
   * Wait until the page reaches a lifecycle state.
   * `'load'` (default), `'domcontentloaded'`, or `'networkidle'`.
   */
  async waitForLoad(
    state: LoadState = 'load',
    options: { timeoutMs?: number } = {},
  ): Promise<void> {
    const page = this.requirePage();
    await page.waitForLoadState(state, {
      timeout: options.timeoutMs ?? this.options.defaultTimeoutMs,
    });
  }

  /**
   * Wait for an element matching `selector` to reach the requested state
   * (default `'visible'`). Returns a Playwright `Locator` for further use.
   * Throws `ElementNotFoundError` on timeout.
   */
  async waitForElement(
    selector: string,
    options: WaitForElementOptions = {},
  ): Promise<Locator> {
    const page = this.requirePage();
    const timeout = options.timeoutMs ?? this.options.defaultTimeoutMs;
    const locator = page.locator(selector);
    try {
      await locator.first().waitFor({ state: options.state ?? 'visible', timeout });
    } catch (cause) {
      throw new ElementNotFoundError(selector, timeout, { cause });
    }
    return locator.first();
  }

  // ---------------------------------------------------------------------------
  // Extraction & persistence
  // ---------------------------------------------------------------------------

  /**
   * Extract HTML from the page. With a `selector`, returns that element's
   * `outerHTML` (or `innerHTML` when `kind: 'inner'`). Without a selector,
   * returns the full page HTML (`page.content()`).
   * Throws `ElementNotFoundError` if the selector never appears.
   */
  async extractHtml(selector?: string, options: ExtractHtmlOptions = {}): Promise<string> {
    const page = this.requirePage();
    if (!selector) {
      return page.content();
    }

    const timeout = options.timeoutMs ?? this.options.defaultTimeoutMs;
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: 'attached', timeout });
    } catch (cause) {
      throw new ElementNotFoundError(selector, timeout, { cause });
    }

    const kind = options.kind ?? 'outer';
    if (kind === 'inner') {
      // Native, eval-free — never trips a CSP `unsafe-eval` policy.
      return locator.innerHTML({ timeout });
    }

    // outerHTML, eval-free: read it straight from the CDP DOM domain (no script
    // runs in the page, so a strict CSP is irrelevant). Only safe for plain CSS
    // selectors; for Playwright engine selectors fall back to isolated-world
    // evaluate (which is itself exempt from page CSP).
    if (isPlainCssSelector(selector)) {
      const viaCdp = await this.outerHtmlViaCdp(page, selector);
      if (viaCdp !== null) return viaCdp;
    }
    return locator.evaluate((el) => (el as Element).outerHTML);
  }

  /** Read an element's outerHTML via CDP `DOM.getOuterHTML`. Null if unavailable. */
  private async outerHtmlViaCdp(page: Page, cssSelector: string): Promise<string | null> {
    if (!this.context) return null;
    try {
      const session = await this.context.newCDPSession(page);
      const { root } = (await session.send('DOM.getDocument', { depth: 0 })) as {
        root: { nodeId: number };
      };
      const { nodeId } = (await session.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: cssSelector,
      })) as { nodeId: number };
      if (!nodeId) return null;
      const { outerHTML } = (await session.send('DOM.getOuterHTML', { nodeId })) as {
        outerHTML: string;
      };
      return outerHTML;
    } catch {
      // Non-Chromium, detached, or protocol error — let the caller fall back.
      return null;
    }
  }

  /**
   * Write `content` to `filePath` (relative paths resolve against `process.cwd()`).
   * Parent directories are created by default. Returns the absolute path written.
   */
  async saveToDisk(
    content: string,
    filePath: string,
    options: SaveOptions = {},
  ): Promise<string> {
    const absolutePath = resolve(filePath);
    try {
      if (options.mkdirp ?? true) {
        await mkdir(dirname(absolutePath), { recursive: true });
      }
      await writeFile(absolutePath, content, { encoding: options.encoding ?? 'utf-8' });
    } catch (cause) {
      throw new BrowserDriverError('SAVE_FAILED', `Failed to write "${absolutePath}".`, {
        cause,
      });
    }
    return absolutePath;
  }

  /**
   * Capture a PNG screenshot of the active page and save it to `filePath`.
   * Works even in headless / no-display environments — handy on a remote box
   * where you can't see the window but still want visual proof the tab loaded.
   * Returns the absolute path written.
   */
  async screenshot(
    filePath: string,
    options: { fullPage?: boolean } = {},
  ): Promise<string> {
    const page = this.requirePage();
    const absolutePath = resolve(filePath);
    try {
      await mkdir(dirname(absolutePath), { recursive: true });
      await page.screenshot({ path: absolutePath, fullPage: options.fullPage ?? true });
    } catch (cause) {
      throw new BrowserDriverError('SAVE_FAILED', `Failed to screenshot to "${absolutePath}".`, {
        cause,
      });
    }
    return absolutePath;
  }

  /**
   * Convenience: wait for `selector`, extract its HTML, and save it to
   * `filePath` in one call. Returns the absolute path written.
   */
  async extractAndSave(
    selector: string,
    filePath: string,
    options: ExtractHtmlOptions & SaveOptions = {},
  ): Promise<string> {
    const html = await this.extractHtml(selector, options);
    return this.saveToDisk(html, filePath, options);
  }

  // ---------------------------------------------------------------------------
  // Escape hatches & accessors
  // ---------------------------------------------------------------------------

  /** Open a fresh blank tab in the current context and make it active. */
  async newPage(): Promise<Page> {
    if (!this.context) throw new NotLaunchedError();
    this.page = await this.context.newPage();
    return this.page;
  }

  /**
   * Bring the active tab to the foreground of its window (CDP `Page.bringToFront`).
   * Useful when connected to a real Chrome so the driven tab is the one you see.
   */
  async bringToFront(): Promise<void> {
    await this.requirePage().bringToFront();
  }

  /** The active page, or throw if there isn't one. Use for advanced Playwright calls. */
  requirePage(): Page {
    if (!this.browser) throw new NotLaunchedError();
    if (!this.page) throw new NoActivePageError();
    return this.page;
  }

  /** The active page if one exists, otherwise `null`. */
  get currentPage(): Page | null {
    return this.page;
  }

  /** The active context if one exists, otherwise `null`. */
  get currentContext(): BrowserContext | null {
    return this.context;
  }

  /** The underlying Playwright `Browser` if launched/connected, otherwise `null`. */
  get currentBrowser(): Browser | null {
    return this.browser;
  }

  /** True once `launch()` has acquired a browser. */
  get isLaunched(): boolean {
    return this.browser !== null;
  }
}
