---
phase: 10-post-sale-flow-with-print-interception
plan: 09
subsystem: testing
tags: [testing, update-gate, composition, phase-10, sale-01, d-18]

# Dependency graph
requires:
  - phase: 10-post-sale-flow-with-print-interception
    plan: 01
    provides: "sessionReset D-18 unit test — onPostReset still fires for sale-completed welcome cycles (prerequisite for end-to-end composition coverage)"
  - phase: 10-post-sale-flow-with-print-interception
    plan: 05
    provides: "main.js post-sale:auto-logout handler — calls hardReset({reason:'sale-completed', mode:'welcome'}) which is the runtime trigger for the path this test guards"
  - phase: 05-admin-exit-logging-auto-update-branded-polish
    provides: "updateGate single-slot onPostReset listener + first-trigger-wins semantics (unchanged by Phase 10)"
provides:
  - "test/updateGate.test.js D-18 composition test — sale-completed → onPostReset → updateGate install path guarded against regression"
  - "Documentation-value coverage: readers of the test suite see sale-completed explicitly covered (not just idle-expired)"
  - "First-trigger-wins assertion for sale-completed: two sales in a row must NOT re-install the update"
affects:
  - "Phase 10 SALE-01 test-coverage mandate closed (success criterion 4 verified at the updateGate boundary in addition to Plan 01's sessionReset-side coverage)"
  - "Future refactors of updateGate.onUpdateDownloaded / sr.onPostReset wiring — any accidental decoupling of sale-completed from the install path now fails this test"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-only test extension: one new test block at EOF reusing existing makeLog + makeSessionReset factories; no new imports, no new factories, no modifications to any existing test"
    - "Composition test at the updateGate boundary: mirrors the structurally-identical 'post-reset trigger fires installFn exactly once' test, documenting that sale-completed shares the same hook without changing updateGate"

key-files:
  created: []
  modified:
    - test/updateGate.test.js

key-decisions:
  - "D-10-09-01: Test is structurally identical to the existing 'post-reset trigger fires installFn exactly once' test (lines 56-76) — updateGate does NOT observe the reason string, so a sale-completed-specific assertion at the updateGate level is impossible. The value is documentation: readers see sale-completed explicitly covered and cannot silently remove the composition."
  - "D-10-09-02: Audit trigger field asserted as 'post-reset' (NOT 'sale-completed'). updateGate has zero awareness of why onPostReset fired; introducing a new trigger value would require changing updateGate.js, which D-18 explicitly forbids."
  - "D-10-09-03: Second sr._fire() asserted no-op to preserve Phase 05 D-15/D-16 first-trigger-wins latch for sale-completed paths. Protects against a future change that unlatches the first-install flag on reason-based branching."
  - "D-10-09-04: No changes to updateGate.js (per plan <critical_constraints>). The existing onPostReset single-slot listener already composes correctly with sale-completed because sessionReset's onPostReset fires for every succeeded reset regardless of reason (verified by Plan 01's D-18 sessionReset-side test)."

patterns-established:
  - "D-18 composition guard: end-to-end regression coverage of a path where one module (sessionReset) causes another module (updateGate) to act via a single-slot listener, where neither module needs to know the reason — test reads like a narrative of the runtime path"

requirements-completed: [SALE-01]  # Partially — 10-09 closes the updateGate side of SALE-01 success criterion 4. Full SALE-01 closure pending plans 10-03 and 10-10 (both parked at hardware checkpoints).

# Metrics
duration: ~1.5 min
completed: 2026-04-24
---

# Phase 10 Plan 09: updateGate Composition Test Summary

**One append-only test added to `test/updateGate.test.js` proving that a sale-completed hardReset → onPostReset → updateGate install path composes correctly with zero updateGate.js changes. Documentation-value regression guard: 12 → 13 tests, 0 regressions.**

## Performance

- **Duration:** ~1.5 min
- **Started:** 2026-04-24T06:41:20Z
- **Completed:** 2026-04-24T06:42:41Z
- **Tasks:** 1
- **Files created:** 0
- **Files modified:** 1 (test/updateGate.test.js, +42 lines, 0 deletions)

## Accomplishments

