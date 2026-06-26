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
    Pick<DriverOptions, 'mode' | 'engine' | 'headless' | 'cdpEndpoint' | 'reuseExistingPage' | 'defaultTimeoutMs'>
  > &
    DriverOptions;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(options: DriverOptions = {}) {
    this.options = {
      mode: options.mode ?? 'launch',
      engine: options.engine ?? 'chromium',
      headless: options.headless ?? true,
      cdpEndpoint: options.cdpEndpoint ?? DEFAULT_CDP_ENDPOINT,
      reuseExistingPage: options.reuseExistingPage ?? true,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
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
    this.context = await this.browser.newContext({ userAgent: this.options.userAgent });
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
   * Navigate the active page to `url` and wait for the requested lifecycle
   * event (default `'load'`). Returns the active `Page`.
   */
  async openUrl(url: string, options: OpenUrlOptions = {}): Promise<Page> {
    const page = this.requirePage();
    const waitUntil: LoadState = options.waitUntil ?? 'load';
    const timeout = options.timeoutMs ?? this.options.defaultTimeoutMs;
    try {
      await page.goto(url, { waitUntil, timeout });
    } catch (cause) {
      throw new BrowserDriverError(
        'NAVIGATION_FAILED',
        `Failed to navigate to "${url}".`,
        { cause },
      );
    }
    return page;
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
    return kind === 'inner'
      ? await locator.innerHTML({ timeout })
      : await locator.evaluate((el) => (el as Element).outerHTML);
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
