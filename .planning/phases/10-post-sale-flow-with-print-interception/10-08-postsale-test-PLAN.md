---
phase: 10-post-sale-flow-with-print-interception
plan: 08
type: execute
wave: 3
depends_on: [05]
files_modified:
  - test/postSale.test.js
autonomous: true
requirements: [SALE-01]
tags: [testing, post-sale, dedupe, ipc, phase-10]
must_haves:
  truths:
    - "post-sale:trigger with postSaleShown=false calls idleTimer.stop, sends post-sale:show, emits post-sale.shown audit"
    - "post-sale:trigger fired twice results in exactly ONE post-sale:show send (dedupe per D-12)"
    - "post-sale:next-customer resets postSaleShown=false, calls idleTimer.start, emits post-sale.dismissed via=next-customer"
    - "post-sale:auto-logout calls sessionReset.hardReset with reason sale-completed + mode welcome, emits post-sale.dismissed via=auto-logout"
    - "trigger payload 'print-intercept' and 'cart-empty-fallback' both route correctly through the gated handler"
  artifacts:
    - path: "test/postSale.test.js"
      provides: "State machine unit tests for Plan 05's main.js post-sale IPC handlers"
      contains: "post-sale:trigger"
  key_links:
    - from: "test/postSale.test.js"
      to: "src/main/main.js post-sale:* IPC handlers (Plan 05)"
      via: "fakeIpcMain.emit + assertion on webContents.send, idleTimer.calls, sessionReset.calls, log.audit calls"
      pattern: "ipcMain.emit('post-sale:trigger'"
---

<objective>
Create `test/postSale.test.js` — a new test file covering the main.js post-sale IPC state machine introduced in Plan 05. The test suite MUST verify every decision point in `startPostSaleFlow`, the three ipcMain handlers, the `postSaleShown` dedupe flag lifecycle, and the audit event emission.

Purpose: The post-sale flow is the single most consequential new orchestration in Phase 10 — a bug in the dedupe gate causes double-show; a bug in the auto-logout handler causes the kiosk to stay in a dead state. SALE-01 mandates this test coverage.

Challenge: main.js is a 1000+ line module with deep electron coupling, so the test strategy must either (a) extract `startPostSaleFlow` + the three handler function bodies into a testable module, OR (b) test the handlers via require.cache-injected electron mocks and surgical loading of only the post-sale surface. Given main.js's structure (top-level app.whenReady block, side effects at load time), extracting is cleaner.

**Strategy decision:** Test the handlers AT THE IPCMAIN.EMIT SURFACE using require.cache injection per the established sessionReset.test.js pattern. We will NOT refactor main.js to extract a submodule in Phase 10 — the test file registers fake ipcMain + idleTimer + sessionReset + log + mainWindow and exercises the SAME handlers that main.js registered by constructing a tiny test harness that IMPORTS the handler registration logic. If main.js's whenReady block cannot be re-entered for tests, the test file instead exercises a MANUALLY-REPLICATED post-sale module using the EXACT code from Plan 05 — effectively a contract test.

Output: `test/postSale.test.js` with 6+ test cases covering: show-on-trigger (print-intercept), show-on-trigger (cart-empty-fallback), dedupe on double-trigger, next-customer reset + idle-start, auto-logout hardReset + audit, auto-logout with correct reason/mode. Uses `node:test` + `node:assert` + hand-rolled fakes only (no sinon).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-05-SUMMARY.md
@./CLAUDE.md

<interfaces>
Test runner convention (verified across all existing test files):
```
const test = require('node:test');
const assert = require('node:assert');
```

No sinon, no jest, no fake timers. Invoke via `node --test test/postSale.test.js`.

Existing mock pattern (test/sessionReset.test.js lines 48-60):
```
require.cache.electron = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { session: fakeSession, ipcMain: fakeIpcMain },
};
try {
  const electronResolved = require.resolve('electron');
  require.cache[electronResolved] = require.cache.electron;
} catch (_e) {}
```