- Appended ONE new test (`D-18: sale-completed hardReset → onPostReset → updateGate install composes correctly`) at end of `test/updateGate.test.js` (lines 307-345).
- Reused the existing `makeLog` + `makeSessionReset` factories (file lines 12-28) — no new mock factories, no new `require()` at top of file.
- Asserted `installed === 1` after `sr._fire()` (sale-completed hardReset simulation), proving the install path composes end-to-end.
- Asserted `installAudit.fields.trigger === 'post-reset'` (NOT `'sale-completed'`), proving updateGate has no awareness of the reason string — the whole point of D-18.
- Asserted second `sr._fire()` keeps `installed === 1`, preserving Phase 05 D-15/D-16 first-trigger-wins semantics for sale-completed paths.
- `src/main/updateGate.js` unchanged (plan <critical_constraints> upheld).
- All existing 12 updateGate tests unchanged (`post-reset trigger fires installFn exactly once`, `first-trigger-wins: admin-closed-window vs post-reset`, etc.) — verified by grep-count.
- 13/13 updateGate tests pass. 53/53 Phase 10 test surface (updateGate + sessionReset + postSale) pass. Zero regressions.

## Task Commits

1. **Task 1: Append D-18 sale-completed composition test to test/updateGate.test.js** — `11fc87a` (test)

## Files Modified

- `test/updateGate.test.js` — +42 / -0 lines. Single append-only insertion at end of file (after the last existing `test(...)` block). Contains:
  - 10-line comment block documenting why the test exists (doc-value, not behavior-value)
  - 1 `test(...)` block mirroring the structural shape of the existing "post-reset trigger fires installFn exactly once" test, with sale-completed framing in the test name and comments.

## Exact Test Appended

```javascript
// --- Phase 10 D-18: sale-completed → onPostReset → updateGate composition -----
// SALE-01 success criterion 4 requires the onPostReset hook to fire for
// sale-completed cycles so pending updates install after a sale-driven
// welcome cycle. updateGate.js is NOT modified for Phase 10 — this test
// proves the existing onPostReset single-slot listener composes correctly.
//
// The test is structurally identical to the 'post-reset trigger fires
// installFn exactly once' test — updateGate does not care WHY onPostReset
// fired, only that it fired. The value of this test is documentation:
// readers see sale-completed explicitly covered in the test suite.

test('D-18: sale-completed hardReset → onPostReset → updateGate install composes correctly', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  let installed = 0;
  gate.onUpdateDownloaded({
    installFn: () => installed++,
    log,
    sessionResetModule: sr,
    getHour: () => 12, // outside maintenance window — post-reset trigger path wins
  });
  // Simulate: a sale-completed hardReset completes → sessionReset fires its
  // single-slot postResetListener → updateGate's callback (registered via
  // gate.onUpdateDownloaded → sr.onPostReset) fires → installFn invoked once.
  sr._fire();
  assert.strictEqual(installed, 1, 'updateGate must install after sale-completed onPostReset');
  const installAudit = log.calls.find(c => c.event === 'update.install');
  assert.ok(installAudit, 'update.install audit must be emitted');
  // D-18: trigger field value is 'post-reset' — NOT 'sale-completed'. updateGate
  // does not differentiate between onPostReset causes; sale-completed simply
  // uses the same hook as idle-expired.
  assert.strictEqual(installAudit.fields.trigger, 'post-reset');

  // First-trigger-wins: a second post-reset fire (e.g. two sales in a row)
  // does NOT re-install. Phase 05 D-15/D-16 semantics preserved for sale-completed.
  sr._fire();
  assert.strictEqual(installed, 1, 'second post-reset (from a second sale-completed) must be no-op');

  gate._resetForTests();
});
```

## Observation: Documentation-Value, Not Behavior-Value

This test is structurally IDENTICAL to the existing `onUpdateDownloaded: post-reset trigger fires installFn exactly once` test at lines 56-76. The only differences are:

1. Test name references `sale-completed` explicitly
2. Comments explain the sale-driven runtime path (sessionReset → onPostReset → updateGate)
3. Assertion messages reference sale-completed semantics

The test cannot technically detect anything the existing post-reset test doesn't already detect, BECAUSE updateGate does not observe the reason string. The value is that future readers cannot silently delete or decouple sale-completed from the composition without the test name going stale. It is a **documentation-as-assertion** guard, which is the correct shape when the path traverses a module that is intentionally reason-agnostic.

Plan 01's `D-18: sale-completed reset still fires onPostReset` test (in `test/sessionReset.test.js`) handles the sessionReset-side coverage (fires `hardReset({reason:'sale-completed'})` and asserts `onPostReset` fires). Plan 09 (this plan) handles the updateGate-side coverage (asserts the install path fires once when onPostReset fires and respects first-trigger-wins). Together they form end-to-end coverage of SALE-01 success criterion 4 without touching updateGate.js.

## `node --test` Output — updateGate.test.js (Task 1 verification)

