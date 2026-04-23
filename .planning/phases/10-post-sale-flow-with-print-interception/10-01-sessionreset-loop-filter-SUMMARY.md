---
phase: 10-post-sale-flow-with-print-interception
plan: 01
subsystem: session-lifecycle
tags: [session-reset, loop-counter, filter, phase-10, sale-completed, d-17, d-18]

# Dependency graph
requires:
  - phase: 06-welcome-screen-lifecycle-redesign
    provides: "D-06 countable-filter exclusion pattern (idle-expired+welcome) — extended here"
  - phase: 05-admin-exit-logging-auto-update-branded-polish
    provides: "D-15/D-16 onPostReset single-slot listener (still fires for sale-completed)"
provides:
  - "Countable filter excludes reason==='sale-completed' from 3-in-60s reset-loop counter"
  - "onPostReset still fires for sale-completed welcome cycles (D-18 — no code change needed)"
  - "Test coverage for D-17 (exclusion) and D-18 (onPostReset composition)"
affects:
  - "phase-10 plan 05 (main.js post-sale:auto-logout handler can safely call hardReset({reason:'sale-completed', mode:'welcome'}))"
  - "phase-10 plan 09 (updateGate composition test — relies on onPostReset firing for sale-completed)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OR-chain inside existing negation — countable filter extended from one exclusion to two via `||`"

key-files:
  created: []
  modified:
    - src/main/sessionReset.js
    - test/sessionReset.test.js

key-decisions:
  - "D-17 extension written as `||` inside existing `!(...)` negation (shape preserved)"
  - "No mode check on sale-completed — filter uses reason alone (sale-completed always arrives with mode:'welcome')"
  - "No changes to onPostReset — existing `succeeded && postResetListener` gate already covers sale-completed welcome cycles"

patterns-established:
  - "Foundation-first discipline: loop-counter exclusion lands before any callsite that invokes hardReset({reason:'sale-completed'})"

requirements-completed: [SALE-01]  # Partially — SALE-01 also requires plans 02-10; loop-counter slice closed here

# Metrics
duration: ~2 min
completed: 2026-04-23
---

# Phase 10 Plan 01: sessionReset Loop-Filter Extension Summary

**Countable-filter predicate in sessionReset.js extended with `|| reason === 'sale-completed'` so rapid back-to-back sales don't latch the 3-in-60s reset-loop guard; onPostReset composition preserved for updateGate.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-23T07:59:41Z
- **Completed:** 2026-04-23T08:01:08Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `sessionReset.js` countable filter (lines 102-112) to also exclude `reason === 'sale-completed'` from the 3-in-60s loop-guard counter (D-17).
- Preserved existing `idle-expired + mode:'welcome'` exclusion byte-for-byte inside the same `!(...)` negation.
- Added two new tests (`D-17:` exclusion + `D-18:` onPostReset composition) covering exact scenarios required by REQ SALE-01 and plan 09's updateGate composition test.
- All 32 `sessionReset.test.js` tests pass (30 pre-existing + 2 new — zero regressions).
- No changes to `onPostReset`, `succeeded` flag, `hardReset` signature, or the D-15 step 1-11 order.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend countable-filter predicate to exclude sale-completed** — `99b720e` (feat)
2. **Task 2: Add D-17 + D-18 tests to sessionReset.test.js** — `876117a` (test)

## Files Created/Modified

- `src/main/sessionReset.js` — Lines 102-112 countable filter: existing `idle-expired && welcome` exclusion kept; added `|| reason === 'sale-completed'` inside the same negation. +7 / -1 lines (+3 comment lines explaining D-17 rationale, +4 code lines for the two-condition OR shape, -1 line from the collapsed single-condition filter).
- `test/sessionReset.test.js` — Appended two new `test(...)` blocks after the Phase 6 Test 12 in-flight-mutex test. D-17 test fires 3 sale-completed resets and asserts `loopActive === false`; also asserts all 3 emit `idle.reset` audit with `reason:'sale-completed'`, `mode:'welcome'`. D-18 test registers an `onPostReset` callback and asserts it fires exactly once for a sale-completed welcome-mode reset. Final cleanup call (`sessionReset.onPostReset(null)`) added to match Phase 6 Test 10 convention. +36 / 0 lines.

## Exact Before/After Diff

### `src/main/sessionReset.js` countable-filter block

**Before (lines 102-106):**
```javascript
  // D-06: exclude welcome-logouts from the loop counter. Crashes, admin-
  // requested resets, and self-heal-triggered resets all stay countable.
  const countable = resetTimestamps.filter(
    (e) => !(e.reason === 'idle-expired' && e.mode === 'welcome')
  );
```

