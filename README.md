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

// A visible Chromium window opens by default; pass { headless: true } to hide it.
const driver = new BrowserDriver();

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

To control a real Chrome window (rather than launching a fresh, isolated one),
start Chrome with remote debugging enabled, then connect over CDP.

1. Launch a windowed Chrome with the bundled helper. It applies
   `--remote-debugging-port`, an isolated `--user-data-dir`, `--no-first-run`,
   and `--start-maximized` (non-headless), waits for the endpoint, and prints a
   **session id** plus the endpoint to use:

   ```bash
   ./chrome-remote-debug.sh          # default port 9222
   # ./chrome-remote-debug.sh 9333   # custom port
   ```

   ```text
   chrome-remote-debug: session ready
     pid          = 12345
     port         = 9222
     cdp endpoint = http://localhost:9222
     ws endpoint  = ws://localhost:9222/devtools/browser/<session-id>
     session id   = <session-id>
   ```

   The launched Chrome is detached (`nohup` + `disown`), so it **stays open
   after the terminal closes**. Stop it explicitly with
   `./chrome-remote-debug.sh stop 9222`.

   > Override the binary with `CHROME_BIN=...` and the profile with
   > `CHROME_DEBUG_PROFILE=...` if needed.

2. Connect and drive the already-open tab, pointing at the printed endpoint:

   ```ts
   const driver = new BrowserDriver({
     mode: 'connect',
     cdpEndpoint: process.env.CDP_ENDPOINT ?? 'http://localhost:9222',
     reuseExistingPage: false,  // open a NEW tab in the active window
   });
   await driver.launch();
   // bringToFront focuses the tab so you can watch it load (active debugging).
   await driver.openUrl('https://example.com', { bringToFront: true });
   await driver.extractAndSave('h1', 'output/from-existing-window.html');
   await driver.close();        // detaches only — your Chrome and the tab stay open
   ```

   Or run the bundled example against the printed endpoint (http or ws):

   ```bash
   CDP_ENDPOINT=http://localhost:9222 npm run example:connect
   ```

   The example opens a **new tab in the active window**, brings it to the
   **foreground**, and holds the connection open until you press **Ctrl+C** so
   you can debug it live. Env toggles: `REUSE_TAB=1` drives the current tab
   instead of opening a new one; `HOLD=0` detaches immediately after saving.

In `connect` mode, `close()` detaches without killing your browser. In `launch`
mode, `close()` shuts down the browser the SDK started.

## Strict CSP pages (no `unsafe-eval`)

Sites with a strict Content-Security-Policy can break tools that inject or
`eval()` script in the page. This SDK is CSP-friendly two ways:

1. **Eval-free extraction.** `extractHtml` reads markup without running any page
   script — `outerHTML` comes from the CDP `DOM.getOuterHTML` domain and
   `kind: 'inner'` uses native `innerHTML`. So extraction works even with
   `bypassCSP: false`. (Playwright engine selectors like `text=`/`xpath=` fall
   back to an isolated-world `evaluate`, which is itself exempt from page CSP.)
2. **`bypassCSP: true` (default).** Disables the page CSP for the automated
   session so any scripts you inject also run. Applied via `newContext({
   bypassCSP })` in launch mode and CDP `Page.setBypassCSP` in connect mode.

```ts
const driver = new BrowserDriver();          // bypassCSP defaults to true
await driver.launch();
await driver.openUrl('https://strict-csp.example');
const html = await driver.extractHtml('#app'); // eval-free, no CSP violation
```

```bash
npm run example:csp   # demonstrates extraction from a strict-CSP fixture
```

## API

### `new BrowserDriver(options?)`

| Option              | Type                                  | Default                   | Notes |
| ------------------- | ------------------------------------- | ------------------------- | ----- |
| `mode`              | `'launch' \| 'connect'`               | `'launch'`                | Launch a fresh browser, or attach to an existing Chrome over CDP. |
| `engine`            | `'chromium' \| 'firefox' \| 'webkit'` | `'chromium'`              | Launch mode only. |
| `headless`          | `boolean`                             | `false`                   | Launch mode only. `false` opens a visible window. |
| `cdpEndpoint`       | `string`                              | `'http://localhost:9222'` | Connect mode only. |
| `reuseExistingPage` | `boolean`                             | `true`                    | Connect mode: drive the open tab instead of opening a new one. |
| `defaultTimeoutMs`  | `number`                              | `30000`                   | Applied to navigation and waits. |
| `bypassCSP`         | `boolean`                             | `true`                    | Disable the page CSP for the session (launch: context option; connect: CDP `Page.setBypassCSP`). |
| `userAgent`         | `string`                              | —                         | Launch mode only. |
| `args`              | `string[]`                            | —                         | Extra browser process args (launch mode). |