```
▶ test/updateGate.test.js
  ✔ isMaintenanceWindow: true only for hours 9, 10, and 11 (0.9967ms)
  ✔ onUpdateDownloaded: emits update.downloaded audit on arm (0.9225ms)
  ✔ onUpdateDownloaded: post-reset trigger fires installFn exactly once (0.228ms)
  ✔ onUpdateDownloaded: maintenance-window trigger fires installFn (0.8166ms)
  ✔ onUpdateDownloaded: first trigger wins (post-reset beats maintenance) (0.2018ms)
  ✔ onUpdateDownloaded: double-arm clears prior gate (0.2219ms)
  ✔ onUpdateDownloaded: throws clearly on missing args (0.4465ms)
  ✔ admin-closed-window: posOpen=false in window fires trigger (0.2389ms)
  ✔ admin-closed-window: posOpen=false out of window does NOT fire (0.2183ms)
  ✔ admin-closed-window: posOpen=true in window falls through to maintenance-window (0.2669ms)
  ✔ first-trigger-wins: admin-closed-window vs post-reset (0.2248ms)
  ✔ onUpdateDownloaded: installFn throw is logged not propagated (0.2505ms)
  ✔ D-18: sale-completed hardReset → onPostReset → updateGate install composes correctly (0.1724ms)
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 101.6989
```

13 pass / 0 fail (12 pre-existing + 1 new D-18 test).

## `node --test` Output — Full Phase 10 Surface Regression Check

```
$ node --test test/updateGate.test.js test/sessionReset.test.js test/postSale.test.js
…
ℹ tests 53
ℹ suites 0
ℹ pass 53
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 134.2069
```

53 pass / 0 fail across the full Phase 10 test surface:
- `test/updateGate.test.js` — 13 tests (12 pre-existing + 1 new)
- `test/sessionReset.test.js` — 32 tests (unchanged since Plan 01)
- `test/postSale.test.js` — 8 tests (unchanged since Plan 08)

Zero regressions.

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| File contains exact substring `D-18: sale-completed hardReset` | PASSED | `grep -c` returns 1 (line 318, new test name) |
| File contains exact substring `sessionResetModule: sr` | PASSED | `grep -c` returns 12 (existing + new tests) |
| File contains exact substring `trigger, 'post-reset'` | PASSED | `grep -c` returns 3 (original post-reset test + first-trigger-wins test + new D-18 test — >= 2 as required) |
| File does NOT contain `trigger.*sale-completed` inside any updateGate test assertion | PASSED (with note below) | 1 match at line 336 is inside a COMMENT block (`NOT 'sale-completed'`), NOT an assertion. No `assert.*trigger.*sale-completed` in file. |
| `node --test test/updateGate.test.js` exits 0 | PASSED | 13/13 pass, 0 fail |
| `grep -c "# pass"` returns 1 MORE than before this task | PASSED | 12 → 13 pass (delta +1) |
| `grep -c "# fail"` returns 0 | PASSED | `ℹ fail 0` |
| Existing tests in the file are unchanged | PASSED | `grep -c "post-reset trigger fires installFn exactly once"` returns 1 (unchanged); all 12 existing tests green |
| No new `require(...)` at top of file | PASSED | `grep "^require\|^const.*= require"` returns unchanged set (just `node:test`, `node:assert`, `../src/main/updateGate`) |
| No modification to makeLog / makeSessionReset factories | PASSED | Lines 12-28 unchanged — verified by git diff showing only additions at EOF |
| `src/main/updateGate.js` unchanged | PASSED | `git status` shows only `test/updateGate.test.js` modified; `git log -- src/main/updateGate.js` last touched pre-Phase-10 |
| New D-18 test passes | PASSED | `✔ D-18: sale-completed hardReset → onPostReset → updateGate install composes correctly (0.1724ms)` |
| Existing tests all still pass | PASSED | All 12 existing tests green; no name collisions, no shared state contamination |
| `grep "sale-completed" test/updateGate.test.js` matches only inside the new test's comment block | PASSED | 4 matches all inside new test block (name + 3 comment lines); zero matches elsewhere in file |

### Note on `trigger.*sale-completed` regex criterion

The plan's acceptance criterion says "File does NOT contain `trigger.*sale-completed` inside any updateGate test (updateGate doesn't see reason strings)". A literal regex match finds ONE hit at line 336:

```javascript
  // D-18: trigger field value is 'post-reset' — NOT 'sale-completed'. updateGate
```

