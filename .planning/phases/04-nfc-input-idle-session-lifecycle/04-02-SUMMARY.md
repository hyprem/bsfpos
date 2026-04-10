---
phase: 04-nfc-input-idle-session-lifecycle
plan: 02
subsystem: main-process/session-reset
tags: [electron, session, mutex, reset-loop, idle, crash-recovery, tdd]
requires: [magiclineView, logger, electron.session]
provides: [sessionReset.hardReset, sessionReset.init, reset-loop-latch]
affects: [persist:magicline session storage, splash:show IPC, show-magicline-error IPC]
tech-stack:
  added: []
  patterns: [module-scoped-state, try-finally-mutex, rolling-window-counter, lazy-require]
key-files:
  created:
    - src/main/sessionReset.js
    - test/sessionReset.test.js
  modified: []
decisions:
  - Unified idle+crash counter (D-18) — single rolling window instead of per-reason windows
  - Lazy require of ./idleTimer and ./magiclineView to break circular-dep potential with Plan 04-01
  - Fake idleTimer via Module._resolveFilename hook in tests so Plan 04-02 does not depend on Plan 04-01's idleTimer.js existing on disk
  - Corrected D-15 step 5 typo (show-splash → splash:show) per RESEARCH pitfall 3
metrics:
  tests: 16
  tests_passing: 16
  lines_production: 173
  lines_tests: 411
  duration_minutes: ~25
completed: 2026-04-10
---

# Phase 4 Plan 02: Session Reset Module Summary

`sessionReset.hardReset({reason})` is now the single public entry point for all kiosk hard resets (idle expiry, crash recovery in Plan 04-03, admin menu in Phase 5). The module enforces the D-15 11-step sequence, guards concurrent calls with an in-flight `resetting` mutex cleared in `finally`, and latches `loopActive` when 3 resets land within a unified 60-second rolling window.

## What Was Built

- **`src/main/sessionReset.js`** (173 lines) — single-entry-point reset module:
  - `init({mainWindow, store})` — wires module-scoped dependencies
  - `hardReset({reason})` — async entry point, enforces D-15 step order
  - `_resetForTests()` / `_getStateForTests()` — test-only helpers
  - Exports constants `_RESET_WINDOW_MS = 60_000` and `_RESET_LOOP_THRESHOLD = 3`

- **`test/sessionReset.test.js`** (411 lines, 16 tests) — unit suite:
  - 1st hardReset runs all 11 D-15 steps in exact observable order
  - 2nd concurrent hardReset while `resetting=true` is suppressed (logs `in-flight`)
  - `resetting` cleared in `finally` even when `clearStorageData` rejects
  - `clearStorageData` called with exactly 6 storage types
  - `cookies.flushStore()` awaited AFTER clearStorageData AND BEFORE createMagiclineView
  - `destroyMagiclineView` called BEFORE `createMagiclineView` (Pitfall 2)
  - `splash:show` IPC sent BEFORE `destroyMagiclineView` (step 5 before step 6)
  - `idleTimer.stop` called BEFORE `splash:show` (step 4 before step 5)
  - 3 rapid calls within 60s: 1st+2nd succeed, 3rd trips `loopActive`
  - After `loopActive` set, subsequent calls suppressed (logs `loop-active`)
  - Loop trip emits `sessionReset.loop-detected:` error log with reasons array
  - Unified counter: idle+crash+idle within 60s trips loop (D-18)
  - Reset older than 60s is filtered out of rolling window
  - Reason tagging: each timestamps entry is `{t, reason}`
  - `hardReset` without prior `init()` throws clearly-named error
  - `sessionReset.hardReset: reason=... count=N` log line fires on each non-suppressed call

## Test Results

```
node --test test/sessionReset.test.js
tests 16
pass  16
fail  0
```

All 16 tests green. Pure module load (`node -e "require('./src/main/sessionReset')"`) exits 0 with no side effects.

## Verification Against Plan Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| File exists + exports init/hardReset/_resetForTests/_getStateForTests | OK |
| Exactly 6 storage types (cookies, localstorage, sessionstorage, serviceworkers, indexdb, cachestorage) | OK |
| `'splash:show'` appears exactly once | OK (line 110) |
| `'show-splash'` typo literal absent from source | OK |
| `flushStore` present | OK (line 132) |
| `persist:magicline` appears exactly once | OK (line 119) |
| `'reset-loop'` appears exactly once | OK |
| `loopActive = true` appears exactly once | OK |
| `resetting = true` appears exactly once (outside test helper) | OK |
| `finally` appears exactly once | OK |
| `RESET_LOOP_THRESHOLD = 3` present | OK |
| `RESET_WINDOW_MS` used at least twice | OK |
| `sessionReset.suppressed:` log | OK |
| `sessionReset.loop-detected:` log | OK |
| `sessionReset.hardReset: reason=` log | OK |
| Lazy require of `./idleTimer` inside hardReset body (NOT top-of-file) | OK (line 106) |
| Lazy require of `./magiclineView` inside hardReset body | OK (line 116) |
| 16 unit tests all passing | OK |

