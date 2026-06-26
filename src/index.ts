export { BrowserDriver } from './browser-driver.js';
export {
  BrowserDriverError,
  ElementNotFoundError,
  NoActivePageError,
  NotLaunchedError,
  type BrowserDriverErrorCode,
} from './errors.js';
export type {
  BrowserEngine,
  DriverMode,
  DriverOptions,
  ExtractHtmlOptions,
  LoadState,
  OpenUrlOptions,
  SaveOptions,
  WaitForElementOptions,
} from './types.js';

// Re-export the common Playwright types callers will touch via escape hatches,
// so they don't need a direct dependency on `playwright` for typing.
export type { Browser, BrowserContext, Locator, Page } from 'playwright';
