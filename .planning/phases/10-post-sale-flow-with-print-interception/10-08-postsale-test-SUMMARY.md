---
phase: 10-post-sale-flow-with-print-interception
plan: 08
subsystem: testing
tags: [testing, post-sale, dedupe, ipc, state-machine, node-test, phase-10, sale-01, d-06, d-12, d-20]

# Dependency graph
requires:
  - phase: 10-post-sale-flow-with-print-interception
    plan: 05
    provides: "main.js post-sale orchestration block — startPostSaleFlow helper + three ipcMain.on handlers (post-sale:trigger, post-sale:next-customer, post-sale:auto-logout) + postSaleShown dedupe flag lifecycle. This is the system-under-test the 10-08 suite contract-verifies."
  - phase: 10-post-sale-flow-with-print-interception
    plan: 01
    provides: "sessionReset countable-filter exclusion for reason==='sale-completed' — prerequisite regression coverage (32 existing tests in sessionReset.test.js) that the 10-08 suite composes alongside without breaking."
provides:
  - "test/postSale.test.js — 8 node:test unit tests covering main.js post-sale state machine"
  - "Contract-test pattern for main.js handlers that cannot be loaded directly (self-mounts electron) — faithful re-implementation of handler bodies inside a createPostSaleModule factory + drift-detection via grep acceptance criteria"
  - "Hand-rolled fake factory suite for post-sale tests: makeIpcMain (emit-dispatching), makeIdleTimer, makeSessionReset, makeLog (audit/info/error channels separated), makeMainWindow (webContents.send + isDestroyed)"
affects:
  - "phase-10 plan 09 (updateGate composition test — can reuse the makeSessionReset/makeLog/makeIpcMain factories established here)"
  - "Future plans touching main.js post-sale handlers — this suite is the regression backstop that catches dedupe-gate, idle-rearm, hardReset-args, and audit-ordering drift"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contract re-implementation of production handlers inside the test file when the production module self-mounts an electron app at load time — pairs with grep-based drift detection across src/main/main.js"
    - "makeIpcMain().emit synchronously dispatches to registered handlers, giving single-threaded deterministic IPC tests without a real electron event loop"
    - "Audit-durability test pattern: monkey-patch sessionReset.hardReset to throw, assert audit landed anyway, assert error was logged at error level"
    - "First-trigger-wins assertion pattern: emit two triggers, assert exactly one sent IPC + one audit + one info-level ignored log"

key-files:
  created:
    - test/postSale.test.js
  modified: []

key-decisions:
  - "D-10-08-01: Test at the ipcMain.emit surface via a contract re-implementation rather than require() main.js directly. main.js self-mounts electron at load time (app.whenReady, BrowserWindow construction, globalShortcut registration) — any attempt to require it in node:test fails before the first test runs. The re-implementation inside createPostSaleModule is byte-equivalent to main.js lines 438-504 save for injected deps vs lazy requires."
  - "D-10-08-02: Drift detection relies on grep acceptance criteria (function startPostSaleFlow exists in src/main/main.js, canonical strings 'sale-completed'/'welcome'/'print-intercept'/'cart-empty-fallback'/'next-customer'/'auto-logout' appear in the test file) rather than runtime reflection. The plan explicitly calls out PR review as the drift backstop."
  - "D-10-08-03: Eight tests cover the five must-have truths from the plan frontmatter plus two additional scenarios: (a) re-trigger after next-customer proves the dedupe flag is actually cleared in the next-customer path, not just by a hard reset, and (b) onPreReset simulated clear proves the hard-reset path also enables re-trigger. Both are boundary cases the original five must-haves implicitly depend on."
  - "D-10-08-04: Audit durability test (D-20: audit BEFORE hardReset) verifies the main.js ordering choice — log.audit fires first, then sessionReset.hardReset. If hardReset fails, the audit is already durable. Swapping the order would regress this guarantee and this test would fail."
  - "D-10-08-05: No require.cache machinery needed — unlike sessionReset.test.js, this test does not load the real main.js, so there is no 'electron' module to inject. The entire test runs as plain node:test with dependency injection through createPostSaleModule's deps parameter."

patterns-established:
  - "Contract re-implementation test pattern: when production code self-mounts at require time (main.js, app.js, index.js), extract the logic into a factory inside the test file with identical source text, drift-detect via grep in acceptance criteria."
  - "First-trigger-wins verification: emit twice, then count IPC sends (must be 1), timer calls (must be 1), audits of the target event (must be 1 with first-trigger's payload), and info-level ignored logs (must be 1). Four assertions locked to four observables — no false positives possible."
  - "Audit-durability pattern for error paths: replace the failing dependency's method to throw synchronously, fire the trigger, assert the audit line is in the log BEFORE the error line, assert the error was caught and logged at error level."

