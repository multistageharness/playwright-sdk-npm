# Makefile for playwright-sdk-npm
#
# Wraps the npm scripts + ./chrome-remote-debug.sh into CI-friendly targets.
# Usage:  make help
#
# Common flows:
#   make ci                     # install → browsers → typecheck → build (no browser)
#   make start-chrome           # launch a CDP-enabled Chrome (background, port 9222)
#   make example-connect        # run the connect example against it
#   make stop-chrome            # stop that Chrome

# ---- Config (override on the CLI: `make start-chrome PORT=9333`) -------------
PORT ?= 9222
NPM  ?= npm
# CHROME_HEADLESS=1 makes ./chrome-remote-debug.sh launch without a window
# (still serves CDP) — the right default for a headless CI box.
CHROME_HEADLESS ?=

SHELL := /bin/bash

.DEFAULT_GOAL := help

.PHONY: help install install-ci browsers typecheck build clean \
        start-chrome stop-chrome example example-connect example-csp \
        ci ci-full

## help: list available targets
help:
	@echo "Targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed -E 's/^## /  /'

# ---- Dependencies -----------------------------------------------------------

## install: install dependencies (local dev — respects package.json)
install:
	$(NPM) install

## install-ci: clean, reproducible install from the lockfile (CI)
install-ci:
	$(NPM) ci

## browsers: download the Playwright Chromium ("Chrome for Testing") binary
browsers:
	npx playwright install chromium

# ---- Quality / build --------------------------------------------------------

## typecheck: type-check the SDK and the examples (no emit)
typecheck:
	$(NPM) run typecheck

## build: compile TypeScript to dist/
build:
	$(NPM) run build

## clean: remove build output and example output
clean:
	rm -rf dist output

# ---- Chrome (CDP launcher) --------------------------------------------------

## start-chrome: launch a CDP-enabled Chrome in the background (PORT, CHROME_HEADLESS)
start-chrome:
	CHROME_HEADLESS=$(CHROME_HEADLESS) ./chrome-remote-debug.sh $(PORT)

## stop-chrome: stop the Chrome started on PORT
stop-chrome:
	./chrome-remote-debug.sh stop $(PORT)

# ---- Examples (require a running CDP Chrome — see start-chrome) --------------

## example: run the extract-element example (connect mode)
example:
	$(NPM) run example

## example-connect: run the connect-existing-chrome example
example-connect:
	$(NPM) run example:connect

## example-csp: run the CSP-friendly extraction example
example-csp:
	$(NPM) run example:csp

# ---- Aggregates -------------------------------------------------------------

## ci: install (lockfile) + browsers + typecheck + build
ci: install-ci browsers typecheck build

## ci-full: ci, then headless smoke of all three examples against a real Chrome
ci-full: ci
	CHROME_HEADLESS=1 ./chrome-remote-debug.sh $(PORT)
	HOLD_MS=0 $(NPM) run example
	HOLD=0    $(NPM) run example:connect
	$(NPM) run example:csp
	./chrome-remote-debug.sh stop $(PORT)
