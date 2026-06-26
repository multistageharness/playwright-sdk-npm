# playwright-sdk-npm

A small TypeScript SDK around [Playwright](https://playwright.dev) that gives you
a high-level interface for driving a browser. It launches a fresh browser **or**
connects to your **existing Chrome window**, then lets you:

- open a URL and **wait for it to load**,
- **wait for an element** to appear,
- **extract that element's HTML**, and
- **save it to disk**.

## Install

```bash
npm install
npx playwright install chromium   # one-time: download the browser binary
```

## Quick start

```ts
import { BrowserDriver } from 'playwright-sdk-npm';

const driver = new BrowserDriver({ headless: true });

await driver.launch();
await driver.openUrl('https://example.com', { waitUntil: 'load' });
await driver.waitForElement('h1');                 // wait for the element
const html = await driver.extractHtml('h1');       // "<h1>Example Domain</h1>"
await driver.saveToDisk(html, 'output/heading.html');
await driver.close();
```

Or do the last three steps in one call:

```ts
await driver.extractAndSave('h1', 'output/heading.html');
```

## Driving your existing Chrome window

To control the Chrome you already have open (rather than launching a new one),
start Chrome with remote debugging enabled, then connect over CDP.

1. Quit Chrome completely, then relaunch it with a debugging port:

   ```bash
   # macOS
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
   # Linux
   google-chrome --remote-debugging-port=9222
   # Windows
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
   ```

2. Connect and drive the already-open tab:

   ```ts
   const driver = new BrowserDriver({
     mode: 'connect',
     cdpEndpoint: 'http://localhost:9222',
     reuseExistingPage: true,   // drive the tab you already have open
   });
   await driver.launch();
   await driver.openUrl('https://example.com');
   await driver.extractAndSave('h1', 'output/from-existing-window.html');
   await driver.close();        // detaches only — your Chrome stays open
   ```

In `connect` mode, `close()` detaches without killing your browser. In `launch`
mode, `close()` shuts down the browser the SDK started.

## API

### `new BrowserDriver(options?)`

| Option              | Type                                  | Default                   | Notes |
| ------------------- | ------------------------------------- | ------------------------- | ----- |
| `mode`              | `'launch' \| 'connect'`               | `'launch'`                | Launch a fresh browser, or attach to an existing Chrome over CDP. |
| `engine`            | `'chromium' \| 'firefox' \| 'webkit'` | `'chromium'`              | Launch mode only. |
| `headless`          | `boolean`                             | `true`                    | Launch mode only. |
| `cdpEndpoint`       | `string`                              | `'http://localhost:9222'` | Connect mode only. |
| `reuseExistingPage` | `boolean`                             | `true`                    | Connect mode: drive the open tab instead of opening a new one. |
| `defaultTimeoutMs`  | `number`                              | `30000`                   | Applied to navigation and waits. |
| `userAgent`         | `string`                              | —                         | Launch mode only. |
| `args`              | `string[]`                            | —                         | Extra browser process args (launch mode). |

### Methods

| Method | Description |
| ------ | ----------- |
| `launch()` | Acquire the browser per `mode`. Idempotent. Returns `this`. |
| `openUrl(url, { waitUntil?, timeoutMs? })` | Navigate and wait for a lifecycle event (default `'load'`). Returns the `Page`. |
| `waitForLoad(state?, { timeoutMs? })` | Wait for `'load'` / `'domcontentloaded'` / `'networkidle'`. |
| `waitForElement(selector, { state?, timeoutMs? })` | Wait for an element (default state `'visible'`). Returns a `Locator`. |
| `extractHtml(selector?, { kind?, timeoutMs? })` | Element `outerHTML` (or `innerHTML` with `kind:'inner'`); full page HTML if no selector. |
| `saveToDisk(content, filePath, { encoding?, mkdirp? })` | Write to disk (creates parent dirs by default). Returns the absolute path. |
| `extractAndSave(selector, filePath, opts?)` | `extractHtml` + `saveToDisk` in one call. |
| `newPage()` | Open and activate a fresh blank tab. |
| `close()` | Close (launch) or detach (connect). |

### Accessors & escape hatches

`requirePage()`, `currentPage`, `currentContext`, `currentBrowser`, `isLaunched`
give you direct access to the underlying Playwright objects for anything the
high-level API doesn't cover.

### Errors

All thrown errors extend `BrowserDriverError` and carry a `.code`
(`NOT_LAUNCHED`, `NO_ACTIVE_PAGE`, `CONNECT_FAILED`, `LAUNCH_FAILED`,
`NAVIGATION_FAILED`, `ELEMENT_NOT_FOUND`, `SAVE_FAILED`). Convenience subclasses:
`NotLaunchedError`, `NoActivePageError`, `ElementNotFoundError`.

## Examples

```bash
npm run example          # launch → open → wait → extract → save
npm run example:connect  # same flow against your existing Chrome window
```

Both honor `TARGET_URL`, `TARGET_SELECTOR`, and `OUT_FILE` env vars.

## Scripts

| Script | Description |
| ------ | ----------- |
| `npm run build` | Compile `src/` → `dist/` with type declarations. |
| `npm run typecheck` | Type-check without emitting. |
| `npm run example` / `example:connect` | Run the example flows. |

## License

MIT
