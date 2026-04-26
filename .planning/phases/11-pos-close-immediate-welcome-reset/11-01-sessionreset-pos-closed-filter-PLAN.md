---
phase: 11-pos-close-immediate-welcome-reset
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/sessionReset.js
  - test/sessionReset.test.js
autonomous: true
requirements: [ADMIN-02]
tags: [session-reset, loop-counter, filter, phase-11, pos-closed]
must_haves:
  truths:
    - "hardReset({reason:'pos-closed', mode:'welcome'}) called 3x in <60s does NOT latch loopActive"
    - "hardReset({reason:'pos-closed'}) still fires onPostReset for updateGate integration"
    - "Existing idle-expired+welcome and sale-completed exclusions are preserved byte-for-byte"
  artifacts:
    - path: "src/main/sessionReset.js"
      provides: "Extended countable filter excluding reason==='pos-closed'"
      contains: "reason === 'pos-closed'"
    - path: "test/sessionReset.test.js"
      provides: "D-05 exclusion test + D-06 onPostReset test for pos-closed"
      contains: "pos-closed"
  key_links:
    - from: "src/main/sessionReset.js"
      to: "countable filter predicate (lines 107-112 post-Phase-10)"
      via: "||-separated OR inside existing negation, third clause"
      pattern: "reason === 'pos-closed'"
    - from: "test/sessionReset.test.js"
      to: "sessionReset._getStateForTests().loopActive"
      via: "3x hardReset({reason:'pos-closed', mode:'welcome'}) + assert loopActive === false"
      pattern: "loopActive, false"
---

<objective>
Extend `sessionReset.js` countable-filter predicate to exclude `reason === 'pos-closed'` from the 3-in-60s reset-loop counter (D-05), and append two new tests proving the exclusion (D-07 test 1) and that `onPostReset` still fires (D-06 / D-07 test 2). This is the foundation for Phase 11 — the main.js toggle-pos-open handler (Plan 11-02) calls `hardReset({reason:'pos-closed'})`, and that path must not trip the loop guard.

Purpose: Per Phase 11 success criterion 3 ("The new 'pos-closed' reason is excluded from the 3-in-60 s reset-loop counter, and `onPostReset` still fires"), this plan lands the filter extension and the two test cases that lock the behavior in.

Pattern source: Byte-mirror of Phase 10 D-17/D-18 implementation (Plan 10-01). The only differences from 10-01 are the reason string ('pos-closed' vs 'sale-completed') and the comment annotation ('Phase 11 D-05' vs 'Phase 10 D-17').

Output: Single-line OR addition in `sessionReset.js` countable filter + two new test cases appended to `sessionReset.test.js`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-01-sessionreset-loop-filter-PLAN.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@./CLAUDE.md

<interfaces>
<!-- Current sessionReset.js countable filter (post-Phase-10, lines 102-112).
     Phase 11 extends with a third clause inside the existing OR. -->

From src/main/sessionReset.js (lines 102-112, current after Phase 10):
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

From src/main/sessionReset.js (hardReset signature, line 73):
```javascript
async function hardReset({ reason, mode } = {}) { ... }
// mode normalized at entry: (mode === 'welcome') ? 'welcome' : 'reset'
```

From src/main/sessionReset.js (onPostReset gate — already covers welcome-mode resets, no code change for D-06):
```javascript
// Welcome-mode branch sets succeeded=true, so onPostReset fires for
// pos-closed welcome cycles automatically — same composition as
// sale-completed (Phase 10 D-18).
if (succeeded && postResetListener) { postResetListener(); }
```

From test/sessionReset.test.js harness (verified):
- Helper functions: `resetAll()` (line 139), `makeFakeMainWindow()` (line 129)
- Fakes: `fakeLog._lines.audit[]` (line 64), `callLog[]`, `fakeSession`
- Module: `const sessionReset = require('../src/main/sessionReset');` (line 123)
- State accessors: `sessionReset._resetForTests()`, `sessionReset._getStateForTests()`
- Phase 10 sale-completed tests live at lines 632-666 — the pos-closed tests append AFTER those, in their own block.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend countable-filter predicate to exclude pos-closed</name>
  <read_first>
    - src/main/sessionReset.js (current state — single source of truth for the predicate, lines 102-112)
    - .planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md §Decisions D-05 (canonical filter shape)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-01-sessionreset-loop-filter-PLAN.md (byte-mirror template — Phase 11 D-05 follows the exact same shape)
  </read_first>
  <files>src/main/sessionReset.js</files>
  <action>
Modify the countable filter at lines 107-112 of `src/main/sessionReset.js`. Add a third clause to the existing OR inside the negation, per D-05.