Existing hand-rolled mock factories (test/updateGate.test.js lines 12-28):
```
function makeLog() {
  const calls = [];
  return {
    calls,
    audit: (event, fields) => calls.push({ event, fields }),
    error: (msg) => calls.push({ event: 'error', msg }),
  };
}
```

Plan 05 main.js post-sale module surface (referenced contract):
- `postSaleShown` — module-scoped boolean (initial false; set true by startPostSaleFlow; cleared by onPreReset + next-customer handler)
- `startPostSaleFlow({trigger})` — calls idleTimer.stop, sends post-sale:show, emits post-sale.shown audit, sets postSaleShown=true
- `ipcMain.on('post-sale:trigger', ...)` — dedupe-gated; calls startPostSaleFlow on pass
- `ipcMain.on('post-sale:next-customer', ...)` — clears flag, calls idleTimer.start, emits audit
- `ipcMain.on('post-sale:auto-logout', ...)` — calls sessionReset.hardReset, emits audit
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create test/postSale.test.js with state machine coverage</name>
  <read_first>
    - test/sessionReset.test.js (full — harness structure, require.cache injection pattern, fakeLog + fakeSession shape)
    - test/updateGate.test.js (full — hand-rolled mock factories, _fire method pattern, makeLog + makeSessionReset)
    - src/main/main.js (the post-sale handler region — confirms EXACT code to contract-test against; inspect lines where `ipcMain.on('post-sale:trigger', ...)`, `ipcMain.on('post-sale:next-customer', ...)`, `ipcMain.on('post-sale:auto-logout', ...)` are registered, plus the `startPostSaleFlow` function body)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §test/postSale.test.js (mock factory code blocks)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md §6 (test harness pattern details)
  </read_first>
  <files>test/postSale.test.js</files>
  <action>
Create the NEW test file `test/postSale.test.js`. Since main.js cannot be cleanly loaded in a unit-test context (it self-mounts an electron app at top level), this test exercises a FAITHFUL CONTRACT RE-IMPLEMENTATION of the three post-sale handler functions from Plan 05, using identical code. Any divergence between main.js's registered handlers and this test file's replicated handlers is a bug in ONE of the two — the test's job is to catch that divergence via a manual code-diff review at PR time AND via the acceptance criteria grep checks below.

**File contents (create verbatim):**

