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
PROFILE="${CHROME_DEBUG_PROFILE:-${TMPDIR:-/tmp}/chrome-remote-debug-${PORT}}"
mkdir -p "${PROFILE}"

FLAGS=(
  "--remote-debugging-port=${PORT}"
  "--user-data-dir=${PROFILE}"
  "--no-first-run"
  "--no-default-browser-check"
  "--start-maximized"
)

echo "chrome-remote-debug: launching ${BIN}" >&2
echo "chrome-remote-debug:   port    = ${PORT}" >&2
echo "chrome-remote-debug:   profile = ${PROFILE}" >&2

# Launch windowed (non-headless) in the background.
"${BIN}" "${FLAGS[@]}" >"${PROFILE}/chrome.log" 2>&1 &
CHROME_PID=$!

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
  echo "chrome-remote-debug: timed out waiting for port ${PORT}; see ${PROFILE}/chrome.log" >&2
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
echo ""
echo "Use it with the SDK examples (mode: 'connect'):"
echo "  CDP_ENDPOINT=${CDP_ENDPOINT} npm run example:connect"
echo "  # or attach directly to this session:"
echo "  CDP_ENDPOINT='${WS_URL}' npm run example:connect"
echo ""
echo "Stop it with:  ./chrome-remote-debug.sh stop ${PORT}"