**Exact current code (lines 102-112, do NOT modify the comment block at lines 102-106 — extend it by appending a Phase 11 line):**
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

**Exact target code (replace the block above with):**
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

Do NOT modify any other line in the file. Do NOT touch `onPostReset`, `succeeded` flag, audit call, mutex logic, or any other piece — per D-06, `onPostReset` fires automatically for `pos-closed` welcome cycles via the existing `succeeded && postResetListener` gate.

Do NOT remove or reorder existing comment lines. The new comment line MUST be appended AFTER the `// Phase 10 D-17:` block and BEFORE `const countable = ...`.
  </action>
  <verify>
    <automated>grep -q "e.reason === 'pos-closed'" src/main/sessionReset.js &amp;&amp; grep -q "e.reason === 'sale-completed'" src/main/sessionReset.js &amp;&amp; grep -q "(e.reason === 'idle-expired' &amp;&amp; e.mode === 'welcome')" src/main/sessionReset.js &amp;&amp; node --test test/sessionReset.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "pos-closed" src/main/sessionReset.js` returns >= 1
    - `grep -c "sale-completed" src/main/sessionReset.js` returns >= 1 (Phase 10 exclusion preserved)
    - `grep -c "idle-expired" src/main/sessionReset.js` returns >= 1 (original Phase 06 D-06 exclusion preserved)
    - File contains the exact substring `e.reason === 'pos-closed'`
    - File contains the exact substring `e.reason === 'sale-completed'`
    - File contains the exact substring `(e.reason === 'idle-expired' && e.mode === 'welcome')`
    - File contains the exact substring `Phase 11 D-05` in a comment above the filter
    - `node --test test/sessionReset.test.js` exits 0 (all existing tests still pass — the new predicate is a strict superset of the Phase 10 one)
    - No changes to `onPostReset`, `succeeded`, `hardReset` signature, mutex logic, or D-15 step order
    - Line count delta: +4 to +5 (one comment line + one OR clause line + minimal whitespace)
    - Order of OR clauses inside the negation: idle-expired (with mode check) FIRST, sale-completed SECOND, pos-closed THIRD (matches phase chronology)
  </acceptance_criteria>
  <done>
    Countable filter excludes idle-expired+welcome AND sale-completed AND pos-closed reasons. All existing tests still pass. File delta is limited to the filter block (~5 added lines).
  </done>
</task>

<task type="auto">
  <name>Task 2: Append D-05 exclusion + D-06 onPostReset tests for pos-closed</name>
  <read_first>
    - test/sessionReset.test.js (CURRENT END OF FILE — verify the file currently ends with the Phase 10 D-18 test at lines 656-666 and a closing newline; the new pos-closed tests append AFTER)
    - test/sessionReset.test.js lines 632-666 (the Phase 10 sale-completed test block — byte-mirror template)
    - src/main/sessionReset.js lines 107-115 (verify the Phase 11 D-05 filter change landed; the new tests assume `pos-closed` is filter-excluded)
    - .planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md §Decisions D-07 (test placement and naming)
  </read_first>
  <files>test/sessionReset.test.js</files>
  <action>
Append a new test section at the END of `test/sessionReset.test.js`, AFTER the existing Phase 10 D-18 test (which currently ends near line 666 with `sessionReset.onPostReset(null);` followed by `});`). Do NOT modify any existing test.

**Exact text to append (preserve trailing newline at EOF):**

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

**Critical:**
- Use the existing `resetAll()` and `makeFakeMainWindow()` helpers — do NOT redefine.
- The `store: { get: () => true }` argument is required so the welcome-mode branch can broadcast `pos-state-changed` without crashing (same as the Phase 10 sale-completed tests).
- The trailing `sessionReset.onPostReset(null);` cleanup call in test 2 mirrors Phase 10 D-10-01-03 — prevents module-scoped listener contamination across tests (matching Phase 6 Test 10 convention at line 605, replicated by Phase 10 sale-completed test at line 665).
- Do NOT add sinon, fake timers, or external mocks. The project convention is `node:test` + `node:assert` + the existing hand-rolled fakes (`fakeSession`, `fakeLog`, virtual `idleTimer`).
- Do NOT add new `require(...)` statements at the top of the file.
- Test names MUST start with `D-05:` and `D-06:` exactly (these are the Phase 11 decision IDs being verified — different from Phase 10's `D-17:`/`D-18:` despite identical structure).
- Insertion point: AFTER the existing Phase 10 D-18 test's closing `});`. Confirm by reading the last ~30 lines of the file before inserting; the Phase 10 D-18 test should be the last test in the file pre-edit.
  </action>
  <verify>
    <automated>node --test test/sessionReset.test.js 2>&amp;1 | grep -E "D-05|D-06|pos-closed|# pass|# fail"</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/sessionReset.test.js` exits 0
    - File contains exact substring `D-05: 3x hardReset({reason:"pos-closed"})`
    - File contains exact substring `D-06: pos-closed reset still fires onPostReset`
    - File contains exact substring `Phase 11: pos-closed loop-counter exclusion (D-05)`
    - File contains exact substring `entry.fields.reason, 'pos-closed'`
    - File contains exact substring `postResetCount, 1`
    - File contains exact substring `st.loopActive, false`
    - File contains exact substring `sessionReset.onPostReset(null)` AFTER the new D-06 test (cleanup)
    - `grep -c "test('D-05:" test/sessionReset.test.js` returns 1 (exact, deterministic post-condition — verifies the new D-05 test landed exactly once, no baseline-delta dependency)
    - `grep -c "test('D-06:" test/sessionReset.test.js` returns 1 (exact, deterministic post-condition — verifies the new D-06 test landed exactly once, no baseline-delta dependency)
    - No sinon import, no `useFakeTimers`, no new top-of-file requires
    - The Phase 10 D-17 sale-completed test at line ~636 is UNCHANGED (still present, exact same text)
    - The Phase 10 D-18 sale-completed test at line ~656 is UNCHANGED (still present, exact same text)
  </acceptance_criteria>
  <done>
    Two new tests appended at end of file under a new "Phase 11" section banner. Both pass. All Phase 4/5/6/10 existing tests still pass. The pos-closed test block lives below the sale-completed block in source order.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none new) | Phase 11 introduces no new trust boundary. The `pos-closed` reason string is consumed only by `sessionReset.js` internal filter logic and audit metadata — no IPC, no renderer-facing surface, no external input. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-11-01-01 | T (Tampering) | sessionReset countable filter | accept | Filter is an internal main-process predicate, not exposed via IPC. The `reason` string flows from a privileged main-process call site (toggle-pos-open admin-menu handler, gated by Phase 5 admin PIN). No untrusted-input attack surface. |