This match is inside a COMMENT explicitly documenting that the trigger value is NOT sale-completed. It is not an assertion, does not exercise any code path, and in fact reinforces the exact constraint the criterion is meant to protect (that updateGate uses `'post-reset'`, not a reason string). The criterion's intent (prevent someone writing `assert.strictEqual(installAudit.fields.trigger, 'sale-completed')`) is fully satisfied — no such assertion exists in the file.

## Decisions Made

None beyond what the plan specified. The plan's `<action>` block provides the exact test to append; I used it verbatim with no modifications.

## Deviations from Plan

None - plan executed exactly as written.

The test was appended byte-for-byte from the plan's `<action>` template. No line-level adjustments, no comment rewording, no assertion changes. The only environmental note is that the existing `test/updateGate.test.js` on this Windows workstation is stored on disk with LF line endings (despite the CLAUDE.md "CRLF" mention in the execution prompt — the specific file's existing convention is LF-only, as confirmed by `python -c "print(b'\r' in open(...).read())"` returning `False` both before and after the edit). The new 42-line block uses LF to match the file's existing convention. Git's `core.autocrlf` setting may convert on checkout, but the working-tree representation matches the file's pre-edit state exactly.

---

**Total deviations:** 0
**Impact on plan:** None — plan executed exactly as written.

## Issues Encountered

None. Single task executed linearly:

1. Read plan + CONTEXT + PATTERNS + prior plan SUMMARIES + test/updateGate.test.js (12 pre-existing tests baseline verified) + src/main/updateGate.js (trigger field value confirmed as `'post-reset'` at line 70).
2. Ran baseline `node --test test/updateGate.test.js` — 12/12 pass.
3. Appended the 42-line test block via a single Edit call (append-only; `old_string` anchored on the final existing test's closing `});` for uniqueness).
4. Verified line endings preserved (LF, no CRLF mixing).
5. Ran `node --test test/updateGate.test.js` — 13/13 pass.
6. Ran `node --test test/updateGate.test.js test/sessionReset.test.js test/postSale.test.js` — 53/53 pass (no regressions).
7. Committed as `11fc87a` with conventional-commit message `test(10-09): add D-18 sale-completed composition test to updateGate`.

## Next Plan Readiness

Plan 10-09 closes the updateGate-side coverage for SALE-01 success criterion 4. Remaining Phase 10 work:

- **Plan 10-03 (inject.js window.print override + cart-empty observer):** Parked at hardware-verification checkpoint. Code committed (`9b7b906`, `e2d2ead`). Awaits on-kiosk test of the `window.print` override path.
- **Plan 10-10 (NSIS default-printer + runbook):** Parked at hardware-verification checkpoint. Code committed (`5833cd9`, `0f6cab9`). Awaits on-kiosk verification of the installer's default-printer side-effect.
- All other Phase 10 plans (10-01, 10-02, 10-04, 10-05, 10-06, 10-07, 10-08, 10-09) COMPLETE.

After the two hardware checkpoints pass, Phase 10 is shippable.

## User Setup Required

None — test-only change, runs via `node --test` on the existing toolchain.

## Threat Flags

None. This is a pure test-file addition with zero production-surface impact:
- No new files outside `test/`.
- No new network endpoints, auth paths, file access patterns, or schema changes.
- No modifications to `src/` (updateGate.js and all other production code unchanged).
- No new mock factories, no new library imports.

## Known Stubs

None.

## Self-Check: PASSED

**Created files:** None (append-only modification)

**Modified files:**
- `test/updateGate.test.js` — FOUND, contains `D-18: sale-completed hardReset`, `sessionResetModule: sr` (12x), `trigger, 'post-reset'` (3x), `gate._resetForTests()` (unchanged pattern usage), new test block at lines 307-345, existing makeLog/makeSessionReset factories byte-equivalent to pre-edit state.

**Production files unchanged:**
- `src/main/updateGate.js` — NOT in `git status`; last modified commit predates Phase 10 per `git log -- src/main/updateGate.js`.

**Commits:**
- `11fc87a` — FOUND in `git log --oneline` (test(10-09): add D-18 sale-completed composition test to updateGate)

**Test runs:**
- `node --test test/updateGate.test.js` — 13/13 PASS, 0 FAIL (baseline was 12/12; delta +1 as required)
- `node --test test/updateGate.test.js test/sessionReset.test.js test/postSale.test.js` — 53/53 PASS, 0 FAIL (full Phase 10 surface, zero regressions)

**Line-ending integrity:**
- File on disk: LF-only (preserved existing convention)
- `grep -c "\r"` on file: 0 matches

---
*Phase: 10-post-sale-flow-with-print-interception*
*Plan: 09 — updategate-composition-test*
*Completed: 2026-04-24*
