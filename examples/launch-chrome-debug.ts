/**
 * Programmatic equivalent of ./chrome-remote-debug.sh — an in-process launcher
 * for a windowed Chrome with the DevTools Protocol (CDP) enabled, for callers
 * who'd rather not shell out.
 *
 *   const chrome = await launchChromeDebug(9222);
 *   const driver = new BrowserDriver({ mode: 'connect', cdpEndpoint: chrome.endpoint });
 *   await driver.launch();
 *   // … drive the browser …
 *   await driver.close();
 *   chrome.kill();            // stop the Chrome process we spawned
 *
 * Binary discovery mirrors the shell helper:
 *   1. $CHROME_BIN (if set + executable)
 *   2. Playwright-bundled "Google Chrome for Testing" in ~/Library/Caches/ms-playwright
 *      (separate app identity — macOS won't merge it into a running Chrome)
 *   3. system Google Chrome / Chromium
 *
 * Note: this utility is NOT imported by the example suite — those connect to a
 * Chrome started by ./chrome-remote-debug.sh. It's here for programmatic callers.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ChromeDebugHandle {
  /** CDP HTTP endpoint, e.g. `http://localhost:9222`. */
  endpoint: string;
  /** PID of the spawned Chrome process. */
  pid: number;
  /** The isolated user-data-dir created for this session. */
  profileDir: string;
  /** Terminate the spawned Chrome process. */
  kill(): void;
}

const SYSTEM_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function isExecutable(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Newest Playwright-bundled "Google Chrome for Testing" binary, or null. */
function findChromeForTesting(): string | null {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  let builds: string[];
  try {
    builds = readdirSync(cache).filter((name) => name.startsWith('chromium-'));
  } catch {
    return null;
  }
  // Newest build dir first (chromium-<rev>; higher rev ~ newer).
  builds.sort().reverse();
  for (const build of builds) {
    for (const macDir of ['chrome-mac-arm64', 'chrome-mac', 'chrome-mac-x64']) {
      const bin = join(
        cache,
        build,
        macDir,
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing',
      );
      if (isExecutable(bin)) return bin;
    }
  }
  return null;
}

/** Resolve a Chrome/Chromium binary the same way chrome-remote-debug.sh does. */
function findChrome(): string {
  const fromEnv = process.env.CHROME_BIN;
  if (fromEnv && isExecutable(fromEnv)) return fromEnv;

  const cft = findChromeForTesting();
  if (cft) return cft;

  for (const candidate of SYSTEM_CANDIDATES) {
    if (isExecutable(candidate)) return candidate;
  }
  throw new Error(
    'launchChromeDebug: could not find Chrome/Chromium. Set $CHROME_BIN or run "npx playwright install chromium".',
  );
}

async function pollEndpoint(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Launch a windowed Chrome with CDP enabled on `port`, wait (up to ~10s) for the
 * endpoint to come up, and return a handle for connecting and cleanup.
 */
export async function launchChromeDebug(port = 9222): Promise<ChromeDebugHandle> {
  const bin = findChrome();
  const profileDir = join(tmpdir(), `chrome-remote-debug-${port}`);
  mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
  ];

  const child = spawn(bin, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error('launchChromeDebug: failed to spawn Chrome.');
  }

  const up = await pollEndpoint(port, 10_000);
  if (!up) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
    throw new Error(
      `launchChromeDebug: timed out waiting for CDP on port ${port}. On macOS, quit any running Chrome or use Chrome for Testing.`,
    );
  }

  return {
    endpoint: `http://localhost:${port}`,
    pid,
    profileDir,
    kill(): void {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    },
  };
}