| T-11-01-02 | I (Information disclosure) | audit log `idle.reset reason=pos-closed` | accept | Reason string is non-sensitive operational metadata. Matches Phase 6 D-06 + Phase 10 D-17 audit posture. No PII in payload. |

Severity: LOW. No threats above LOW. Mitigation strategy: rely on existing main-process boundary + admin PIN gate inherited from Phase 9.
</threat_model>

<verification>
- `node --test test/sessionReset.test.js` — all tests pass including the two new D-05/D-06 tests AND all existing Phase 4/5/6/10 tests
- `grep "pos-closed" src/main/sessionReset.js` — matches inside filter predicate + comment
- `grep "sale-completed" src/main/sessionReset.js` — Phase 10 exclusion preserved
- `grep "idle-expired" src/main/sessionReset.js` — Phase 6 D-06 original exclusion preserved
- No structural changes to `sessionReset.js` beyond the filter block (filter + comment delta only)
- No changes to any file other than `src/main/sessionReset.js` and `test/sessionReset.test.js`
- Filter exclusion order in source: idle-expired+welcome → sale-completed → pos-closed (chronological by phase)
</verification>

<success_criteria>
- `reason === 'pos-closed'` is excluded from the 3-in-60s loop counter
- `onPostReset` single-slot listener still fires for `pos-closed` welcome cycles (composes with updateGate exactly as sale-completed does)
- All existing tests still pass (Phase 4/5/6 D-15/D-17/D-18 + Phase 10 D-17/D-18)
- Test file grows by exactly 2 new `test(...)` blocks under a clearly-labeled `Phase 11` section banner
- File delta for `sessionReset.js` is limited to the countable filter block (4-5 added lines: 1 comment line + 1 OR clause line + minor whitespace)
- Phase 11 success criterion 3 ("excluded from 3-in-60s reset-loop counter, and onPostReset still fires") is satisfied by these tests
</success_criteria>

<output>
After completion, create `.planning/phases/11-pos-close-immediate-welcome-reset/11-01-SUMMARY.md` documenting:
- Exact before/after diff of the filter predicate
- Exact new test blocks added (verbatim)
- Confirmation that no Phase 4/5/6/10 test was modified
- `node --test test/sessionReset.test.js` pass count delta (should be +2)
- Confirmation Phase 10 sale-completed tests at lines ~636 and ~656 are byte-identical pre/post-edit
</output>
</content>
