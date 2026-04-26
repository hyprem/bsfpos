---
phase: 11
plan: 01
subsystem: session-reset
tags: [session-reset, loop-counter, filter, phase-11, pos-closed, tests]
requires:
  - sessionReset.hardReset({reason, mode}) signature (Phase 4)
  - succeeded && postResetListener gate (Phase 5 D-15/D-16)
  - countable filter predicate (Phase 6 D-06 + Phase 10 D-17)
provides:
  - "reason='pos-closed' excluded from 3-in-60s reset-loop counter"
  - "onPostReset fires for pos-closed welcome cycles (test-locked)"
affects:
  - src/main/sessionReset.js (filter predicate +5 lines)
  - test/sessionReset.test.js (+36 lines, 2 new test cases)
tech-stack:
  added: []
  patterns:
    - byte-mirror of Phase 10 D-17/D-18 implementation (single-line OR-extension + paired filter+onPostReset tests)
key-files:
  created: []
  modified:
    - src/main/sessionReset.js
    - test/sessionReset.test.js
decisions:
  - "D-05 implemented verbatim per 11-CONTEXT: third OR clause `e.reason === 'pos-closed'` appended after sale-completed clause; mode check intentionally omitted (pos-closed always arrives with mode:'welcome')"
  - "D-06 requires zero code change — existing `succeeded && postResetListener` gate already covers welcome-mode pos-closed resets; new D-06 test documents the behavior contract"
  - "D-07 test placement: appended at EOF under new Phase 11 banner, AFTER unchanged Phase 10 D-17/D-18 block; matches phase chronology in source order"
metrics:
  duration_seconds: 87
  completed: 2026-04-26
---

# Phase 11 Plan 01: sessionReset pos-closed Filter Summary

**One-liner:** Extended `sessionReset.js` countable-filter predicate with a third OR clause excluding `reason === 'pos-closed'` from the 3-in-60s reset-loop counter, and locked the behavior with two new tests (D-05 exclusion + D-06 onPostReset firing) — byte-mirror of Phase 10 D-17/D-18 for the new pos-closed reason.

## Goal

Enable Phase 11 Plan 11-02's `case 'toggle-pos-open'` admin handler to call `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` without tripping the IDLE-05 reset-loop guard, while preserving `onPostReset` firing for `updateGate` composition (admin-closed-window trigger).

## What Was Built

### Task 1 — Countable filter extension (`src/main/sessionReset.js`)

**Before** (lines 102-112):

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

**After** (lines 102-116):

```javascript
// D-06: exclude welcome-logouts from the loop counter. Crashes, admin-
// requested resets, and self-heal-triggered resets all stay countable.
// Phase 10 D-17: ALSO exclude sale-completed — a member doing 4 quick
// sales in a minute must not trip the reset-loop guard. mode check is
// omitted because sale-completed always arrives with mode:'welcome'.
// Phase 11 D-05: ALSO exclude pos-closed — admin closing/opening POS
// repeatedly during diagnostics must not trip the loop guard. mode check
// is omitted because pos-closed always arrives with mode:'welcome'.
const countable = resetTimestamps.filter(
  (e) => !(
    (e.reason === 'idle-expired' && e.mode === 'welcome') ||
    e.reason === 'sale-completed' ||
    e.reason === 'pos-closed'
  )
);
```

**Delta:** +4 net lines (3 new comment lines + 1 new OR clause line). One existing line (`e.reason === 'sale-completed'`) gained a trailing `||`. Order of OR clauses inside the negation: idle-expired+welcome → sale-completed → pos-closed (chronological by phase).

**Untouched:** `onPostReset`, `succeeded` flag, audit call, mutex logic, D-15 step order, `hardReset` signature. The new clause is a strict superset of the Phase 10 predicate.

**Commit:** `6c89281` — `feat(11-01): exclude pos-closed from reset-loop counter`

### Task 2 — D-05 + D-06 tests (`test/sessionReset.test.js`)

Appended verbatim at EOF, after the unchanged Phase 10 D-18 test (line 666 pre-edit), under a new banner:

```javascript
// ---------------------------------------------------------------------------
// Phase 11: pos-closed loop-counter exclusion (D-05) + onPostReset (D-06)
// ---------------------------------------------------------------------------

test('D-05: 3x hardReset({reason:"pos-closed"}) within 60s does NOT trip loop guard', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  // store.get needed for welcome-mode IPC (pos-state-changed broadcast)
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  await sessionReset.hardReset({ reason: 'pos-closed', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'pos-closed', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'pos-closed', mode: 'welcome' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, false, 'pos-closed resets must not trip loop guard');
  // All 3 must have emitted audit events (not suppressed)
  const auditLines = fakeLog._lines.audit.filter(e => e.event === 'idle.reset');
  assert.strictEqual(auditLines.length, 3, 'all 3 resets must emit idle.reset audit');
  // Assert the reason field is tagged correctly
  for (const entry of auditLines) {
    assert.strictEqual(entry.fields.reason, 'pos-closed');
    assert.strictEqual(entry.fields.mode, 'welcome');
  }
});

test('D-06: pos-closed reset still fires onPostReset (updateGate composition)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  let postResetCount = 0;
  sessionReset.onPostReset(() => { postResetCount++; });
  await sessionReset.hardReset({ reason: 'pos-closed', mode: 'welcome' });
  assert.strictEqual(postResetCount, 1, 'onPostReset must fire for pos-closed welcome cycle');
  // Clear post listener to avoid contamination across tests via module-scoped state.
  sessionReset.onPostReset(null);
});
```

