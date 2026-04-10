---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 03
subsystem: auto-update-safe-window
tags: [auto-update, safe-window, session-reset, event-hook, ADMIN-07]
requires:
  - src/main/sessionReset.js (Phase 4, extended with onPostReset hook)
  - src/main/logger.js (log.audit, from Plan 05-01)
provides:
  - sessionReset.onPostReset(cb) — single listener, fires only on successful hardReset
  - updateGate.onUpdateDownloaded({installFn, log, sessionResetModule, getHour?}) — safe-window gate
  - updateGate.isMaintenanceWindow(getHour?) — hour ∈ {3,4}
  - First-of (post-reset | 03:00–05:00) semantic with one-shot install guarantee
affects:
  - Plan 05-04 (main orchestration) will wire updateGate to electron-updater's real
    NsisUpdater 'update-downloaded' event and inject quitAndInstall as installFn
  - Phase 4 sessionReset contract preserved (11-step D-15 flow untouched)
tech-stack:
  added: []
  patterns:
    - Pure dependency-injected module (no electron import in updateGate.js)
    - Surgical append-only edit to Phase 4 sessionReset (27 lines added, 0 modified in
      existing D-15 step sequence)
    - Local `succeeded` flag inside hardReset try/finally to guarantee listener fires
      only on successful unwind (not on throws, not on early-return short-circuits)
    - Fake-clock injection via optional `getHour` param for deterministic unit tests
    - Monkey-patched setInterval in tests to make timer-based triggers synchronous
key-files:
  created:
    - src/main/updateGate.js
    - test/updateGate.test.js
    - test/sessionReset.postReset.test.js
  modified:
    - src/main/sessionReset.js (+27 lines: postResetListener state, onPostReset export,
      succeeded flag, conditional fire block, _resetForTests clear)
decisions:
  - Single listener (not EventEmitter) — updateGate is the only consumer, multi-listener
    complexity unneeded
  - postResetListener fire placed OUTSIDE try/finally and gated by local `succeeded`
    flag set as the last line inside the try — ensures failed resets (throws in steps
    4–10) do NOT emit a bogus "clean slate" signal (T-05-17)
  - Fire wrapped in try/catch so a listener bug cannot break sessionReset
  - Double-arm of updateGate clears prior gate first (D-17: admin menu re-check during
    waiting gate must not leak timers)
  - On any fire, updateGate explicitly unregisters its post-reset listener via
    sessionResetModule.onPostReset(null) to defuse stale references
  - updateGate has NO electron import — installFn is dependency-injected so the module
    is pure-testable and Plan 05-04 owns the NsisUpdater wiring
  - Maintenance window is hours [3,4] (03:00–04:59) per D-15, polled once per minute
metrics:
  duration: "~3 min execution (across two executor sessions due to mid-plan continuation)"
  completed: 2026-04-10
  tasks: 3
  commits: 3
requirements: [ADMIN-07]
---

# Phase 5 Plan 03: Update Gate & Session Hook Summary

**One-liner:** Added `sessionReset.onPostReset(cb)` — a minimal single-listener hook that fires only on successful hardReset — and shipped `src/main/updateGate.js`, a pure electron-free module that gates `electron-updater` `quitAndInstall` behind the first-of (post-reset "clean slate" event | 03:00–05:00 maintenance window), closing ADMIN-07 with 12 new unit tests and zero regressions in the Phase 4 sessionReset suite.

## What Shipped

### Modified: `src/main/sessionReset.js` (+27 lines, Task 1 — commit 0f5ecc8)

Surgical append-only extensions to the Phase 4 D-15 flow:

- **New module-scoped state:** `let postResetListener = null;`
- **New exported function:** `onPostReset(cb)` — stores `cb` (replaces prior) or clears on `null`/non-function
- **Local `succeeded` flag inside `hardReset`:** set `false` before `resetting = true`, flipped to `true` as the last line inside `try` (after `createMagiclineView`)
- **Conditional fire block** after the `try/finally`:
  ```javascript
  if (succeeded && postResetListener) {
    try { postResetListener(); }
    catch (e) { log.error('sessionReset.postReset-listener-threw: ' + (e && e.message)); }
  }
  ```
- **`_resetForTests()` cleared** to also reset `postResetListener = null`
- **`module.exports`** gains `onPostReset`
- **Phase 4 contracts preserved:** all 11 D-15 step comments intact (`grep -c "D-15 step" = 4` markers + full inline comments), 100-cycle harness passes unchanged, no existing symbol renamed

### New Module: `src/main/updateGate.js` (Task 2 — commit 34ec3e6)

Exports:

- `onUpdateDownloaded({installFn, log, sessionResetModule, getHour?})` — arms both trigger paths
- `isMaintenanceWindow(getHour?)` — returns `true` iff `hour ∈ {3, 4}`
- `_resetForTests()`, `_isArmedForTests()`
- Constants: `_MAINTENANCE_POLL_MS = 60_000`, `_MAINTENANCE_HOUR_START = 3`, `_MAINTENANCE_HOUR_END = 5`

Behavior:

1. **On arm:** clears any prior gate, resets `fired=false`, calls `log.audit('update.downloaded', {gateState:'waiting'})`
2. **Trigger (a) — maintenance window:** `setInterval(60_000)` polls `isMaintenanceWindow()`; on match → `fireWith('maintenance-window')`
3. **Trigger (b) — post-reset:** registers via `sessionResetModule.onPostReset(...)`; callback → `fireWith('post-reset')`
4. **First-wins:** `fireWith(trigger)` is idempotent via `if (fired) return; fired = true;` — clears both listeners, unregisters post-reset listener, emits `log.audit('update.install', {trigger})`, calls `installFn()` inside a try/catch so a throwing `quitAndInstall` is logged (not propagated)
5. **Input validation:** throws on missing `installFn`, `log.audit`, or `sessionResetModule.onPostReset`
6. **NO `require('electron')`** — installFn is injected, making the module pure-testable and leaving Plan 05-04 to wire the real `NsisUpdater.quitAndInstall`

### New Tests: `test/sessionReset.postReset.test.js` (4 tests) + `test/updateGate.test.js` (8 tests) (Task 3 — commit 754f8db)

`sessionReset.postReset.test.js` (mirrors Phase 4 test stubbing: require.cache overrides for `electron`, `logger`, `magiclineView`, `idleTimer`):

1. Listener fires exactly once after successful `hardReset`
2. Listener does NOT fire when the second of two concurrent resets is suppressed by the in-flight mutex (first fires normally)
3. Listener does NOT fire on loop-detected short-circuit (3rd reset in window — fires on calls 1 & 2 only)
4. `onPostReset(null)` clears the listener

`updateGate.test.js` (pure — no cache stubs needed):

1. `isMaintenanceWindow`: all 24 hours checked, only h=3 and h=4 return `true`
2. Arm emits `update.downloaded` audit with `{gateState:'waiting'}`, no immediate install
3. Post-reset trigger fires `installFn` exactly once; second fire is no-op; audit trigger = `'post-reset'`
4. Maintenance-window trigger fires via monkey-patched `setInterval`; timer cleared after fire; audit trigger = `'maintenance-window'`
5. First-wins: post-reset beats maintenance when both are armed
6. Double-arm clears prior gate (first installFn NEVER called, second fires)
7. Throws clearly on missing `installFn` / `log.audit` / `sessionResetModule`
8. Throwing `installFn` is logged via `log.error`, NOT propagated (`doesNotThrow`)

## Verification Results

- `node --check src/main/sessionReset.js` → exit 0
- `node --check src/main/updateGate.js` → exit 0
- `node --test test/sessionReset.postReset.test.js test/updateGate.test.js` → **12/12 pass**
- `node --test test/*.test.js` (full suite) → **242/242 pass** — Phase 4 regression clean
- `git diff --stat` for sessionReset.js vs Phase 4 baseline → 27 insertions, 0 modifications inside the existing D-15 step sequence
- `grep -c "D-15 step" src/main/sessionReset.js` → 4 step-marker comments unchanged; full per-step inline comments still present
- `grep -n "onPostReset" src/main/sessionReset.js` → 4 matches (state decl comment, function def, export, 1 more in comment — above floor of 3)
- No `require('electron')` in `src/main/updateGate.js` (verified via grep)

## Threat Mitigations Delivered

| Threat | Mitigation | Evidence |
|--------|-----------|----------|
| T-05-13 (update mid-transaction) | Install only after post-reset or 03:00–05:00 | Tests 3 & 4 prove installFn not called without one of those two triggers; `getHour: () => 12` case shows arm alone does nothing |
| T-05-14 (double-install) | `fired` latch + first-wins `clearGate()` | Test 5 (first-wins) + "second post-reset is no-op" in test 3 |
| T-05-16 (no audit trail) | `log.audit('update.downloaded')` on arm + `log.audit('update.install', {trigger})` on fire | Tests 2, 3, 4 assert both audits |
| T-05-17 (bogus clean-slate from suppressed reset) | `succeeded` flag set only as last line inside `try` | sessionReset.postReset tests 2 & 3 assert no-fire on in-flight and loop-detected paths |

T-05-15 (clock-tamper) remains accepted per plan — standard-user Windows account from Phase 1 hardening denies clock-set.

## Deviations from Plan

None — plan executed exactly as written. Task 3 test file contents matched the plan's snippet verbatim after confirming the stubbing pattern (require.cache overrides for `electron`, `logger`, `magiclineView`, `idleTimer`) aligned with the existing passing `test/sessionReset.test.js` harness. The plan's snippet for `sessionReset.postReset.test.js` did not include a `logger` stub; added one to prevent the real logger from being loaded during tests (real logger loads `electron-log/main` which is fine outside Electron but would write to real rotating log files during test runs). This is a test-hygiene adjustment, not a behavioral deviation.

## Execution Notes

This plan was executed across two executor sessions due to a mid-plan interruption after Task 2. The continuation executor verified both prior commits (`0f5ecc8` Task 1, `34ec3e6` Task 2) were present on `master`, ran Task 3 (tests only), and did NOT re-do Tasks 1–2. No rewrites, no rebases.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `0f5ecc8` | feat(05-03): add onPostReset hook to sessionReset for updateGate |
| 2 | `34ec3e6` | feat(05-03): add updateGate safe-window installer gate |
| 3 | `754f8db` | test(05-03): add unit tests for onPostReset hook and updateGate |

## Self-Check

- `src/main/sessionReset.js` — FOUND
- `src/main/updateGate.js` — FOUND
- `test/sessionReset.postReset.test.js` — FOUND
- `test/updateGate.test.js` — FOUND
- Commit `0f5ecc8` — FOUND
- Commit `34ec3e6` — FOUND
- Commit `754f8db` — FOUND

## Self-Check: PASSED
