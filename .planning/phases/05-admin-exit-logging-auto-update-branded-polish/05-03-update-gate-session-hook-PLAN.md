---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/sessionReset.js
  - src/main/updateGate.js
  - test/updateGate.test.js
  - test/sessionReset.postReset.test.js
autonomous: true
requirements: [ADMIN-07]
tags: [auto-update, safe-window, session-reset, event-hook]
must_haves:
  truths:
    - "sessionReset.js exposes onPostReset(cb) that registers a single listener called AFTER step 11 (mutex release) completes successfully"
    - "onPostReset listener fires exactly once per successful hardReset (not on suppressed or loop-active calls)"
    - "onPostReset listener does NOT fire when hardReset short-circuits due to in-flight or loop-active state"
    - "updateGate.js exposes onUpdateDownloaded(installFn, log, sessionResetModule) that arms both a maintenance-window setInterval AND a one-shot post-reset listener"
    - "installFn is called on the FIRST of: (a) post-reset event fires, or (b) current time enters 03:00–05:00 window"
    - "After installFn is called, both timers are cleared (no double-install)"
    - "isMaintenanceWindow() returns true iff new Date().getHours() ∈ [3,4] (i.e. 03:00–04:59)"
    - "Phase 4 sessionReset test suite (100-cycle harness + integration tests) still passes unchanged"
  artifacts:
    - path: "src/main/sessionReset.js"
      provides: "onPostReset(cb) registration + post-reset fire hook inside hardReset"
      contains: "onPostReset"
    - path: "src/main/updateGate.js"
      provides: "Safe-window gating for electron-updater install"
      exports: ["onUpdateDownloaded", "isMaintenanceWindow", "_resetForTests"]
    - path: "test/updateGate.test.js"
      provides: "Unit tests for gate arm/fire/clear logic with fake clock + fake emitter"
    - path: "test/sessionReset.postReset.test.js"
      provides: "Unit tests: onPostReset fires after success, does NOT fire on suppressed/loop-active"
  key_links:
    - from: "src/main/updateGate.js"
      to: "src/main/sessionReset.js"
      via: "sessionResetModule.onPostReset(cb) registration"
      pattern: "onPostReset"
    - from: "src/main/sessionReset.js"
      to: "onPostReset callback"
      via: "fire inside hardReset finally block"
      pattern: "postResetListener"
---

<objective>
Add a minimal `onPostReset(cb)` callback-registration hook to `src/main/sessionReset.js` per CONTEXT.md D-15/D-16 (small, non-breaking addition to Phase 4), then build `src/main/updateGate.js` — a pure module that consumes `post-reset` events AND a clock-based maintenance window check (03:00–05:00) to decide when `electron-updater`'s `quitAndInstall()` is safe to call.

Purpose: Close ADMIN-07 (update install gated behind safe window, never mid-transaction). Unblock Plan 04 which wires this gate to the real `NsisUpdater`.

Output: extended sessionReset.js (one new function + one call site inside `hardReset`), new updateGate.js module, and two unit-test files. Phase 4's existing 100-cycle harness MUST continue passing.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md
@src/main/sessionReset.js
</context>

<interfaces>
Current `sessionReset.js` exports (Phase 4 — MUST stay backwards-compatible):
```javascript
exports.init = function(opts)                     // { mainWindow, store }
exports.hardReset = async function({reason})      // D-15 11-step flow
exports._resetForTests = function()               // clears resetting/loopActive/resetTimestamps/mainWindow/store
exports._getStateForTests = function()            // introspection for tests
exports._RESET_WINDOW_MS = 60_000
exports._RESET_LOOP_THRESHOLD = 3
```

New additions for Phase 5:
```javascript
exports.onPostReset = function(cb: () => void): void
// Registers a SINGLE listener. Subsequent calls REPLACE the previous listener
// (updateGate.js is the only consumer; multi-listener complexity is unneeded).
// The listener fires inside hardReset() after the mutex is released, ONLY on
// successful completion (not on the in-flight / loop-active short-circuit).
```

