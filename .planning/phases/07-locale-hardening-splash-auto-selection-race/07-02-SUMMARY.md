---
phase: 07-locale-hardening-splash-auto-selection-race
plan: "02"
subsystem: main
tags: [locale, session, webRequest, electron, LOCALE-01]
dependency_graph:
  requires: [07-01 LOCALE_STRINGS.de table in fragile-selectors.js]
  provides: [LOCALE-01 layers 1 and 2 — appendSwitch + Accept-Language override]
  affects: [src/main/main.js, src/main/logger.js]
tech_stack:
  added: []
  patterns: [session.fromPartition webRequest.onBeforeSendHeaders for header override]
key_files:
  created: []
  modified:
    - src/main/main.js
    - src/main/logger.js
decisions:
  - "appendSwitch('lang', 'de-DE') placed at top-of-file immediately after require('electron') destructure — before any app.* call — to avoid Electron historical silent no-op inside whenReady handler"
  - "webRequest listener uses no URL filter — persist:magicline partition is already isolated to Magicline traffic so unfiltered is cheaper and avoids allowlist drift"
  - "Header key uses exact casing 'Accept-Language' (not lowercase) to avoid duplicate-header issue documented in 07-RESEARCH.md §2"
  - "startup.locale and auto-select.result added to logger.js taxonomy comment only — no behavioural change to log.audit"
metrics:
  duration_minutes: ~5
  completed_date: "2026-04-14"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 07 Plan 02: LOCALE-01 Belt-and-Suspenders Locale Enforcement Summary

**One-liner:** Belt-and-suspenders German locale enforcement via appendSwitch('lang','de-DE') + persist:magicline Accept-Language webRequest override, with startup.locale audit line and taxonomy update.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add --lang=de-DE switch and persist:magicline Accept-Language override | d0068bb | src/main/main.js |
| 2 | Register auto-select.result and startup.locale in logger.js taxonomy | 53b04e9 | src/main/logger.js |

## What Was Built

### Task 1 — main.js (two edits)

**Layer 1 (appendSwitch):** `app.commandLine.appendSwitch('lang', 'de-DE')` inserted at top-of-file immediately after the `require('electron')` destructure. This must run before `app.whenReady()` — Electron issues #17995/#26185 show that placing it inside the whenReady handler causes a silent no-op. Affects `navigator.language`, `app.getLocale()`, and the default Accept-Language on document loads.

**Layer 2 (webRequest override):** `session.fromPartition('persist:magicline').webRequest.onBeforeSendHeaders` listener registered inside `app.whenReady().then(...)` immediately after `idleTimer.init(mainWindow)` — before the `ipcMain.on('welcome:tap', ...)` handler is registered. This guarantees the very first Magicline document request (triggered by `createMagiclineView` inside the welcome:tap handler) already carries `Accept-Language: de-DE,de;q=0.9`. No URL filter applied — the partition is already isolated to Magicline traffic.

`log.audit('startup.locale', { lang: app.getLocale() })` emitted immediately after the listener is installed so kiosk-visit inspectors can grep the effective boot locale.

### Task 2 — logger.js (comment-only edit)

`startup.locale` and `auto-select.result` added to the canonical taxonomy comment block (Phase 5 D-28). No behavioural change to `log.audit`.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: header-override | src/main/main.js | webRequest.onBeforeSendHeaders mutates outgoing Accept-Language on persist:magicline — this is the intended T-07-03 mitigation; no new unintended surface |

T-07-03 (listener registered too late) is fully mitigated: the listener is now registered before `welcome:tap` can fire. T-07-05 (information disclosure of fixed locale) accepted per plan threat register — single-tenant kiosk, locale is non-sensitive.

## Self-Check: PASSED

| Item | Result |
|------|--------|
| src/main/main.js contains appendSwitch('lang', 'de-DE') | FOUND |
| appendSwitch byte offset < app.whenReady().then() byte offset | CONFIRMED (1030 < 11304) |
| src/main/main.js contains session.fromPartition('persist:magicline') | FOUND |
| src/main/main.js contains onBeforeSendHeaders | FOUND |
| src/main/main.js contains 'Accept-Language' | FOUND |
| src/main/main.js contains 'de-DE,de;q=0.9' | FOUND |
| src/main/main.js destructures session from require('electron') | FOUND |
| src/main/main.js contains log.audit('startup.locale' | FOUND |
| src/main/logger.js contains auto-select.result | FOUND |
| src/main/logger.js contains startup.locale | FOUND |
| Commit d0068bb | FOUND |
| Commit 53b04e9 | FOUND |
| node --test test/logger.audit.test.js | 8/8 PASS |
