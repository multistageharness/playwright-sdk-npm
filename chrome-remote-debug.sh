#!/usr/bin/env bash
#
# chrome-remote-debug.sh — launch a real, windowed Google Chrome with the Chrome
# DevTools Protocol (CDP) enabled, then print a session id you can hand to the
# SDK examples (mode: 'connect').
#
# Flags always applied (see https://chromedevtools.github.io/devtools-protocol/):
#   --remote-debugging-port=<port>  expose the CDP HTTP/WebSocket endpoint
#   --user-data-dir=<dir>           isolated profile so the debug server starts
#                                   (without it Chrome just opens a tab in your
#                                   running session and ignores the debug flag)
#   --no-first-run                  skip the first-run setup screens
#   --start-maximized               open the window maximized
#   (non-headless)                  a visible Chrome window — no --headless flag
#
# Usage:
#   ./chrome-remote-debug.sh [port]            # default port 9222
#
# Environment overrides:
#   CHROME_BIN            path to the Chrome/Chromium binary
#   CHROME_DEBUG_PROFILE  user-data-dir to use (default: a per-port temp dir)
#
# On success it launches Chrome in the background and prints the connection
# details, including a `session id` (the browser GUID from the CDP endpoint).
# Stop it later with:  ./chrome-remote-debug.sh stop [port]
set -euo pipefail

PORT="${1:-9222}"

# ---------------------------------------------------------------------------
# Locate the Chrome / Chromium binary for the current platform.
# ---------------------------------------------------------------------------
find_chrome() {
  if [ -n "${CHROME_BIN:-}" ] && [ -x "${CHROME_BIN}" ]; then
    printf '%s\n' "${CHROME_BIN}"
    return 0
  fi

  # Prefer the Playwright-bundled "Google Chrome for Testing" when present.
  # It has a distinct app identity, so macOS does NOT merge its launch into an
  # already-running Google Chrome — --remote-debugging-port opens the CDP
  # endpoint reliably even when your normal Chrome is already running.
  local pw_cache="${HOME}/Library/Caches/ms-playwright"
  if [ -d "${pw_cache}" ]; then
    local cft
    cft="$(ls -dt \
      "${pw_cache}"/chromium-*/chrome-mac*/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" \
      2>/dev/null | head -n 1 || true)"
    if [ -n "${cft}" ] && [ -x "${cft}" ]; then
      printf '%s\n' "${cft}"
      return 0
    fi
  fi

  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "google-chrome"
    "google-chrome-stable"
    "chromium"
    "chromium-browser"
    "chrome"
  )

  local c
  for c in "${candidates[@]}"; do
    if [ -x "$c" ]; then printf '%s\n' "$c"; return 0; fi
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
  done

  echo "chrome-remote-debug: could not find Chrome/Chromium (set \$CHROME_BIN)" >&2
  return 1
}

# ---------------------------------------------------------------------------
# stop subcommand:  ./chrome-remote-debug.sh stop [port]
# ---------------------------------------------------------------------------
if [ "${1:-}" = "stop" ]; then
  PORT="${2:-9222}"
  pids="$(pgrep -f -- "--remote-debugging-port=${PORT}" 2>/dev/null || true)"
  if [ -z "${pids}" ]; then
    echo "chrome-remote-debug: no Chrome instance on port ${PORT}" >&2
    exit 1
  fi
  echo "chrome-remote-debug: stopping pids: ${pids}" >&2
  # shellcheck disable=SC2086
  kill ${pids} 2>/dev/null || true
  exit 0
fi

BIN="$(find_chrome)"

# ---------------------------------------------------------------------------
# macOS pre-launch guard.
# Launching a *regular* Google Chrome while one is already running hands the new
# process off to the existing instance ("Opening in existing browser session")
# and silently ignores --remote-debugging-port, so the CDP endpoint never opens
# and we'd time out. Fail fast with a fix instead. "Chrome for Testing" has a
# separate app identity and is exempt. Bypass entirely with CHROME_SKIP_CHECK=1.
# ---------------------------------------------------------------------------
if [ "$(uname -s)" = "Darwin" ] && [ "${CHROME_SKIP_CHECK:-}" != "1" ]; then
  case "${BIN}" in
    *"Chrome for Testing"*|*"ms-playwright"*) : ;; # separate identity — safe
    *)
      if pgrep -x "Google Chrome" >/dev/null 2>&1; then
        echo "chrome-remote-debug: Google Chrome is already running." >&2
        echo "chrome-remote-debug:   Launching regular Chrome now would merge into the existing" >&2
        echo "chrome-remote-debug:   session and ignore --remote-debugging-port=${PORT}." >&2
        echo "chrome-remote-debug:   Quit it first:" >&2
        echo "chrome-remote-debug:     osascript -e 'tell application \"Google Chrome\" to quit'" >&2
        echo "chrome-remote-debug:   …or install Chrome for Testing (npx playwright install chromium)," >&2
        echo "chrome-remote-debug:   or set CHROME_SKIP_CHECK=1 to bypass this check." >&2
        exit 1
      fi
      ;;
  esac
fi

PROFILE="${CHROME_DEBUG_PROFILE:-${TMPDIR:-/tmp}/chrome-remote-debug-${PORT}}"
mkdir -p "${PROFILE}"

FLAGS=(
  "--remote-debugging-port=${PORT}"
  "--user-data-dir=${PROFILE}"
  "--no-first-run"
  "--no-default-browser-check"
  "--start-maximized"
)

