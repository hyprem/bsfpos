---
phase: 10-post-sale-flow-with-print-interception
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/sessionReset.js
  - test/sessionReset.test.js
autonomous: true
requirements: [SALE-01]
tags: [session-reset, loop-counter, filter, phase-10]
must_haves:
  truths:
    - "hardReset({reason:'sale-completed', mode:'welcome'}) called 3x in <60s does NOT latch loopActive"
    - "hardReset({reason:'sale-completed'}) still fires onPostReset for updateGate integration"
    - "Existing idle-expired+welcome exclusion is preserved byte-for-byte"
  artifacts:
    - path: "src/main/sessionReset.js"
      provides: "Extended countable filter excluding reason==='sale-completed'"
      contains: "reason === 'sale-completed'"
    - path: "test/sessionReset.test.js"
      provides: "D-17 exclusion test + D-18 onPostReset test for sale-completed"
      contains: "sale-completed"
  key_links:
    - from: "src/main/sessionReset.js"
      to: "countable filter predicate (lines 104-106)"
      via: "||-separated OR inside existing negation"
      pattern: "reason === 'sale-completed'"
    - from: "test/sessionReset.test.js"
      to: "sessionReset._getStateForTests().loopActive"
      via: "3× hardReset + assert loopActive === false"
      pattern: "loopActive, false"
---

<objective>
Extend `sessionReset.js` countable-filter predicate to exclude `reason === 'sale-completed'` from the 3-in-60s reset-loop counter (D-17), and add tests proving the exclusion + onPostReset still fires (D-18). This is the foundation plan — no other plan can safely invoke `hardReset({reason:'sale-completed'})` until this filter lands.

Purpose: Per SALE-01, a member doing 4 quick sales in a minute must not trip the reset-loop guard. The existing predicate excludes `idle-expired+welcome`; we extend it to also exclude `sale-completed` regardless of mode.

RESEARCH OVERRIDE: This plan does NOT depend on the D-10 print trigger path change. The filter extension is a one-line predicate change (PATTERNS §sessionReset.js) and is independently verifiable.

Output: Single-line predicate change in `sessionReset.js` + two new test cases appended to `sessionReset.test.js`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md
@./CLAUDE.md

<interfaces>
<!-- Key contracts: the existing sessionReset.hardReset() signature and
     the existing loop-counter filter. The predicate extension preserves
     the negation shape `!(condition)` and uses `||` to OR in the new
     exclusion. -->

From src/main/sessionReset.js (current, lines 104-106):
```javascript
const countable = resetTimestamps.filter(
  (e) => !(e.reason === 'idle-expired' && e.mode === 'welcome')
);
```

From src/main/sessionReset.js (hardReset signature):
```javascript
async function hardReset({ reason, mode } = {}) { ... }
// mode normalized at entry: (mode === 'welcome') ? 'welcome' : 'reset'
```

From src/main/sessionReset.js (onPostReset single-slot, lines 249-256):
```javascript
// Fires ONLY on succeeded===true. sale-completed welcome cycles set
// succeeded=true at line 187 (welcome-mode branch), so onPostReset
// fires for sale-completed automatically — no code change needed.
if (succeeded && postResetListener) { postResetListener(); }
```

From test/sessionReset.test.js harness (lines 26-80):
- fakeSession, fakeLog with _lines.audit[], callLog[]
- require.cache.electron injection pattern
- `_resetForTests()` wipes module-scoped state
- `_getStateForTests()` exposes `loopActive`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend countable-filter predicate to exclude sale-completed</name>
  <read_first>
    - src/main/sessionReset.js (current state — single source of truth for the predicate)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §Decisions D-17 (canonical filter shape)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §sessionReset.js (exact before/after code blocks)
  </read_first>
  <files>src/main/sessionReset.js</files>
  <action>
Modify the countable filter at lines 104-106 of `src/main/sessionReset.js`. Replace the existing single-condition negation with a two-condition OR inside the same negation, per D-17.

**Exact current code (lines 104-106):**
```javascript
const countable = resetTimestamps.filter(
  (e) => !(e.reason === 'idle-expired' && e.mode === 'welcome')
);
```

**Exact target code (replace the 3 lines above with):**
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

Do NOT modify any other line in the file. Do NOT touch `onPostReset`, `succeeded` flag, audit call, or any other logic — per D-18, `onPostReset` fires automatically for `sale-completed` welcome cycles via the existing `succeeded && postResetListener` gate at lines 249-256.

