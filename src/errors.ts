/**
 * Error hierarchy for the SDK. Every error thrown by `BrowserDriver` is (or
 * extends) `BrowserDriverError`, so callers can `catch (e) { if (e instanceof
 * BrowserDriverError) ... }` and discriminate on `.code`.
 */

export type BrowserDriverErrorCode =
  | 'NOT_LAUNCHED'
  | 'NO_ACTIVE_PAGE'
  | 'CONNECT_FAILED'
  | 'LAUNCH_FAILED'
  | 'NAVIGATION_FAILED'
  | 'ELEMENT_NOT_FOUND'
  | 'SAVE_FAILED';

export class BrowserDriverError extends Error {
  readonly code: BrowserDriverErrorCode;

  constructor(code: BrowserDriverErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BrowserDriverError';
    this.code = code;
    // Preserve the prototype chain when targeting older runtimes.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when an operation is attempted before `launch()` has been called. */
export class NotLaunchedError extends BrowserDriverError {
  constructor() {
    super('NOT_LAUNCHED', 'Driver is not launched. Call launch() before using the driver.');
    this.name = 'NotLaunchedError';
  }
}

/** Thrown when an operation needs an active page but none exists yet. */
export class NoActivePageError extends BrowserDriverError {
  constructor() {
    super(
      'NO_ACTIVE_PAGE',
      'No active page. Call openUrl() (or newPage()) before driving the page.',
    );
    this.name = 'NoActivePageError';
  }
}

/** Thrown when waiting for a selector times out. */
export class ElementNotFoundError extends BrowserDriverError {
  readonly selector: string;

  constructor(selector: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(
      'ELEMENT_NOT_FOUND',
      `Element "${selector}" was not found within ${timeoutMs}ms.`,
      options,
    );
    this.name = 'ElementNotFoundError';
    this.selector = selector;
  }
}