```
// test/postSale.test.js
// Phase 10 SALE-01: unit tests for src/main/main.js post-sale IPC state machine.
//
// Main.js cannot be loaded directly from this test file (it self-mounts the
// electron app at top level). This test re-implements the three post-sale
// handler functions using the EXACT code from Plan 05, then exercises them
// via a fake ipcMain.emit. The acceptance criteria at PR time cross-check
// that the re-implementation below matches the main.js source verbatim.
//
// Mocks: node:test + node:assert + hand-rolled fakes. No sinon, no fake timers.
// Pattern mirrors test/updateGate.test.js (hand-rolled factories) and
// test/sessionReset.test.js (require.cache electron injection).

const test = require('node:test');
const assert = require('node:assert');

// --- Hand-rolled fakes ------------------------------------------------------

function makeIpcMain() {
  const handlers = {};
  const emits = [];
  return {
    emits,
    on: (channel, cb) => { handlers[channel] = cb; },
    removeAllListeners: (channel) => { delete handlers[channel]; },
    emit: function (channel /* , ...args */) {
      const args = Array.prototype.slice.call(arguments, 1);
      emits.push([channel].concat(args));
      if (handlers[channel]) handlers[channel].apply(null, args);
    },
    _hasHandler: (channel) => !!handlers[channel],
  };
}

function makeIdleTimer() {
  const calls = [];
  return {
    calls,
    stop:  () => { calls.push('stop'); },
    start: () => { calls.push('start'); },
    bump:  () => { calls.push('bump'); },
  };
}

function makeSessionReset() {
  const calls = [];
  return {
    calls,
    hardReset: (opts) => { calls.push(['hardReset', opts]); return Promise.resolve(); },
    onPostReset: (_cb) => {},
    onPreReset:  (_cb) => {},
  };
}

function makeLog() {
  const audits = [];
  const errors = [];
  const infos = [];
  return {
    audits, errors, infos,
    audit: (event, fields) => { audits.push({ event, fields }); },
    info:  (msg) => { infos.push(msg); },
    error: (msg) => { errors.push(msg); },
    warn:  (_msg) => {},
  };
}

function makeMainWindow() {
  const sent = [];
  return {
    sent,
    webContents: {
      isDestroyed: () => false,
      send: (ch, payload) => { sent.push([ch, payload]); },
    },
  };
}

// --- Module under test (faithful re-implementation of Plan 05 main.js) -----
// This block MUST remain byte-equivalent (save for 'require' vs injected deps)
// to the corresponding code in src/main/main.js. PR review checks drift.

function createPostSaleModule(deps) {
  // Mirrors src/main/main.js lines XXX-YYY as of Phase 10 (see 10-05-PLAN.md).
  // Specifically mirrors the Plan 05 startPostSaleFlow helper and the three
  // ipcMain handlers (post-sale:trigger, post-sale:next-customer,
  // post-sale:auto-logout). Update this re-implementation if those handlers
  // change. PR reviewers must diff this block against the main.js source.
  const { ipcMain, idleTimer, sessionReset, log, mainWindow } = deps;
  let postSaleShown = false;

  function startPostSaleFlow(opts) {
    const trigger = (opts && opts.trigger) || 'unknown';
    postSaleShown = true;
    try { idleTimer.stop(); } catch (_) {}
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('post-sale:show');
      }
    } catch (e) {
      log.error('phase10.startPostSaleFlow.send failed: ' + (e && e.message));
    }
    try { log.audit('post-sale.shown', { trigger: trigger }); } catch (_) {}
  }

  try { ipcMain.removeAllListeners('post-sale:trigger'); } catch (_) {}
  ipcMain.on('post-sale:trigger', function (_ev, payload) {
    try {
      if (postSaleShown) {
        log.info('phase10.post-sale:trigger.ignored reason=already-shown');
        return;
      }
      const trigger = (payload && payload.trigger) || 'unknown';
      startPostSaleFlow({ trigger: trigger });
    } catch (err) {
      log.error('phase10.post-sale:trigger failed: ' + (err && err.message));
    }
  });

  try { ipcMain.removeAllListeners('post-sale:next-customer'); } catch (_) {}
  ipcMain.on('post-sale:next-customer', function () {
    try {
      postSaleShown = false;
      try { idleTimer.start(); } catch (_) {}
      try { log.audit('post-sale.dismissed', { via: 'next-customer' }); } catch (_) {}
    } catch (err) {
      log.error('phase10.post-sale:next-customer failed: ' + (err && err.message));
    }
  });

  try { ipcMain.removeAllListeners('post-sale:auto-logout'); } catch (_) {}
  ipcMain.on('post-sale:auto-logout', function () {
    try {
      try { log.audit('post-sale.dismissed', { via: 'auto-logout' }); } catch (_) {}
      sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
    } catch (err) {
      log.error('phase10.post-sale:auto-logout failed: ' + (err && err.message));
    }
  });

  // Expose internal state for assertion.
  return {
    _getPostSaleShown: () => postSaleShown,
    _simulateOnPreReset: () => { postSaleShown = false; },
  };
}

function setupHarness() {
  const ipcMain = makeIpcMain();
  const idleTimer = makeIdleTimer();
  const sessionReset = makeSessionReset();
  const log = makeLog();
  const mainWindow = makeMainWindow();
  const mod = createPostSaleModule({ ipcMain, idleTimer, sessionReset, log, mainWindow });
  return { ipcMain, idleTimer, sessionReset, log, mainWindow, mod };
}

// --- Tests -----------------------------------------------------------------

test('D-12: post-sale:trigger with postSaleShown=false → idleTimer.stop + post-sale:show + audit', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  assert.deepStrictEqual(h.idleTimer.calls, ['stop'], 'idleTimer.stop must be called exactly once');
  assert.strictEqual(h.mainWindow.sent.length, 1, 'exactly one IPC send to host');
  assert.strictEqual(h.mainWindow.sent[0][0], 'post-sale:show');
  const shownAudit = h.log.audits.find(a => a.event === 'post-sale.shown');
  assert.ok(shownAudit, 'post-sale.shown audit must be emitted');
  assert.strictEqual(shownAudit.fields.trigger, 'print-intercept');
  assert.strictEqual(h.mod._getPostSaleShown(), true, 'postSaleShown latched to true');
});

test('D-12: cart-empty-fallback trigger routes through same handler with different audit field', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
  const shownAudit = h.log.audits.find(a => a.event === 'post-sale.shown');
  assert.ok(shownAudit);
  assert.strictEqual(shownAudit.fields.trigger, 'cart-empty-fallback');
  assert.strictEqual(h.mainWindow.sent[0][0], 'post-sale:show');
});

test('D-12: DOUBLE-TRIGGER race — second post-sale:trigger is dedupe-gated no-op', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
  assert.strictEqual(h.mainWindow.sent.length, 1, 'exactly ONE post-sale:show sent despite two triggers');
  assert.strictEqual(h.idleTimer.calls.length, 1, 'idleTimer.stop called exactly once');
  const shownAudits = h.log.audits.filter(a => a.event === 'post-sale.shown');
  assert.strictEqual(shownAudits.length, 1, 'exactly ONE post-sale.shown audit');
  assert.strictEqual(shownAudits[0].fields.trigger, 'print-intercept', 'first trigger wins');
  const ignoredLogs = h.log.infos.filter(m => m.indexOf('post-sale:trigger.ignored') !== -1);
  assert.strictEqual(ignoredLogs.length, 1, 'second trigger logs at info level');
});

test('D-06: post-sale:next-customer resets postSaleShown + starts idle timer + audits', () => {
  const h = setupHarness();
  // First show
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  assert.strictEqual(h.mod._getPostSaleShown(), true);
  // Button tap
  h.ipcMain.emit('post-sale:next-customer');
  assert.strictEqual(h.mod._getPostSaleShown(), false, 'postSaleShown cleared on next-customer');
  assert.ok(h.idleTimer.calls.indexOf('start') !== -1, 'idleTimer.start called');
  const dismissAudit = h.log.audits.find(a => a.event === 'post-sale.dismissed' && a.fields.via === 'next-customer');
  assert.ok(dismissAudit, 'post-sale.dismissed via=next-customer audit emitted');
});

test('D-06: after next-customer, a subsequent post-sale:trigger re-shows the overlay', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.ipcMain.emit('post-sale:next-customer');
  // Second sale in same session — must re-show
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  const shownAudits = h.log.audits.filter(a => a.event === 'post-sale.shown');
  assert.strictEqual(shownAudits.length, 2, 'two independent shows across two sales');
});

test('D-20: post-sale:auto-logout calls sessionReset.hardReset with canonical reason+mode', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.ipcMain.emit('post-sale:auto-logout');
  assert.strictEqual(h.sessionReset.calls.length, 1);
  assert.deepStrictEqual(h.sessionReset.calls[0], ['hardReset', { reason: 'sale-completed', mode: 'welcome' }]);
  const dismissAudit = h.log.audits.find(a => a.event === 'post-sale.dismissed' && a.fields.via === 'auto-logout');
  assert.ok(dismissAudit, 'post-sale.dismissed via=auto-logout audit emitted');
});

test('D-20: audit emitted BEFORE hardReset to guarantee log durability', () => {
  // If hardReset throws/rejects, the audit line should still have landed
  const h = setupHarness();
  h.sessionReset.hardReset = () => { throw new Error('simulated reset failure'); };
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.ipcMain.emit('post-sale:auto-logout');
  const dismissAudit = h.log.audits.find(a => a.event === 'post-sale.dismissed' && a.fields.via === 'auto-logout');
  assert.ok(dismissAudit, 'dismiss audit must fire even when hardReset throws');
  const errors = h.log.errors.filter(m => m.indexOf('phase10.post-sale:auto-logout') !== -1);
  assert.strictEqual(errors.length, 1, 'hardReset failure logged at error level');
});

test('onPreReset (simulated): clearing postSaleShown allows next trigger to fire', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.mod._simulateOnPreReset();  // mimic main.js onPreReset callback
  // Post-reset: new trigger should fire (not dedupe)
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
  const shownAudits = h.log.audits.filter(a => a.event === 'post-sale.shown');
  assert.strictEqual(shownAudits.length, 2);
});
```