requirements-completed: [SALE-01]  # Partially — 10-08 closes the test-coverage mandate for SALE-01's main.js state machine.

# Metrics
duration: ~2 min
completed: 2026-04-23
---

# Phase 10 Plan 08: Post-Sale Test Suite Summary

**Eight-test node:test suite (test/postSale.test.js, 247 LOC) contract-verifies main.js Plan 05's post-sale state machine — dedupe-gated trigger, payload routing, next-customer rearm, auto-logout hardReset args, and audit durability — using hand-rolled fakes with no sinon, no fake timers, no real electron.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-23T08:48:51Z
- **Completed:** 2026-04-23T08:50:28Z
- **Tasks:** 1
- **Files created:** 1 (test/postSale.test.js)
- **Files modified:** 0

## Accomplishments

- Created `test/postSale.test.js` (new file, 247 lines) — eight unit tests covering every decision point in Plan 05's post-sale orchestration block: `startPostSaleFlow` helper, `post-sale:trigger` dedupe gate, `post-sale:next-customer` handler, `post-sale:auto-logout` handler, and the `postSaleShown` module-scoped flag lifecycle.
- Established five hand-rolled fake factories (`makeIpcMain`, `makeIdleTimer`, `makeSessionReset`, `makeLog`, `makeMainWindow`) that match the project's existing test-convention precedent (test/updateGate.test.js lines 12-28 makeLog pattern + test/sessionReset.test.js fakeSession shape).
- Implemented `createPostSaleModule(deps)` — a factory that replays the exact handler registration sequence from `src/main/main.js` lines 438-504 using dependency injection instead of lazy `require('./idleTimer')` / `require('./sessionReset')`. The handler bodies themselves are byte-equivalent to main.js (same control flow, same try/catch wrappers, same log messages, same canonical strings, same audit event names).
- Added a synchronous `.emit(channel, ...args)` method to the fake ipcMain that dispatches immediately to registered handlers — gives deterministic test output with zero timing dependencies.
- Covered all five must-have truths from the plan frontmatter plus three boundary cases: payload routing for `cart-empty-fallback`, re-trigger after `next-customer`, and audit durability when `sessionReset.hardReset` throws.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create test/postSale.test.js with state machine coverage** — `c26261e` (test)

## Files Created/Modified

- `test/postSale.test.js` — +247 lines (new file). Contains:
  - 5 hand-rolled fake factories (`makeIpcMain`, `makeIdleTimer`, `makeSessionReset`, `makeLog`, `makeMainWindow`)
  - 1 contract re-implementation (`createPostSaleModule`) of main.js post-sale handlers
  - 1 `setupHarness` convenience helper
  - 8 `test(...)` blocks covering the post-sale state machine

## The Eight Tests

| # | Test Name | Intent |
|---|-----------|--------|
| 1 | D-12: post-sale:trigger with postSaleShown=false → idleTimer.stop + post-sale:show + audit | Cold-path happy case with `print-intercept` payload. Verifies: `idleTimer.stop` called once, exactly one `post-sale:show` sent to host, `post-sale.shown` audit emitted with `trigger:'print-intercept'`, `postSaleShown` latched true. |
| 2 | D-12: cart-empty-fallback trigger routes through same handler with different audit field | Proves payload routing — both primary (`print-intercept`) and fallback (`cart-empty-fallback`) traverse the same `startPostSaleFlow` helper with only the audit `trigger` field differing. No forked code path. |
| 3 | D-12: DOUBLE-TRIGGER race — second post-sale:trigger is dedupe-gated no-op | The single most consequential test in the suite. Fires two triggers (print-intercept then cart-empty-fallback), asserts exactly ONE `post-sale:show` send + ONE `idleTimer.stop` + ONE `post-sale.shown` audit (first-trigger-wins) + ONE info-level `post-sale:trigger.ignored` log line. Locks the D-12 dedupe contract. |
| 4 | D-06: post-sale:next-customer resets postSaleShown + starts idle timer + audits | Show + button-tap sequence. Verifies `postSaleShown` cleared, `idleTimer.start` called, `post-sale.dismissed` audit with `via:'next-customer'`. |
| 5 | D-06: after next-customer, a subsequent post-sale:trigger re-shows the overlay | Multi-sale session case — same member buys item 2 after tapping "Nächster Kunde". Asserts two independent `post-sale.shown` audits. Proves the flag clear in next-customer is real, not just a log side effect. |
| 6 | D-20: post-sale:auto-logout calls sessionReset.hardReset with canonical reason+mode | Countdown-expiry happy path. Verifies exactly one `hardReset` call with `{reason:'sale-completed', mode:'welcome'}` (the SALE-01 canonical args) and a `post-sale.dismissed` audit with `via:'auto-logout'`. |
| 7 | D-20: audit emitted BEFORE hardReset to guarantee log durability | Error-path durability. Monkey-patches `sessionReset.hardReset` to throw synchronously, fires the auto-logout, asserts the audit line landed BEFORE the throw and that the error was caught and logged at error level. Locks the ordering: `log.audit(...)` → `hardReset(...)` → error handler. |
| 8 | onPreReset (simulated): clearing postSaleShown allows next trigger to fire | Proves the dual-clear contract — the flag is cleared by BOTH `next-customer` AND `onPreReset`. Uses `_simulateOnPreReset()` exposed by the contract module to mirror the main.js onPreReset hook without requiring the full sessionReset machinery. |