### Methods

| Method | Description |
| ------ | ----------- |
| `launch()` | Acquire the browser per `mode`. Idempotent. Returns `this`. |
| `openUrl(url, { waitUntil?, timeoutMs?, bringToFront? })` | Navigate and wait for a lifecycle event (default `'load'`). `bringToFront: true` focuses the tab first. Returns the `Page`. |
| `waitForLoad(state?, { timeoutMs? })` | Wait for `'load'` / `'domcontentloaded'` / `'networkidle'`. |
| `waitForElement(selector, { state?, timeoutMs? })` | Wait for an element (default state `'visible'`). Returns a `Locator`. |
| `extractHtml(selector?, { kind?, timeoutMs? })` | Element `outerHTML` (or `innerHTML` with `kind:'inner'`); full page HTML if no selector. |
| `screenshot(filePath, { fullPage? })` | Save a PNG of the active page (works headless). Returns the absolute path. |
| `saveToDisk(content, filePath, { encoding?, mkdirp? })` | Write to disk (creates parent dirs by default). Returns the absolute path. |
| `extractAndSave(selector, filePath, opts?)` | `extractHtml` + `saveToDisk` in one call. |
| `newPage()` | Open and activate a fresh blank tab. |
| `bringToFront()` | Bring the active tab to the foreground of its window. |
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
npm run example:csp      # extract from a strict-CSP page (no unsafe-eval)
```

Both honor `TARGET_URL`, `TARGET_SELECTOR`, and `OUT_FILE` env vars.

By default `npm run example` **leaves the window open** so you can see the
loaded tab, and waits until you press **Ctrl+C**. Otherwise the browser
navigates and closes in a split second — on a virtual/remote desktop the tab
just flashes by and you never see it. Control this with:

```bash
HOLD_MS=0   npm run example   # close immediately after saving
HOLD_MS=5000 npm run example   # keep the tab open for 5s, then close
HEADLESS=1  npm run example   # no window at all
```

### Seeing / keeping the tab on a virtual computer

A **launch-mode** browser is a child of the Node process, so it is torn down
when the script exits — it cannot outlive the terminal. For a window that loads
a tab **and stays open** (even after the terminal closes), launch a persistent
Chrome with the helper and drive it via `connect`:

```bash
./chrome-remote-debug.sh                       # opens a persistent Chrome window
CDP_ENDPOINT=http://localhost:9222 npm run example:connect
```

The connect example detaches on `close()`, so the navigated tab stays in the
window.

### Remote / headless server (no display)

On a remote box with **no display server**, a *windowed* Chrome has nothing to
draw onto — so it looks like "the tab never gets created" even though the page
is actually there and drivable. The helper detects this (Linux, no `DISPLAY`)
and **runs headless automatically**; the CDP endpoint, tabs, HTML extraction,
and screenshots all still work — you just can't watch a window.

```bash
./chrome-remote-debug.sh                          # auto-headless on a display-less box
CDP_ENDPOINT=http://localhost:9222 npm run example:connect
# → writes output/existing-window.html AND output/existing-window.png
```

The connect example saves a **screenshot** (`driver.screenshot(...)`) as visual
proof the tab was created and rendered, even with no display. The script also
prints the live page targets so you can confirm the tab exists:
`curl -s http://localhost:9222/json/list`.

To actually **see** a window on a headless Linux box, give it a virtual display
and force a window:

```bash
xvfb-run -a env CHROME_FORCE_HEADED=1 ./chrome-remote-debug.sh
```

Toggles: `CHROME_HEADLESS=1` forces headless anywhere; `CHROME_FORCE_HEADED=1`
forces a window (pair with `xvfb-run` / a VNC desktop).

## Scripts

| Script | Description |
| ------ | ----------- |
| `npm run build` | Compile `src/` → `dist/` with type declarations. |
| `npm run typecheck` | Type-check without emitting. |
| `npm run example` / `example:connect` | Run the example flows. |

## License

MIT