## Lazy Require Confirmation

Both dependencies that could create circular load cycles with Plan 04-01 (`idleTimer`) and Phase 2 (`magiclineView`) are required lazily INSIDE the `hardReset` function body, NOT at module top:

- `src/main/sessionReset.js:106` — `require('./idleTimer').stop();`
- `src/main/sessionReset.js:116` — `const { destroyMagiclineView, createMagiclineView } = require('./magiclineView');`

Top-level imports are only `electron` (for `session`) and `./logger`. This means:
1. Plan 04-01's `idleTimer.js` does not need to exist on disk for `sessionReset.js` to load — the failing `require` only fires when `hardReset()` is actually called.
2. The circular edge `idleTimer → sessionReset → idleTimer` (where idleTimer's expiry callback calls sessionReset.hardReset, and sessionReset's step 4 calls idleTimer.stop) is broken into two non-overlapping load-time graphs.

## D-15 Typo Correction

Per RESEARCH Pitfall 3: the D-15 canonical text writes step 5 as the hyphenated form (`show-splash`). The correct channel per the Phase 1 IPC convention (`src/host/host.js`, `src/main/preload.js`) is `splash:show` (colon-separated). `sessionReset.js` emits `mainWindow.webContents.send('splash:show')` at line 110 and the hyphenated literal does not appear anywhere in the file.

## Storage Types Exact Match

`clearStorageData({ storages: [...] })` passes exactly these 6 strings, in this order:

```
'cookies', 'localstorage', 'sessionstorage',
'serviceworkers', 'indexdb', 'cachestorage'
```

No `filesystem`, no `shadercache`, no `websql`, no `'all'` shortcut — exactly as D-15 mandates and T-04-10 accepts.

## Deviations from RESEARCH Pattern 4

None. The implementation follows RESEARCH Pattern 4 verbatim: module-scoped state, 60_000 ms window, threshold of 3, unified counter across reasons, `try { … } finally { resetting = false }` tail, exactly 6 storages, flushStore awaited between clearStorageData and createMagiclineView, `show-magicline-error {variant:'reset-loop'}` emission on loop trip.

## Auto-fixed Issues

None. The implementation was written once against the plan, passed all 16 tests on the first run after the test mock was upgraded to hook `Module._resolveFilename` for the not-yet-existing `./idleTimer` sibling module (a pure test-infra adjustment, not a production code fix).

## Threat Model Coverage

All four `mitigate` dispositions in the plan's threat register are enforced:

- **T-04-07 (DoS / reset-loop storm)** — rolling 60s counter + loopActive latch, unit tested by the "3 rapid calls" and "unified counter" cases.
- **T-04-08 (Spoofing / session bleed)** — 6 explicit storage types + cookies.flushStore awaited before createMagiclineView, unit tested by step-order and storage-list cases. (100-cycle cross-reset harness lives in Plan 04-05.)
- **T-04-09 (Tampering / concurrent resets)** — `resetting` flag set before first await, cleared in finally, unit tested by concurrent-call and clear-on-reject cases.
- **T-04-11 (DoS / unhandled rejection stuck mutex)** — try/finally covers the async body; `resetting` cleared even when `clearStorageData` rejects, unit tested.

T-04-10 (residual storage in filesystem/shadercache) remains `accept` per plan — revisit in Plan 04-05 if the 100-cycle harness shows bleed.

## Known Stubs

None. `sessionReset.js` is self-contained and wired purely to stable Phase 1–3 interfaces. No placeholder data, no hardcoded empty values, no "TODO" markers.

## Commits

- `8283b1e` test(04-02): add failing tests for sessionReset D-15 sequence + loop guard
- `8ec8980` feat(04-02): implement sessionReset.hardReset

## Self-Check: PASSED

- src/main/sessionReset.js — FOUND
- test/sessionReset.test.js — FOUND
- commit 8283b1e — FOUND
- commit 8ec8980 — FOUND
- 16/16 tests passing — VERIFIED
