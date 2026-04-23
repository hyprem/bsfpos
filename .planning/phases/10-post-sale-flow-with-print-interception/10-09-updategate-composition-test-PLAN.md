---
phase: 10-post-sale-flow-with-print-interception
plan: 09
type: execute
wave: 3
depends_on: [05]
files_modified:
  - test/updateGate.test.js
autonomous: true
requirements: [SALE-01]
tags: [testing, update-gate, composition, phase-10]
must_haves:
  truths:
    - "After post-reset trigger fires (simulating sale-completed hardReset completion), updateGate installs exactly once"
    - "First-trigger-wins: second post-reset fire is no-op (existing Phase 05 D-15/D-16 semantics preserved for sale-completed)"
    - "Audit log shows update.install with trigger=post-reset (not a new 'sale-completed' trigger value)"
  artifacts:
    - path: "test/updateGate.test.js"
      provides: "D-18 end-to-end coverage — sale-completed onPostReset → updateGate install composes correctly"
      contains: "sale-completed"
  key_links:
    - from: "test/updateGate.test.js new test"
      to: "sr._fire() simulating onPostReset after sale-completed hardReset"
      via: "gate.onUpdateDownloaded + sr._fire()"
      pattern: "sale-completed"
---

<objective>
Extend `test/updateGate.test.js` with a D-18 end-to-end coverage test proving that a `sale-completed` hardReset → onPostReset → updateGate install path composes correctly. No changes to `updateGate.js` — the existing onPostReset single-slot listener already handles this (Plan 01 does NOT require updateGate code changes).

Purpose: SALE-01 success criterion 4 requires the `onPostReset` hook to fire for sale-completed cycles so pending updates can install. This test is the contract that guards against a future regression where someone accidentally decouples sale-completed from the post-reset path.

Output: ONE new test appended to `test/updateGate.test.js` using the existing `makeLog` + `makeSessionReset` factories + `gate.onUpdateDownloaded` pattern. No new mock factories needed.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-05-SUMMARY.md
@./CLAUDE.md

<interfaces>
Existing test in test/updateGate.test.js lines 56-76 (direct structural template):
```
test('onUpdateDownloaded: post-reset trigger fires installFn exactly once', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  let installed = 0;
  gate.onUpdateDownloaded({
    installFn: () => installed++,
    log,
    sessionResetModule: sr,
    getHour: () => 12, // not maintenance window
  });
  sr._fire();  // post-reset fires
  assert.strictEqual(installed, 1);
  const installAudit = log.calls.find(c => c.event === 'update.install');
  assert.ok(installAudit);
  assert.strictEqual(installAudit.fields.trigger, 'post-reset');
  sr._fire();
  assert.strictEqual(installed, 1, 'second fire must be no-op');
  gate._resetForTests();
});
```

The sale-completed integration test is semantically IDENTICAL — updateGate doesn't care what caused onPostReset to fire; it only sees the listener invocation. The new test's value is DOCUMENTATION: it proves that when someone reads the test suite, they see sale-completed explicitly covered, not just idle-expired.

makeLog + makeSessionReset factories are defined at the top of the file (lines 12-28); no need to redefine.

Phase 05 D-15/D-16 first-trigger-wins semantics (the "second fire must be no-op" assertion) must be preserved for sale-completed paths per CONTEXT.md D-18.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Append D-18 sale-completed composition test to test/updateGate.test.js</name>
  <read_first>
    - test/updateGate.test.js (full — verify test file currently ends with a closing newline; NOT in the middle of a test)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §test/updateGate.test.js (exact new test block)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-18 (no updateGate.js changes; end-to-end coverage test only)
    - src/main/updateGate.js (verify that `trigger:'post-reset'` is the audit field value — do NOT introduce a new `'sale-completed'` trigger value in updateGate)
  </read_first>
  <files>test/updateGate.test.js</files>
  <action>
Append ONE new test block at the END of `test/updateGate.test.js` (after the last existing `test(...)` closing parenthesis + semicolon + blank line). Do NOT modify any existing test.

**Exact test to append:**

```
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

**Critical:**
- Use the existing `makeLog` + `makeSessionReset` factories defined at the top of the file — do NOT redefine them.
- The `gate._resetForTests()` call at both start and end of the test matches the existing pattern — ensures no module-scoped state leaks between tests.
- The audit trigger field value is `'post-reset'` (NOT `'sale-completed'`). updateGate.js has NO awareness of the reason string; it just reacts to the onPostReset hook firing. This is the whole point of D-18: composition without updateGate changes.
- The "second fire must be no-op" assertion captures the Phase 05 D-15/D-16 first-trigger-wins semantics. If someone later breaks that (e.g. unlatches the first-install-wins flag), this test catches it.
- Do NOT add a new test for `reason: 'sale-completed'` inside updateGate internals — updateGate does not see the reason, and adding such a test would require changing updateGate.js (out of scope per D-18).
- Do NOT modify any existing test's gate._resetForTests() calls, setInterval mocking, or getHour values.
  </action>
  <verify>
    <automated>node --test test/updateGate.test.js 2>&amp;1 | grep -E "D-18|# pass|# fail"</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `D-18: sale-completed hardReset`
    - File contains exact substring `sessionResetModule: sr`
    - File contains exact substring `trigger, 'post-reset'` (confirms the NEW test asserts trigger is post-reset, NOT a new sale-completed value)
    - File does NOT contain `trigger.*sale-completed` inside any updateGate test (updateGate doesn't see reason strings)
    - `node --test test/updateGate.test.js` exits 0
    - `node --test test/updateGate.test.js 2>&1 | grep -c "# pass"` returns 1 MORE than before this task (delta test) — or in absolute terms: at least as many passes as existed before + 1
    - `node --test test/updateGate.test.js 2>&1 | grep -c "# fail"` returns 0
    - Existing tests in the file are unchanged (verify: file's SHA of the region before the last closing `)` of the existing last test matches the pre-edit state — if hashing is not feasible, verify by grep-counting that existing test names like "post-reset trigger fires installFn exactly once" still appear exactly once)
    - No new `require(...)` at top of file
    - No modification to makeLog / makeSessionReset factories
  </acceptance_criteria>
  <done>
    Single new test appended. All tests (existing + new) pass. No existing test modified. updateGate.js not touched.
  </done>
</task>

</tasks>

<verification>
- `node --test test/updateGate.test.js` exits 0
- The new D-18 test passes
- Existing tests all still pass
- `grep "sale-completed" test/updateGate.test.js` matches only inside the new test's comment block
- `grep "trigger, 'post-reset'" test/updateGate.test.js` matches at least twice (existing test + new test)
- `src/main/updateGate.js` unchanged
</verification>

<success_criteria>
- D-18 coverage test appended
- updateGate.js unchanged (D-18 is test-only)
- Existing tests preserved
- Composition path (sale-completed → onPostReset → install) documented by test
- First-trigger-wins semantics preserved for sale-completed (second fire no-op)
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-09-SUMMARY.md` documenting:
- The exact new test block appended
- Confirmation updateGate.js is unchanged
- Pass count delta for `node --test test/updateGate.test.js`
- Observation that the new test is documentation-value (semantically identical to existing post-reset test) — its presence in the suite prevents future regressions that might accidentally decouple sale-completed from onPostReset
</output>