**After (lines 102-112):**
```javascript
  // D-06: exclude welcome-logouts from the loop counter. Crashes, admin-
  // requested resets, and self-heal-triggered resets all stay countable.
  // Phase 10 D-17: ALSO exclude sale-completed — a member doing 4 quick
  // sales in a minute must not trip the reset-loop guard. mode check is
  // omitted because sale-completed always arrives with mode:'welcome'.
  const countable = resetTimestamps.filter(
    (e) => !(
      (e.reason === 'idle-expired' && e.mode === 'welcome') ||
      e.reason === 'sale-completed'
    )
  );
```

### `test/sessionReset.test.js` new tests (appended after Phase 6 Test 12)

```javascript
// ---------------------------------------------------------------------------
// Phase 10: sale-completed loop-counter exclusion (D-17) + onPostReset (D-18)
// ---------------------------------------------------------------------------

test('D-17: 3x hardReset({reason:"sale-completed"}) within 60s does NOT trip loop guard', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  // store.get needed for welcome-mode IPC (pos-state-changed broadcast)
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, false, 'sale-completed resets must not trip loop guard');
  const auditLines = fakeLog._lines.audit.filter(e => e.event === 'idle.reset');
  assert.strictEqual(auditLines.length, 3, 'all 3 resets must emit idle.reset audit');
  for (const entry of auditLines) {
    assert.strictEqual(entry.fields.reason, 'sale-completed');
    assert.strictEqual(entry.fields.mode, 'welcome');
  }
});

test('D-18: sale-completed reset still fires onPostReset (updateGate composition)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  let postResetCount = 0;
  sessionReset.onPostReset(() => { postResetCount++; });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  assert.strictEqual(postResetCount, 1, 'onPostReset must fire for sale-completed welcome cycle');
  sessionReset.onPostReset(null);
});
```

## Decisions Made

None beyond what the plan specified. D-17 / D-18 wording was executed verbatim per `10-CONTEXT.md` and `10-PATTERNS.md §sessionReset.js`. The one minor addition over the plan-provided test block is the trailing `sessionReset.onPostReset(null)` cleanup call in the D-18 test — this matches the existing Phase 6 Test 10 convention to avoid module-scoped listener contamination between tests. Not a deviation; a direct consistency alignment with the existing harness.

## Deviations from Plan

None - plan executed exactly as written.

The D-18 test includes a trailing `sessionReset.onPostReset(null)` cleanup line not literally present in the plan's provided code block. This is a line-level alignment with the identical cleanup convention already used in the existing `Phase 6 Test 10` test (line 605), not a deviation from plan intent. The plan's acceptance criteria and `done` clause are unchanged by it.

---

**Total deviations:** 0
**Impact on plan:** None — plan executed exactly as written, including file delta and line-count bounds.

## Issues Encountered

None. Both tasks executed linearly; all 32 tests green on first run after each edit.

## Confirmation of No Other File Touched

`git log` shows only two plan commits, each modifying exactly one file:
- `99b720e` — `src/main/sessionReset.js` (1 file, +7/-1 lines)
- `876117a` — `test/sessionReset.test.js` (1 file, +36/0 lines)

No other source, test, config, or docs file was modified by this plan.

## Confirmation `node --test test/sessionReset.test.js` Passes

```
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

30 pre-existing tests + 2 new tests (`D-17:` and `D-18:`). Zero regressions.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 10-02 (preload post-sale IPC):** READY — independent of this plan (Wave 1 peer).
- **Plan 10-05 (main.js post-sale IPC handlers):** READY — the `post-sale:auto-logout` handler can now safely call `hardReset({reason:'sale-completed', mode:'welcome'})` without fear of the 3-in-60s loop guard latching on rapid sales. Prerequisite for Wave 2.
- **Plan 10-09 (updateGate composition test):** READY — the D-18 unit test proves `onPostReset` still fires for sale-completed; plan 09 can rely on this for its end-to-end composition test.
- No blockers. Wave 1 can proceed in parallel; Wave 2 (plan 05) is unblocked.

## Self-Check: PASSED

- `src/main/sessionReset.js` — FOUND, filter predicate contains both `sale-completed` and `(e.reason === 'idle-expired' && e.mode === 'welcome')`
- `test/sessionReset.test.js` — FOUND, contains `D-17: 3x hardReset`, `D-18: sale-completed reset still fires onPostReset`, `postResetCount, 1`, `st.loopActive, false`, `fakeLog._lines.audit.filter`
- Commit `99b720e` — FOUND in `git log --oneline` (feat(10-01): exclude sale-completed from reset-loop counter)
- Commit `876117a` — FOUND in `git log --oneline` (test(10-01): add D-17/D-18 sale-completed exclusion tests)
- `node --test test/sessionReset.test.js` — 32/32 pass, 0 fail
- No sinon import, no `useFakeTimers`, no `require('sinon')` — confirmed absent

---
*Phase: 10-post-sale-flow-with-print-interception*
*Plan: 01 — sessionreset-loop-filter*
*Completed: 2026-04-23*