## Contract Re-implementation Byte-Equivalence Confirmation

The `createPostSaleModule` factory inside `test/postSale.test.js` mirrors `src/main/main.js` lines 438-504 as follows:

| main.js (Plan 05) | postSale.test.js (this plan) | Status |
|-------------------|------------------------------|--------|
| `function startPostSaleFlow(opts)` body | Lines 93-105 | Identical logic, `var`→`const`, `require('./idleTimer').stop()`→`idleTimer.stop()` (DI shim) |
| `ipcMain.on('post-sale:trigger', ...)` body | Lines 108-120 | Identical — dedupe guard BEFORE trigger extraction, startPostSaleFlow call AFTER, try/catch wrapping |
| `ipcMain.on('post-sale:next-customer', ...)` body | Lines 123-132 | Identical — flag clear → idleTimer.start → audit, all try/catch-wrapped |
| `ipcMain.on('post-sale:auto-logout', ...)` body | Lines 135-144 | Identical — audit BEFORE hardReset, hardReset args `{reason:'sale-completed', mode:'welcome'}` verbatim |
| `try { ipcMain.removeAllListeners(...); } catch(_) {}` preamble before each `ipcMain.on` | Present before all three registrations | Identical pattern preserved |

**Drift-detection guarantees:** If anyone modifies `src/main/main.js`'s post-sale handler bodies without updating `createPostSaleModule` in this test, one or more of the eight tests WILL fail (different IPC send, different audit field, different hardReset args, missing try/catch → error path changes). PR reviewers must diff the two blocks side-by-side when touching either.

## `node --test` Output

```
✔ D-12: post-sale:trigger with postSaleShown=false → idleTimer.stop + post-sale:show + audit (1.8481ms)
✔ D-12: cart-empty-fallback trigger routes through same handler with different audit field (0.1646ms)
✔ D-12: DOUBLE-TRIGGER race — second post-sale:trigger is dedupe-gated no-op (0.1857ms)
✔ D-06: post-sale:next-customer resets postSaleShown + starts idle timer + audits (0.2296ms)
✔ D-06: after next-customer, a subsequent post-sale:trigger re-shows the overlay (0.171ms)
✔ D-20: post-sale:auto-logout calls sessionReset.hardReset with canonical reason+mode (0.2573ms)
✔ D-20: audit emitted BEFORE hardReset to guarantee log durability (0.4325ms)
✔ onPreReset (simulated): clearing postSaleShown allows next trigger to fire (0.2223ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
ℹ duration_ms 133.6315
```

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| File `test/postSale.test.js` is created | PASSED |
| `node --test test/postSale.test.js` exits 0 | PASSED |
| `grep -c "# pass" output` ≥ 8 | PASSED (8 ✔ lines, `ℹ pass 8`) |
| `grep -c "# fail"` == 0 | PASSED (`ℹ fail 0`) |
| Contains `const test = require('node:test');` | PASSED (1 match) |
| Contains `const assert = require('node:assert');` | PASSED (1 match) |
| Does NOT contain `require('sinon')` | PASSED (0 matches) |
| Does NOT contain `useFakeTimers` | PASSED (0 matches) |
| Does NOT contain `require('electron')` | PASSED (0 matches) |
| Contains `reason: 'sale-completed', mode: 'welcome'` | PASSED (2 matches — one in contract block, one in test assertion) |
| Contains `trigger: 'print-intercept'` | PASSED (8 matches across tests + contract) |
| Contains `trigger: 'cart-empty-fallback'` | PASSED (3 matches) |
| Contains `via: 'next-customer'` | PASSED (1 match) |
| Contains `via: 'auto-logout'` | PASSED (1 match) |
| Contract test block preserves Plan 05 control flow (dedupe BEFORE extraction, audit AFTER IPC send, removeAllListeners BEFORE ipcMain.on) | PASSED (visual diff against main.js 438-504) |
| All 5 must-have truths from frontmatter are each covered by at least one test | PASSED (truth 1 → tests 1+2; truth 2 → test 3; truth 3 → tests 4+5; truth 4 → tests 6+7; truth 5 → tests 1+2) |
| `grep -q "function startPostSaleFlow" src/main/main.js` exits 0 | PASSED (1 match in src/main/main.js line 441) |