Wiring inside `hardReset`:
```javascript
// End of hardReset, AFTER the try/finally block:
// Fire post-reset listener on successful completion only.
// MUST NOT fire inside the guard short-circuit (resetting || loopActive return).
// MUST NOT fire on the loop-detected return.
```

The current `hardReset()` flow per Phase 4:
- Line 66-73: in-flight / loop-active guard → early return (NO fire)
- Line 80-95: loop detection → send 'show-magicline-error' and return (NO fire)
- Line 103-144: try/finally block running steps 4-11
- Line 141-144: finally { resetting = false }

Phase 5 adds: after the try/finally exits WITHOUT having returned early, invoke the `postResetListener` if one is set. The fire must happen AFTER `resetting = false` so consumers see a clean state.

updateGate.js contract:
```javascript
// src/main/updateGate.js
exports.isMaintenanceWindow = function(): boolean
// true iff local hour is 3 or 4 (03:00–04:59 per D-15)

exports.onUpdateDownloaded = function(opts)
// opts: {
//   installFn: () => void,      // wraps updater.quitAndInstall
//   log: logger,                 // for log.audit calls
//   sessionResetModule: object,  // module with onPostReset(cb)
//   clock?: () => number,        // optional, defaults to Date.now for tests
//   getHour?: () => number,      // optional, defaults to new Date().getHours() for tests
// }
// Arms two listeners; whichever fires first calls installFn() and clears the other.
// Emits log.audit('update.downloaded', {gateState:'waiting'}) on arm
// and log.audit('update.install', {trigger:'post-reset'|'maintenance-window'}) on fire.

exports._resetForTests = function(): void
```
</interfaces>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| electron-updater (network) → updateGate | `update-downloaded` event delivers remote-origin update metadata |
| updateGate → sessionReset callback | Shared main-process module boundary, no cross-process trust |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-13 | I (Info disclosure) / S | Update installed mid-transaction corrupts member state | mitigate | Gate only allows install after post-reset (Phase 4 "clean slate" moment) OR 03:00–05:00 (no members). Unit test asserts installFn NEVER called without one of those triggers |
| T-05-14 | D (DoS) | Double-install if both triggers fire | mitigate | First trigger clears both armed listeners. Unit test asserts installFn called exactly once even if post-reset fires during maintenance window |
| T-05-15 | T (Tampering) | Attacker sets clock to 03:00 to force install mid-day | accept | Standard-user Windows account has no clock-set permission (Phase 1 OS hardening). Documented accept |
| T-05-16 | R (Repudiation) | No audit trail for gate fire decisions | mitigate | log.audit('update.install', {trigger:...}) on every fire, log.audit('update.downloaded',...) on arm |
| T-05-17 | E (Elevation) | hardReset short-circuit fires post-reset listener → bogus "clean slate" signal | mitigate | Fire is OUTSIDE both guard and loop-detected returns; only fires after successful try/finally unwind. Unit test asserts suppressed calls do NOT fire listener |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add onPostReset hook to sessionReset.js</name>
  <read_first>
    - src/main/sessionReset.js (ENTIRE file — understand the 11-step D-15 flow and the guard returns at lines 66 and 80-95)
    - .planning/phases/04-nfc-input-idle-session-lifecycle/04-CONTEXT.md (Phase 4 contract — do not break)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md §D-15 §D-16
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md §Open Question 2
  </read_first>
  <behavior>
    - `sessionReset.onPostReset(cb)` stores `cb` in a module-scoped `postResetListener` variable (replaces prior)
    - `onPostReset(null)` clears the listener
    - After `hardReset` completes the try/finally successfully, the listener is invoked (inside a try/catch — listener errors do not propagate)
    - Guard-path return (line 66-73): listener NOT fired
    - Loop-detected return (line 80-95): listener NOT fired
    - `_resetForTests()` additionally clears `postResetListener`
  </behavior>
  <action>
    Edit `src/main/sessionReset.js` with minimal surgical changes:

    1. Add after line 49 (`const resetTimestamps = [];`):
    ```javascript
    let postResetListener = null; // Phase 5 D-15/D-16: single listener for updateGate
    ```

    2. Add a new exported function BEFORE the `module.exports` block (between `_getStateForTests` and `module.exports`):
    ```javascript
    /**
     * Phase 5 D-15/D-16: register a single post-reset callback.
     * Fires ONLY after a hardReset() completes successfully (not on in-flight
     * or loop-detected short-circuits). Consumed by updateGate.js to gate
     * electron-updater quitAndInstall.
     *
     * @param {(() => void)|null} cb - listener, or null to clear
     */
    function onPostReset(cb) {
      postResetListener = (typeof cb === 'function') ? cb : null;
    }
    ```

    3. Inside `hardReset`, AFTER the `try { ... } finally { resetting = false; }` block (immediately after line 144 `}` closing `finally`), add:
    ```javascript

      // Phase 5 D-15/D-16: fire post-reset listener for updateGate safe-window.
      // MUST be outside the try/finally so failed resets don't emit a "clean slate"
      // signal. Wrapped in try/catch so a listener bug cannot break sessionReset.
      if (postResetListener) {
        try {
          postResetListener();
        } catch (e) {
          log.error('sessionReset.postReset-listener-threw: ' + (e && e.message));
        }
      }
    ```
    Note: This placement means if the `try` block throws (step 4-10 fails), the `finally` clears `resetting` but the listener does NOT fire because the exception propagates through this new block. That is the correct behavior — a failed reset is not a "clean slate".

    Actually, the current `try/finally` has no `catch`, so exceptions propagate. Wrap the listener fire in a check that only runs on success: the simplest way is to set a local `let succeeded = false;` before the try, `succeeded = true;` as the last line INSIDE the try (after step 10 `createMagiclineView`), then `if (succeeded && postResetListener) { ... }` after the finally. Rewrite step 3 accordingly:

    **Revised step 3 — correct placement:**

    - Inside `hardReset`, add `let succeeded = false;` immediately BEFORE `resetting = true;` (line 103).
    - Inside the `try` block, after the `createMagiclineView(mainWindow, store);` call (the last step 10 line), add `succeeded = true;` as the next line.
    - After the `try/finally` block closes (after line 144 `}`), add:
    ```javascript

      // Phase 5 D-15/D-16: post-reset listener fires ONLY on successful completion
      if (succeeded && postResetListener) {
        try {
          postResetListener();
        } catch (e) {
          log.error('sessionReset.postReset-listener-threw: ' + (e && e.message));
        }
      }
    ```

    4. Update `_resetForTests` to also clear the listener:
    ```javascript
    function _resetForTests() {
      resetting = false;
      loopActive = false;
      resetTimestamps.length = 0;
      mainWindow = null;
      store      = null;
      postResetListener = null;  // Phase 5
    }
    ```

    5. Update `module.exports` to include `onPostReset`:
    ```javascript
    module.exports = {
      init: init,
      hardReset: hardReset,
      onPostReset: onPostReset,   // Phase 5 D-15/D-16
      _resetForTests: _resetForTests,
      _getStateForTests: _getStateForTests,
      _RESET_WINDOW_MS: RESET_WINDOW_MS,
      _RESET_LOOP_THRESHOLD: RESET_LOOP_THRESHOLD,
    };
    ```

    Do NOT touch any other line in sessionReset.js. Do NOT rename any existing symbol. Do NOT reorder the 11-step D-15 flow.
  </action>
  <verify>
    <automated>node --check src/main/sessionReset.js && node -e "const s=require('./src/main/sessionReset');if(typeof s.onPostReset!=='function')process.exit(1);if(typeof s.hardReset!=='function')process.exit(2);if(typeof s.init!=='function')process.exit(3);console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - `node --check src/main/sessionReset.js` exits 0
    - `grep -n "onPostReset" src/main/sessionReset.js` matches at least 3 times (function def, export, inside hardReset conditional)
    - `grep -n "postResetListener" src/main/sessionReset.js` matches at least 4 times (declare, assign, clear, fire)
    - `grep -n "let succeeded = false" src/main/sessionReset.js` matches once
    - `grep -n "succeeded = true" src/main/sessionReset.js` matches once
    - `grep -nE "sessionReset\.postReset-listener-threw" src/main/sessionReset.js` matches once
    - `git diff --stat src/main/sessionReset.js` shows <= 25 lines added, 1 line changed (module.exports)
    - All 11 D-15 step comments still present: `grep -cE "D-15 step" src/main/sessionReset.js` ≥ 7
  </acceptance_criteria>
  <done>sessionReset.js has onPostReset hook that fires only on successful hardReset; Phase 4 behavior otherwise unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create updateGate.js with post-reset + maintenance-window gating</name>
  <read_first>
    - src/main/sessionReset.js (post Task 1 — confirm onPostReset export)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md §Pattern 2 §Gotcha (update-available fires before download complete)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md §D-15 §D-16 §D-17
  </read_first>
  <behavior>
    - `isMaintenanceWindow(getHour?)` returns `true` when hour ∈ {3, 4}
    - `onUpdateDownloaded({installFn, log, sessionResetModule, clock?, getHour?})`:
      1. Calls `log.audit('update.downloaded', {gateState:'waiting'})`
      2. Arms a `setInterval(60_000)` checking `isMaintenanceWindow()`; on match, clears both listeners, log.audit('update.install',{trigger:'maintenance-window'}), calls installFn()
      3. Calls `sessionResetModule.onPostReset(onPostResetFired)` where the callback clears both listeners, log.audit('update.install',{trigger:'post-reset'}), calls installFn()
      4. Both paths are one-shot; second trigger after first fires MUST be no-op
    - `_resetForTests()` clears all internal state (interval refs, fire flag)
    - If called twice without reset (double `onUpdateDownloaded`), the second call CLEARS the previous gate first (edge case: user-triggered admin menu "check for updates" after a prior download)
  </behavior>
  <action>
    Create `src/main/updateGate.js`:

    ```javascript
    // src/main/updateGate.js
    // Phase 5 ADMIN-07 / CONTEXT.md D-15, D-16, D-17
    //
    // Safe-window gate for electron-updater quitAndInstall. Consumes:
    //   (a) Phase 4 sessionReset post-reset event — Phase 5's "clean slate" signal
    //   (b) Clock-based 03:00–05:00 maintenance window
    // Whichever fires first after update-downloaded wins; the other is cleared.
    //
    // NO direct electron import. installFn is dependency-injected so this module
    // is pure-testable with fake clock/fake emitter.

    const MAINTENANCE_POLL_MS = 60_000; // check the clock once per minute
    const MAINTENANCE_HOUR_START = 3;   // 03:00 inclusive
    const MAINTENANCE_HOUR_END   = 5;   // 05:00 exclusive → hours 3, 4

    // --- Module-scoped gate state ----------------------------------------------
    let maintenanceTimer = null;
    let postResetArmed  = false;
    let fired           = false;

    function isMaintenanceWindow(getHour) {
      const h = (typeof getHour === 'function') ? getHour() : new Date().getHours();
      return h >= MAINTENANCE_HOUR_START && h < MAINTENANCE_HOUR_END;
    }

    function clearGate() {
      if (maintenanceTimer) {
        clearInterval(maintenanceTimer);
        maintenanceTimer = null;
      }
      postResetArmed = false;
    }

    /**
     * Arm the gate after electron-updater's update-downloaded event.
     *
     * @param {object} opts
     * @param {() => void} opts.installFn
     * @param {{audit: Function, error?: Function}} opts.log
     * @param {{onPostReset: Function}} opts.sessionResetModule
     * @param {(() => number)=} opts.getHour - test hook
     */
    function onUpdateDownloaded(opts) {
      if (!opts || typeof opts.installFn !== 'function') {
        throw new Error('updateGate.onUpdateDownloaded: installFn is required');
      }
      if (!opts.log || typeof opts.log.audit !== 'function') {
        throw new Error('updateGate.onUpdateDownloaded: log.audit is required');
      }
      if (!opts.sessionResetModule || typeof opts.sessionResetModule.onPostReset !== 'function') {
        throw new Error('updateGate.onUpdateDownloaded: sessionResetModule.onPostReset is required');
      }

      // If a prior gate was armed and never fired, clear it first (D-17: admin
      // menu re-check during a waiting gate should not leak timers).
      clearGate();
      fired = false;

      const { installFn, log, sessionResetModule, getHour } = opts;

      log.audit('update.downloaded', { gateState: 'waiting' });

      function fireWith(trigger) {
        if (fired) return;
        fired = true;
        clearGate();
        // Explicitly unregister the post-reset listener so a subsequent reset
        // doesn't re-trigger anything.
        try { sessionResetModule.onPostReset(null); } catch (_) { /* ignore */ }
        log.audit('update.install', { trigger: trigger });
        try {
          installFn();
        } catch (e) {
          if (log.error) log.error('updateGate.installFn-threw: ' + (e && e.message));
        }
      }

      // Arm (a): maintenance-window polling
      maintenanceTimer = setInterval(() => {
        if (isMaintenanceWindow(getHour)) {
          fireWith('maintenance-window');
        }
      }, MAINTENANCE_POLL_MS);

      // Arm (b): one-shot post-reset listener via sessionReset
      postResetArmed = true;
      sessionResetModule.onPostReset(() => {
        if (!postResetArmed) return; // defensive — already cleared
        fireWith('post-reset');
      });
    }

    function _resetForTests() {
      clearGate();
      fired = false;
    }

    function _isArmedForTests() {
      return { maintenanceTimerSet: maintenanceTimer !== null, postResetArmed: postResetArmed, fired: fired };
    }

    module.exports = {
      onUpdateDownloaded: onUpdateDownloaded,
      isMaintenanceWindow: isMaintenanceWindow,
      _resetForTests: _resetForTests,
      _isArmedForTests: _isArmedForTests,
      _MAINTENANCE_POLL_MS: MAINTENANCE_POLL_MS,
      _MAINTENANCE_HOUR_START: MAINTENANCE_HOUR_START,
      _MAINTENANCE_HOUR_END: MAINTENANCE_HOUR_END,
    };
    ```
  </action>
  <verify>
    <automated>node --check src/main/updateGate.js && node -e "const g=require('./src/main/updateGate');if(typeof g.onUpdateDownloaded!=='function')process.exit(1);if(typeof g.isMaintenanceWindow!=='function')process.exit(2);if(g._MAINTENANCE_HOUR_START!==3||g._MAINTENANCE_HOUR_END!==5)process.exit(3);console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - `src/main/updateGate.js` exists
    - `node --check src/main/updateGate.js` exits 0
    - `grep -nE "MAINTENANCE_HOUR_START\s*=\s*3" src/main/updateGate.js` matches
    - `grep -nE "MAINTENANCE_HOUR_END\s*=\s*5" src/main/updateGate.js` matches
    - `grep -nE "MAINTENANCE_POLL_MS\s*=\s*60_?000" src/main/updateGate.js` matches
    - `grep -n "log.audit('update.downloaded'" src/main/updateGate.js` matches once
    - `grep -nE "log\.audit\('update\.install'" src/main/updateGate.js` matches once (inside fireWith)
    - `grep -nE "'post-reset'|'maintenance-window'" src/main/updateGate.js` matches both strings
    - No `require('electron')` in updateGate.js
    - `grep -n "clearInterval(maintenanceTimer)" src/main/updateGate.js` matches
  </acceptance_criteria>
  <done>updateGate.js exists and exports the documented interface with no Electron coupling.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Unit tests for sessionReset.onPostReset + updateGate</name>
  <read_first>
    - src/main/sessionReset.js (post Task 1)
    - src/main/updateGate.js (post Task 2)
    - test/ existing harness — if Phase 4 has a sessionReset test harness, reference its stub pattern for mainWindow/store
  </read_first>
  <behavior>
    - `test/sessionReset.postReset.test.js`: 4 tests covering fire-on-success, no-fire-on-guard-suppress, no-fire-on-loop-detected, listener replace/clear
    - `test/updateGate.test.js`: 7 tests covering arm, maintenance fire, post-reset fire, first-wins, double-arm clears prior, log.audit emissions, throwing installFn
    - Both test files use fake timers or fake clock injection where possible to avoid real time dependencies
  </behavior>
  <action>
    Create `test/sessionReset.postReset.test.js`:

    ```javascript
    // test/sessionReset.postReset.test.js
    // Phase 5 coverage for the D-15/D-16 onPostReset hook added in Plan 05-03.
    // Must NOT break Phase 4's existing sessionReset test suite.
    const test = require('node:test');
    const assert = require('node:assert');

    // Stub electron BEFORE requiring sessionReset (sessionReset imports 'electron' session at top)
    const electronStub = {
      session: {
        fromPartition: () => ({
          clearStorageData: async () => {},
          cookies: { flushStore: async () => {} },
        }),
      },
    };
    require.cache[require.resolve('electron')] = {
      id: require.resolve('electron'),
      filename: require.resolve('electron'),
      loaded: true,
      exports: electronStub,
    };

    // Stub idleTimer and magiclineView (lazy-required inside hardReset)
    const idleTimerPath = require.resolve('../src/main/idleTimer');
    require.cache[idleTimerPath] = {
      id: idleTimerPath, filename: idleTimerPath, loaded: true,
      exports: { stop: () => {}, init: () => {}, dismiss: () => {}, expired: () => {} },
    };
    const mvPath = require.resolve('../src/main/magiclineView');
    require.cache[mvPath] = {
      id: mvPath, filename: mvPath, loaded: true,
      exports: {
        destroyMagiclineView: () => {},
        createMagiclineView: () => ({ webContents: {} }),
      },
    };

    const sessionReset = require('../src/main/sessionReset');

    function makeMainWindow() {
      const sent = [];
      return {
        webContents: {
          send: (ch, payload) => sent.push({ ch, payload }),
        },
        _sent: sent,
      };
    }

    test('onPostReset: listener fires after successful hardReset', async () => {
      sessionReset._resetForTests();
      sessionReset.init({ mainWindow: makeMainWindow(), store: {} });
      let fired = 0;
      sessionReset.onPostReset(() => { fired++; });
      await sessionReset.hardReset({ reason: 'test-success' });
      assert.strictEqual(fired, 1, 'listener should fire exactly once on success');
    });

    test('onPostReset: listener does NOT fire when call is suppressed (in-flight)', async () => {
      sessionReset._resetForTests();
      sessionReset.init({ mainWindow: makeMainWindow(), store: {} });
      let fired = 0;
      sessionReset.onPostReset(() => { fired++; });
      // Start one reset and immediately fire a second — second returns early (resetting=true)
      const p1 = sessionReset.hardReset({ reason: 'first' });
      const p2 = sessionReset.hardReset({ reason: 'second-suppressed' });
      await Promise.all([p1, p2]);
      // The first succeeded (fired++), the second was suppressed (no additional fire)
      assert.strictEqual(fired, 1, 'suppressed reset must not fire listener');
    });

    test('onPostReset: listener does NOT fire on loop-detected short-circuit', async () => {
      sessionReset._resetForTests();
      sessionReset.init({ mainWindow: makeMainWindow(), store: {} });
      let fired = 0;
      sessionReset.onPostReset(() => { fired++; });
      // 3 resets in rapid succession trips IDLE-05 loop detection on the 3rd
      await sessionReset.hardReset({ reason: 'a' });
      await sessionReset.hardReset({ reason: 'b' });
      await sessionReset.hardReset({ reason: 'c' }); // loop-active latched; early return
      // First two succeeded, third returned early on loop-active — fired should be 2
      assert.strictEqual(fired, 2, 'loop-detected reset must not fire listener; fired=' + fired);
    });

    test('onPostReset(null) clears the listener', async () => {
      sessionReset._resetForTests();
      sessionReset.init({ mainWindow: makeMainWindow(), store: {} });
      let fired = 0;
      sessionReset.onPostReset(() => { fired++; });
      sessionReset.onPostReset(null);
      await sessionReset.hardReset({ reason: 'cleared' });
      assert.strictEqual(fired, 0, 'cleared listener must not fire');
    });
    ```

    Create `test/updateGate.test.js`:

    ```javascript
    // test/updateGate.test.js
    const test = require('node:test');
    const assert = require('node:assert');

    const gate = require('../src/main/updateGate');

    function makeLog() {
      const calls = [];
      return {
        calls,
        audit: (event, fields) => calls.push({ event, fields }),
        error: (msg) => calls.push({ event: 'error', msg }),
      };
    }

    function makeSessionReset() {
      let listener = null;
      return {
        onPostReset: (cb) => { listener = cb; },
        _fire: () => { if (listener) listener(); },
        _getListener: () => listener,
      };
    }

    test('isMaintenanceWindow: true only for hours 3 and 4', () => {
      for (let h = 0; h < 24; h++) {
        const actual = gate.isMaintenanceWindow(() => h);
        const expected = (h === 3 || h === 4);
        assert.strictEqual(actual, expected, 'hour=' + h);
      }
    });

    test('onUpdateDownloaded: emits update.downloaded audit on arm', () => {
      gate._resetForTests();
      const log = makeLog();
      const sr = makeSessionReset();
      let installed = 0;
      gate.onUpdateDownloaded({
        installFn: () => installed++,
        log,
        sessionResetModule: sr,
        getHour: () => 12,
      });
      const downloaded = log.calls.find(c => c.event === 'update.downloaded');
      assert.ok(downloaded, 'update.downloaded audit missing');
      assert.deepStrictEqual(downloaded.fields, { gateState: 'waiting' });
      assert.strictEqual(installed, 0, 'install must not fire immediately');
      gate._resetForTests();
    });

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
      // Second post-reset fire must not re-install
      sr._fire();
      assert.strictEqual(installed, 1, 'second fire must be no-op');
      gate._resetForTests();
    });

    test('onUpdateDownloaded: maintenance-window trigger fires installFn', async () => {
      gate._resetForTests();
      // Monkey-patch setInterval to run synchronously for test determinism
      const origSetInterval = global.setInterval;
      const origClearInterval = global.clearInterval;
      let intervalFn = null;
      let intervalCleared = false;
      global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer'; };
      global.clearInterval = (id) => { if (id === 'fake-timer') intervalCleared = true; };

      try {
        const log = makeLog();
        const sr = makeSessionReset();
        let installed = 0;
        gate.onUpdateDownloaded({
          installFn: () => installed++,
          log,
          sessionResetModule: sr,
          getHour: () => 3, // maintenance window
        });
        assert.strictEqual(installed, 0, 'install must wait for interval tick');
        // Trigger the polled interval manually
        intervalFn();
        assert.strictEqual(installed, 1);
        assert.ok(intervalCleared, 'timer should be cleared after fire');
        const installAudit = log.calls.find(c => c.event === 'update.install');
        assert.strictEqual(installAudit.fields.trigger, 'maintenance-window');
      } finally {
        global.setInterval = origSetInterval;
        global.clearInterval = origClearInterval;
        gate._resetForTests();
      }
    });

    test('onUpdateDownloaded: first trigger wins (post-reset beats maintenance)', () => {
      gate._resetForTests();
      const origSetInterval = global.setInterval;
      const origClearInterval = global.clearInterval;
      let intervalFn = null;
      global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-2'; };
      global.clearInterval = () => {};
      try {
        const log = makeLog();
        const sr = makeSessionReset();
        let installed = 0;
        gate.onUpdateDownloaded({
          installFn: () => installed++,
          log,
          sessionResetModule: sr,
          getHour: () => 3,
        });
        sr._fire(); // post-reset wins
        // Attempting to also fire interval should be no-op
        if (intervalFn) intervalFn();
        assert.strictEqual(installed, 1);
      } finally {
        global.setInterval = origSetInterval;
        global.clearInterval = origClearInterval;
        gate._resetForTests();
      }
    });

    test('onUpdateDownloaded: double-arm clears prior gate', () => {
      gate._resetForTests();
      const log = makeLog();
      const sr = makeSessionReset();
      let installedA = 0, installedB = 0;
      gate.onUpdateDownloaded({
        installFn: () => installedA++,
        log, sessionResetModule: sr, getHour: () => 12,
      });
      gate.onUpdateDownloaded({
        installFn: () => installedB++,
        log, sessionResetModule: sr, getHour: () => 12,
      });
      sr._fire();
      assert.strictEqual(installedA, 0, 'first gate should have been cleared');
      assert.strictEqual(installedB, 1, 'second gate should fire');
      gate._resetForTests();
    });

    test('onUpdateDownloaded: throws clearly on missing args', () => {
      assert.throws(() => gate.onUpdateDownloaded(), /installFn is required/);
      assert.throws(() => gate.onUpdateDownloaded({ installFn: () => {} }), /log\.audit is required/);
      assert.throws(() => gate.onUpdateDownloaded({
        installFn: () => {},
        log: { audit: () => {} },
      }), /sessionResetModule/);
    });

    test('onUpdateDownloaded: installFn throw is logged not propagated', () => {
      gate._resetForTests();
      const log = makeLog();
      const sr = makeSessionReset();
      gate.onUpdateDownloaded({
        installFn: () => { throw new Error('boom'); },
        log, sessionResetModule: sr, getHour: () => 12,
      });
      assert.doesNotThrow(() => sr._fire());
      const errCall = log.calls.find(c => c.event === 'error');
      assert.ok(errCall, 'error should be logged');
      gate._resetForTests();
    });
    ```
  </action>
  <verify>
    <automated>node --test test/sessionReset.postReset.test.js test/updateGate.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/sessionReset.postReset.test.js test/updateGate.test.js` exits 0
    - Output shows all 4 + 8 = 12 tests pass (# pass 12)
    - No `# fail` lines
    - Existing Phase 4 sessionReset test suite still passes (if present, run it separately and confirm green)
    - Tests do not require electron runtime (require.cache stubs prove this)
  </acceptance_criteria>
  <done>Tests green; sessionReset.postReset hook + updateGate.js logic fully covered.</done>
</task>

</tasks>

<verification>
1. `node --check src/main/sessionReset.js src/main/updateGate.js` exits 0
2. `node --test test/sessionReset.postReset.test.js test/updateGate.test.js` all green
3. Phase 4 existing sessionReset/integration tests still pass
4. `git diff --stat src/main/sessionReset.js` shows small surgical diff (< 30 lines)
5. `grep -c "D-15 step" src/main/sessionReset.js` unchanged from Phase 4
</verification>

<success_criteria>
- sessionReset.onPostReset(cb) exists, fires only on successful reset
- updateGate.js gates electron-updater installs on first-of (post-reset | 03:00–05:00)
- log.audit emissions on arm and fire with correct event names and trigger values
- 12 unit tests prove the full behavior
- Phase 4 contracts preserved (11-step flow untouched)
</success_criteria>

<output>
After completion, create `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-03-SUMMARY.md` with:
- sessionReset.js diff stats
- updateGate.js exports
- Test pass counts
- Confirmation Phase 4 regression suite still green
</output>