Do NOT remove the existing `// D-06:` comment line; keep it as the lead comment and append the `// Phase 10 D-17:` continuation comment above the `const countable = ...` expression.
  </action>
  <verify>
    <automated>grep -q "e.reason === 'sale-completed'" src/main/sessionReset.js &amp;&amp; grep -q "(e.reason === 'idle-expired' &amp;&amp; e.mode === 'welcome')" src/main/sessionReset.js &amp;&amp; node --test test/sessionReset.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "sale-completed" src/main/sessionReset.js` returns >= 1
    - `grep -c "idle-expired" src/main/sessionReset.js` returns >= 1 (original exclusion preserved)
    - File contains the exact substring `e.reason === 'sale-completed'`
    - File contains the exact substring `(e.reason === 'idle-expired' && e.mode === 'welcome')`
    - File contains the exact substring `Phase 10 D-17` in a comment above the filter
    - `node --test test/sessionReset.test.js` exits 0 (all existing tests still pass — the new predicate is a superset of the old one)
    - No changes to `onPostReset`, `succeeded`, `hardReset` signature, or step 1-11 order
    - Line count delta: +3 to +6 (comment + extra predicate lines only)
  </acceptance_criteria>
  <done>
    Countable filter excludes BOTH `idle-expired+welcome` AND `sale-completed` reasons. All existing tests pass. File delta is limited to the filter block.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add D-17 + D-18 tests to sessionReset.test.js</name>
  <read_first>
    - test/sessionReset.test.js (current — harness structure, makeFakeMainWindow, resetAll, fakeLog._lines.audit)
    - src/main/sessionReset.js (to confirm the filter change landed and what _getStateForTests returns)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §test/sessionReset.test.js (exact new test blocks to append)
  </read_first>
  <files>test/sessionReset.test.js</files>
  <action>
Append two new test blocks at the END of `test/sessionReset.test.js` (after the last existing `test(...)` and before any trailing comment / EOF). Do NOT modify existing tests.

**Test 1 — D-17 exclusion:**
```javascript
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
  // All 3 must have emitted audit events (not suppressed)
  const auditLines = fakeLog._lines.audit.filter(e => e.event === 'idle.reset');
  assert.strictEqual(auditLines.length, 3, 'all 3 resets must emit idle.reset audit');
  // Assert the reason field is tagged correctly
  for (const entry of auditLines) {
    assert.strictEqual(entry.fields.reason, 'sale-completed');
    assert.strictEqual(entry.fields.mode, 'welcome');
  }
});
```

**Test 2 — D-18 onPostReset still fires for sale-completed:**
```javascript
test('D-18: sale-completed reset still fires onPostReset (updateGate composition)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  let postResetCount = 0;
  sessionReset.onPostReset(() => { postResetCount++; });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  assert.strictEqual(postResetCount, 1, 'onPostReset must fire for sale-completed welcome cycle');
});
```

**Critical:**
- Both tests MUST use `resetAll()` (the existing helper) to wipe state between tests. Inspect the file to confirm the helper name if it differs — match whatever the file uses.
- Use `makeFakeMainWindow` as used in existing tests. If the existing helper differs, match the exact harness style already present in this file — do not import new helpers.
- `store.get: () => true` is required so the welcome-mode branch can broadcast `pos-state-changed` without crashing (see sessionReset.js line 180).
- Do NOT add sinon, fake timers, or external mocks — the project convention (verified in 10-RESEARCH.md §6) is `node:test` + `node:assert` + hand-rolled fakes only.

Note: If `resetAll` is not the existing helper name (some harnesses use `resetCallLog` + a separate `_resetForTests()` call), inspect lines 1-120 of the test file first and match its exact idiom. The two critical requirements are: (a) module state reset between tests, (b) using existing fakeLog / fakeSession / makeFakeMainWindow factories.
  </action>
  <verify>
    <automated>node --test test/sessionReset.test.js 2>&amp;1 | grep -E "D-17|D-18|ok|not ok"</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/sessionReset.test.js` exits 0
    - Test file contains exact substring `D-17: 3x hardReset`
    - Test file contains exact substring `D-18: sale-completed reset still fires onPostReset`
    - Test file contains exact substring `postResetCount, 1`
    - Test file contains exact substring `st.loopActive, false`
    - Test file contains exact substring `fakeLog._lines.audit.filter`
    - `node --test test/sessionReset.test.js 2>&1 | grep -c "# pass"` returns at least 2 MORE than before this task (delta check: count existing passes first, then count after)
    - No sinon import, no `require('sinon')`, no `useFakeTimers`
  </acceptance_criteria>
  <done>
    Two new tests added at end of file. Both pass. Existing tests still pass. Tests use the existing harness style (hand-rolled fakes, resetAll helper, fakeLog._lines.audit).
  </done>
</task>

</tasks>

<verification>
- `node --test test/sessionReset.test.js` — all tests pass including the two new D-17/D-18 tests
- `grep "sale-completed" src/main/sessionReset.js` — matches in filter predicate
- `grep "idle-expired" src/main/sessionReset.js` — original exclusion preserved
- No structural changes to `sessionReset.js` beyond the 3-6 line predicate block
- No changes to any other file
</verification>

<success_criteria>
- `reason === 'sale-completed'` is excluded from the 3-in-60s loop counter
- `onPostReset` single-slot listener still fires for `sale-completed` welcome cycles
- All existing tests still pass
- Test file grows by exactly 2 new `test(...)` blocks
- File delta for `sessionReset.js` is limited to the countable filter block (3-6 added lines)
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-01-SUMMARY.md` documenting:
- Exact before/after diff of the filter predicate
- Exact new tests added
- Confirmation that no other file was touched
- Confirmation `node --test test/sessionReset.test.js` passes
</output>