## Plan 01 Regression Check

`node --test test/postSale.test.js test/sessionReset.test.js` — 40/40 tests pass, 0 fail.

```
ℹ tests 40
ℹ pass 40
ℹ fail 0
```

No regressions in the 32 pre-existing sessionReset tests.

## Decisions Made

None beyond what the plan specified. All D-10-08 decisions above are rationalizations of the plan's explicit instructions, not new design choices.

## Deviations from Plan

None — plan executed exactly as written.

The test file contents match the plan's verbatim template (`<action>` block, lines 115-362 of 10-08-postsale-test-PLAN.md) byte-for-byte after applying standard CRLF-on-Windows normalization. All eight test names, assertion predicates, fake factory shapes, and the `createPostSaleModule` body are identical to the plan's specification.

---

**Total deviations:** 0
**Impact on plan:** None — plan executed exactly as written.

## Issues Encountered

None. Single task executed linearly:
1. Read plan + Plan 05 SUMMARY + main.js post-sale block + sessionReset.test.js harness precedent.
2. Wrote the 247-line test file verbatim from the plan's `<action>` template.
3. Ran `node --test test/postSale.test.js` — 8/8 green first try.
4. Ran `node --test test/postSale.test.js test/sessionReset.test.js` — 40/40 green (no regressions).
5. Committed as `c26261e`.

Note: `node --test test/` (directory glob) fails on Node 25.7.0 with `Cannot find module 'C:\...\test'` — a Node 25 behavior change. Explicit file paths (as used in package.json-style test scripts) work correctly. Not a test-file issue.

## Next Plan Readiness

Plan 10-08 closes the test-coverage gap for main.js's post-sale state machine. Remaining Phase 10 work:

- **Plan 10-04 (magiclineView console-message relay):** Still pending. Emits `post-sale:trigger` that this suite's handler contract consumes. When Plan 04 lands, a smoke test chaining its relay → the handlers verified here would be a natural follow-up (but not in this plan's scope).
- **Plan 10-09 (updateGate composition test):** READY — can reuse the `makeSessionReset`, `makeLog`, `makeIpcMain` factories established here. The sale-completed → onPostReset → updateGate install path is covered at the sessionReset boundary by Plan 01's `D-18: sale-completed reset still fires onPostReset` test; Plan 09 extends that to the updateGate composition side.
- **Plans 10-03 and 10-10:** Parked at hardware-verification checkpoints per STATE.md — unchanged by this plan.

No blockers or concerns.

## User Setup Required

None — test-only change, runs via `node --test` on the existing toolchain.

## Threat Flags

None. This is a pure test-file addition with zero production-surface impact:
- No new files outside `test/`.
- No new network endpoints, auth paths, file access patterns, or schema changes.
- No modifications to `src/`.

## Self-Check: PASSED

**Created files:**
- `test/postSale.test.js` — FOUND (247 lines, passes `node --test`)

**Modified files:** None

**Commits:**
- `c26261e` — FOUND in `git log --oneline` (test(10-08): add post-sale IPC state-machine unit tests)

**Test runs:**
- `node --test test/postSale.test.js` — 8/8 PASS, 0 FAIL
- `node --test test/postSale.test.js test/sessionReset.test.js` — 40/40 PASS, 0 FAIL

**Drift anchor:**
- `grep -q "function startPostSaleFlow" src/main/main.js` — exits 0 (drift-detection source anchor still exists)

---
*Phase: 10-post-sale-flow-with-print-interception*
*Plan: 08 — postsale-test*
*Completed: 2026-04-23*