**Delta:** +36 lines (2 new test cases + 4-line banner comment + blank lines). No imports added. Uses existing `resetAll()`, `makeFakeMainWindow()`, `fakeLog._lines.audit`, `sessionReset._getStateForTests()` helpers — no new factories.

**Phase 10 tests preserved byte-for-byte:**
- D-17 sale-completed exclusion test still at lines 636-654 (unchanged).
- D-18 sale-completed onPostReset test still at lines 656-666 (unchanged).

**Commit:** `bfe565b` — `test(11-01): add D-05/D-06 pos-closed exclusion + onPostReset tests`

## Verification

### Test pass count delta

| Run | Tests | Pass | Fail |
|-----|-------|------|------|
| Pre-Plan-11-01 baseline | 32 | 32 | 0 |
| Post-Plan-11-01 | 34 | 34 | 0 |
| Delta | +2 | +2 | 0 |

```
✔ D-17: 3x hardReset({reason:"sale-completed"}) within 60s does NOT trip loop guard (0.3808ms)
✔ D-18: sale-completed reset still fires onPostReset (updateGate composition) (0.1523ms)
✔ D-05: 3x hardReset({reason:"pos-closed"}) within 60s does NOT trip loop guard (0.2047ms)
✔ D-06: pos-closed reset still fires onPostReset (updateGate composition) (0.1229ms)
ℹ tests 34
ℹ pass 34
ℹ fail 0
```

### Acceptance criteria — Task 1

| Criterion | Result |
|-----------|--------|
| `grep -c "pos-closed" src/main/sessionReset.js >= 1` | 3 (filter clause + 2 comment lines) |
| `grep -c "sale-completed" src/main/sessionReset.js >= 1` | 3 (Phase 10 preserved) |
| `grep -c "idle-expired" src/main/sessionReset.js >= 1` | 1 (Phase 6 preserved) |
| Contains `e.reason === 'pos-closed'` | Yes |
| Contains `e.reason === 'sale-completed'` | Yes |
| Contains `(e.reason === 'idle-expired' && e.mode === 'welcome')` | Yes |
| Contains `Phase 11 D-05` comment | Yes |
| `node --test test/sessionReset.test.js` exits 0 | Yes |
| Line delta within +4 to +5 | +4 net (close to spec) |
| OR clause order: idle-expired → sale-completed → pos-closed | Yes |
| No changes to onPostReset, succeeded, hardReset signature, mutex, D-15 step order | Yes |

### Acceptance criteria — Task 2

| Criterion | Result |
|-----------|--------|
| `node --test test/sessionReset.test.js` exits 0 | Yes |
| Contains `D-05: 3x hardReset({reason:"pos-closed"})` | Yes |
| Contains `D-06: pos-closed reset still fires onPostReset` | Yes |
| Contains `Phase 11: pos-closed loop-counter exclusion (D-05)` | Yes |
| Contains `entry.fields.reason, 'pos-closed'` | Yes |
| Contains `postResetCount, 1` | Yes |
| Contains `st.loopActive, false` | Yes |
| Contains cleanup `sessionReset.onPostReset(null)` after D-06 test | Yes |
| `grep -c "test('D-05:" test/sessionReset.test.js` returns 1 | 1 |
| `grep -c "test('D-06:" test/sessionReset.test.js` returns 1 | 1 |
| `grep -c "test('D-17:" test/sessionReset.test.js` returns 1 (preserved) | 1 |
| `grep -c "test('D-18:" test/sessionReset.test.js` returns 1 (preserved) | 1 |
| No sinon import, no `useFakeTimers`, no new top-of-file requires | Yes |

## Phase 11 Success Criterion 3 — locked

> "The new 'pos-closed' reason is excluded from the 3-in-60 s reset-loop counter, and `onPostReset` still fires"

- D-05 test asserts `loopActive === false` after 3 rapid `pos-closed` resets — locks the exclusion.
- D-06 test asserts `postResetCount === 1` after one `pos-closed` welcome reset — locks the updateGate composition.

Both behaviors are now regression-protected. Plan 11-02 (toggle-pos-open handler) can safely call `hardReset({reason:'pos-closed', mode:'welcome'})` without the loop-guard concern, and updateGate's `admin-closed-window` trigger will compose identically to `sale-completed` and `idle-expired`.

## Deviations from Plan

None — plan executed exactly as written. The byte-mirror template from Phase 10 D-17/D-18 transferred without surprise. No deviation rules (Rule 1/2/3/4) triggered.

## Self-Check: PASSED

- File `src/main/sessionReset.js` modified — confirmed (commit `6c89281`, +5/-1 lines).
- File `test/sessionReset.test.js` modified — confirmed (commit `bfe565b`, +36/-0 lines).
- Commit `6c89281` exists in git log — confirmed.
- Commit `bfe565b` exists in git log — confirmed.
- All 34 tests pass under `node --test test/sessionReset.test.js` — confirmed.
- Phase 10 D-17 test at line 636 preserved — confirmed (read of lines 632-666 shows byte-identical text).
- Phase 10 D-18 test at line 656 preserved — confirmed.
- No other files modified — confirmed via `git status` clean after both commits.