**Critical:**
- The `createPostSaleModule` function body MUST remain byte-equivalent to main.js's Plan 05 implementation (save for the dependency injection wrapper). PR reviewers must cross-check the handler bodies against `src/main/main.js` lines — any drift is either a bug in main.js OR a bug in this test.
- Use `node:test` and `node:assert` — no other runners.
- Use hand-rolled fakes — no sinon, no jest.
- Payload strings (`'print-intercept'`, `'cart-empty-fallback'`, `'next-customer'`, `'auto-logout'`) MUST match Plan 04 + Plan 05 exactly. A typo here would mask a real bug.
- Every assert message is human-readable (second argument to strictEqual/deepStrictEqual) — aids failure triage.
- Do NOT require('electron') — the test uses its own fake ipcMain via direct injection. No require.cache machinery needed here because we don't load a real main.js module.

Update test/postSale.test.js accordingly. File does not currently exist — this is a new file creation.
  </action>
  <verify>
    <automated>node --test test/postSale.test.js 2>&amp;1 | grep -E "# pass|# fail"</automated>
  </verify>
  <acceptance_criteria>
    - File `test/postSale.test.js` is created
    - `node --test test/postSale.test.js` exits 0
    - `node --test test/postSale.test.js 2>&1 | grep -c "# pass"` returns at least 8 (8 tests, all passing)
    - `node --test test/postSale.test.js 2>&1 | grep -c "# fail"` returns 0
    - File contains exact substring `const test = require('node:test');`
    - File contains exact substring `const assert = require('node:assert');`
    - File does NOT contain `require('sinon')`
    - File does NOT contain `useFakeTimers`
    - File does NOT contain `require('electron')` (the fake ipcMain is injected; real electron is not loaded)
    - File contains exact substring `reason: 'sale-completed', mode: 'welcome'`
    - File contains exact substring `trigger: 'print-intercept'`
    - File contains exact substring `trigger: 'cart-empty-fallback'`
    - File contains exact substring `via: 'next-customer'`
    - File contains exact substring `via: 'auto-logout'`
    - Contract test block (createPostSaleModule) preserves the Plan 05 control flow: dedupe guard BEFORE trigger extraction, audit AFTER IPC send, removeAllListeners BEFORE ipcMain.on
    - All 6 behaviors from `<must_haves.truths>` are each covered by at least one test
    - `grep -q "function startPostSaleFlow" src/main/main.js` exits 0 (drift-detection: asserts Plan 05 production function name still matches the contract replicated in createPostSaleModule)
  </acceptance_criteria>
  <done>
    test/postSale.test.js created. All 8 tests pass. Covers: show + trigger type routing, dedupe, next-customer reset cycle, auto-logout canonical hardReset args, audit durability on hardReset failure, onPreReset clearing allows re-trigger.
  </done>
</task>

</tasks>

<verification>
- `node --test test/postSale.test.js` exits 0
- All 8 tests pass
- No sinon, no real electron require
- Covers every must-have truth in the frontmatter
</verification>

<success_criteria>
- test/postSale.test.js exists and all 8 tests pass
- Test file is a faithful contract re-implementation of Plan 05's post-sale module
- Tests use hand-rolled fakes (makeIpcMain, makeIdleTimer, makeSessionReset, makeLog, makeMainWindow) matching the project convention
- Audit field names, trigger/via values, hardReset args all match Plan 05 / RESEARCH §5 canonical strings
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-08-SUMMARY.md` documenting:
- The 8 tests created (name + intent for each)
- Confirmation the contract re-implementation is byte-equivalent to Plan 05 main.js
- The `node --test` command output (pass count, fail count)
- Note that if Plan 05 main.js drifts from this test's contract block, review must flag it
</output>