# ---------------------------------------------------------------------------
# Decide headless vs windowed.
#   CHROME_HEADLESS=1     force headless (no window; still fully drivable).
#   CHROME_FORCE_HEADED=1 force a window even with no display (e.g. xvfb-run).
# On a remote/headless Linux box with NO display, a windowed Chrome cannot draw
# anything — so default to headless there (otherwise the tab "never appears").
# ---------------------------------------------------------------------------
MODE="windowed"
if [ "${CHROME_HEADLESS:-}" = "1" ]; then
  MODE="headless"
elif [ "$(uname -s)" = "Linux" ] && [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] \
     && [ "${CHROME_FORCE_HEADED:-}" != "1" ]; then
  echo "chrome-remote-debug: no display detected (Linux) — running headless." >&2
  echo "chrome-remote-debug:   to SEE a window, run under a virtual display:" >&2
  echo "chrome-remote-debug:     xvfb-run -a env CHROME_FORCE_HEADED=1 ./chrome-remote-debug.sh ${PORT}" >&2
  MODE="headless"
fi
if [ "${MODE}" = "headless" ]; then
  # New headless still serves CDP and creates real tabs; just no on-screen window.
  FLAGS+=("--headless=new" "--window-size=1280,1024")
fi

echo "chrome-remote-debug: launching ${BIN} (${MODE})" >&2
echo "chrome-remote-debug:   port    = ${PORT}" >&2
echo "chrome-remote-debug:   profile = ${PROFILE}" >&2

# Launch windowed (non-headless) and fully detach it so it survives the
# terminal closing:
#   nohup        — ignore SIGHUP (sent to the session on terminal close)
#   </dev/null   — detach stdin so it isn't tied to the tty
#   >log 2>&1    — detach stdout/stderr
#   disown       — drop it from the shell's job table (no SIGHUP on shell exit)
# Together these reparent Chrome to launchd/init, so it keeps running after the
# launching terminal is gone. Stop it explicitly with `stop`.
nohup "${BIN}" "${FLAGS[@]}" >"${PROFILE}/chrome.log" 2>&1 </dev/null &
CHROME_PID=$!
disown "${CHROME_PID}" 2>/dev/null || disown 2>/dev/null || true

# ---------------------------------------------------------------------------
# Wait for the CDP endpoint, then read the browser session from /json/version.
# webSocketDebuggerUrl looks like: ws://localhost:9222/devtools/browser/<GUID>
# The trailing <GUID> is the browser "session id".
# ---------------------------------------------------------------------------
if ! command -v curl >/dev/null 2>&1; then
  echo "chrome-remote-debug: curl not found; cannot read the session id" >&2
  echo "chrome-remote-debug: Chrome pid=${CHROME_PID}, endpoint=http://localhost:${PORT}" >&2
  exit 0
fi

WS_URL=""
for _ in $(seq 1 50); do
  VERSION_JSON="$(curl -fsS "http://localhost:${PORT}/json/version" 2>/dev/null || true)"
  if [ -n "${VERSION_JSON}" ]; then
    WS_URL="$(printf '%s' "${VERSION_JSON}" \
      | sed -n 's/.*"webSocketDebuggerUrl"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ -n "${WS_URL}" ] && break
  fi
  sleep 0.2
done

if [ -z "${WS_URL}" ]; then
  # Diagnose the common macOS failure: Chrome handed the launch off to an
  # already-running instance and ignored --remote-debugging-port.
  if grep -q "Opening in existing browser session" "${PROFILE}/chrome.log" 2>/dev/null; then
    echo "chrome-remote-debug: Chrome handed off to an already-running instance" >&2
    echo "chrome-remote-debug:   (\"Opening in existing browser session\") and ignored" >&2
    echo "chrome-remote-debug:   --remote-debugging-port=${PORT}, so the CDP endpoint never opened." >&2
    echo "chrome-remote-debug:   Fix: quit the running Chrome and retry —" >&2
    echo "chrome-remote-debug:     osascript -e 'tell application \"Google Chrome\" to quit'" >&2
    echo "chrome-remote-debug:   …or use Chrome for Testing (npx playwright install chromium), which" >&2
    echo "chrome-remote-debug:   macOS does not merge into your running Chrome." >&2
  else
    echo "chrome-remote-debug: timed out waiting for port ${PORT}; see ${PROFILE}/chrome.log" >&2
  fi
  exit 1
fi

SESSION_ID="${WS_URL##*/}"
CDP_ENDPOINT="http://localhost:${PORT}"

echo ""
echo "chrome-remote-debug: session ready"
echo "  pid          = ${CHROME_PID}"
echo "  port         = ${PORT}"
echo "  profile      = ${PROFILE}"
echo "  cdp endpoint = ${CDP_ENDPOINT}"
echo "  ws endpoint  = ${WS_URL}"
echo "  session id   = ${SESSION_ID}"
echo "  mode         = ${MODE}"
echo ""
echo "Open page targets (tabs):"
curl -fsS "http://localhost:${PORT}/json/list" \
  | sed -n 's/.*"url": "\([^"]*\)".*/  - \1/p' \
  | grep -v '^  - chrome-extension://' || echo "  (none yet — the connect example will create one)"
echo ""
echo "Use it with the SDK examples (mode: 'connect'):"
echo "  CDP_ENDPOINT=${CDP_ENDPOINT} npm run example:connect"
echo "  # or attach directly to this session:"
echo "  CDP_ENDPOINT='${WS_URL}' npm run example:connect"
echo ""
echo "Chrome is detached — it stays open after this terminal closes."
echo "Stop it with:  ./chrome-remote-debug.sh stop ${PORT}"
