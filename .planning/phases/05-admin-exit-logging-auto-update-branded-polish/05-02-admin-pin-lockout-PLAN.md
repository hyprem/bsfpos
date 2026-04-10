---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/adminPinLockout.js
  - test/adminPinLockout.test.js
autonomous: true
requirements: [ADMIN-03]
tags: [security, admin, lockout, rate-limit, persistence]
must_haves:
  truths:
    - "A correct PIN on attempt 1 returns {ok:true, locked:false, lockedUntil:null} and clears any prior attempts"
    - "5 failed PIN attempts inside a 60-second rolling window sets lockedUntil to now + 5 minutes"
    - "While locked, every verify call returns {ok:false, locked:true, lockedUntil:<Date>} WITHOUT calling adminPin.verifyPin"
    - "Failed attempts older than 60 seconds are pruned on every verify call"
    - "Correct PIN after lockout expiry (lockedUntil < now) clears all state and returns ok:true"
    - "Lockout state is persisted in electron-store under key `adminPinLockout` and survives process restart"
    - "src/main/adminPin.js is NOT modified (preserves Phase 3 D-10 contract)"
  artifacts:
    - path: "src/main/adminPinLockout.js"
      provides: "verifyPinWithLockout(store, pin) wrapper around adminPin"
      exports: ["verifyPinWithLockout", "_WINDOW_MS", "_MAX_ATTEMPTS", "_LOCKOUT_MS"]
    - path: "test/adminPinLockout.test.js"
      provides: "Unit tests: happy path, failure counting, lockout trip, persistence, pruning, post-expiry reset"
  key_links:
    - from: "src/main/adminPinLockout.js"
      to: "src/main/adminPin.js"
      via: "require('./adminPin').verifyPin(store, pin)"
      pattern: "adminPin\\.verifyPin\\(store"
    - from: "src/main/adminPinLockout.js"
      to: "electron-store (store.get/set)"
      via: "store.get('adminPinLockout') / store.set('adminPinLockout', ...)"
      pattern: "adminPinLockout"
---

<objective>
Create `src/main/adminPinLockout.js` — a stateless wrapper around the existing `adminPin.verifyPin(store, pin)` that adds persistent rolling-window rate-limit lockout per ADMIN-03 and CONTEXT.md D-09..D-13. The wrapper MUST NOT modify `src/main/adminPin.js` (Phase 3 D-10 contract).

Purpose: Close ADMIN-03 (5 wrong / 60s → 5-min lockout, crash-resistant via persistence). Unblock Plan 04 which wires the new `ipcMain.handle('verify-admin-pin')` to this wrapper.

Output: one new main-process module + one unit-test file (7+ tests). Pure Node — no Electron import, `store` is dependency-injected so tests use a plain Map-backed stub.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md
@src/main/adminPin.js
</context>

<interfaces>
Existing `adminPin.js` contract (Phase 3 — READ-ONLY in Phase 5):
```javascript
// src/main/adminPin.js exports
exports.verifyPin  = function(store, input): boolean;   // timing-safe scrypt compare
exports.hasPin     = function(store): boolean;
exports.buildRecord = function(pin): {hash, salt, params};
exports.setPin     = function(store, pin): void;
```

`adminPin.verifyPin` returns a plain boolean. It does NOT track attempts. Phase 5 wraps it.

electron-store `store` object contract (already used repo-wide):
```javascript
store.get(key)           // returns stored value or undefined
store.set(key, value)    // atomic single-key write
```

New wrapper contract:
```javascript
// src/main/adminPinLockout.js
/**
 * @param {object} store - electron-store instance
 * @param {string} pin - user-entered PIN digits
 * @returns {{ok: boolean, locked: boolean, lockedUntil: Date|null}}
 */
function verifyPinWithLockout(store, pin): Result

// Persisted shape (electron-store key `adminPinLockout`):
type Persisted = {
  attempts: number[]       // Unix ms timestamps of failed attempts in the rolling window
  lockedUntil: string|null // ISO timestamp, or null
}
```

Constants (CONTEXT.md D-10, RESEARCH §Pattern 3):
- `WINDOW_MS = 60_000` (rolling failure window)
- `MAX_ATTEMPTS = 5`
- `LOCKOUT_MS = 5 * 60_000` (5 minutes)
</interfaces>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer (PIN input) → main (verifyPinWithLockout) | Member-controlled input crosses IPC; attacker may mash PINs or kill the process to reset counters |
| main → electron-store (disk JSON) | Lockout state persisted to `%AppData%\Bee Strong POS\config.json` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-07 | E (Elevation) | Brute force PIN via rapid attempts | mitigate | Rolling 60s window + 5-attempt cap + 5-min lockout. Unit test asserts 5 fails → locked=true |
| T-05-08 | E (Elevation) | Attacker kills process to reset in-memory counter | mitigate | Store write happens BEFORE return on every failed attempt (RESEARCH Pitfall 3). Unit test asserts a fresh wrapper call with a shared store sees prior attempts |
| T-05-09 | E (Elevation) | Race: two concurrent verify calls both pass attempt 4→5 guard | accept | Main process is single-threaded; IPC calls serialize. Documented accept |
| T-05-10 | I (Info disclosure) | Timing side-channel reveals PIN validity during lockout | mitigate | During lockout, wrapper returns early WITHOUT calling scrypt (no timing signal). Unit test asserts `adminPin.verifyPin` is NOT called while locked |
| T-05-11 | T (Tampering) | Attacker edits config.json to clear lockedUntil | accept | DPAPI-bounded Windows user; standard-user lockdown + BitLocker already mitigate disk tampering per Phase 1. Documented accept |
| T-05-12 | R (Repudiation) | No audit trail for lockout events | mitigate | Every lockout trip and PIN failure logged via log.audit('pin.lockout',...) and log.audit('pin.verify',...) in Plan 04 consumer — documented in wrapper as TODO for caller to emit. Wrapper itself stays pure |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create adminPinLockout.js wrapper module</name>
  <read_first>
    - src/main/adminPin.js (entire file — understand exported contract; DO NOT modify)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md §D-09 through §D-13
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md §Pattern 3 §Pitfall 3
    - src/main/credentialsStore.js (existing electron-store usage pattern for reference)
  </read_first>
  <behavior>
    - Pure module: no electron imports, no globals, no module-scoped mutable state. All state lives in `store`
    - Exports exactly: `verifyPinWithLockout`, and test-only `_WINDOW_MS`, `_MAX_ATTEMPTS`, `_LOCKOUT_MS`
    - On call, first reads `store.get('adminPinLockout')`; defaults to `{attempts:[], lockedUntil:null}`
    - If `lockedUntil` is set AND `new Date(lockedUntil).getTime() > Date.now()`: returns `{ok:false, locked:true, lockedUntil:Date}` WITHOUT calling `adminPin.verifyPin`
    - Otherwise prunes `attempts` to only timestamps within `WINDOW_MS` of now
    - Calls `adminPin.verifyPin(store, pin)`. If true: `store.set('adminPinLockout', {attempts:[], lockedUntil:null})` then return `{ok:true, locked:false, lockedUntil:null}`
    - If false: push `now` to attempts. If `attempts.length >= MAX_ATTEMPTS`: set `lockedUntil = new Date(now + LOCKOUT_MS).toISOString()`. Atomic `store.set('adminPinLockout', next)`. Return `{ok:false, locked:(attempts.length>=MAX_ATTEMPTS), lockedUntil:Date|null}`
    - Import of `./adminPin` must be at top of file (synchronous require). `./logger` can also be imported for error paths, but NO log.audit calls — audit emission is the caller's responsibility
  </behavior>
  <action>
    Create `src/main/adminPinLockout.js`:

    ```javascript
    // src/main/adminPinLockout.js
    // Phase 5 ADMIN-03 / CONTEXT.md D-09..D-13
    //
    // Rate-limit lockout wrapper around adminPin.verifyPin. Adds a rolling
    // 60-second failure window; after 5 failures latches a 5-minute lockout.
    // Persists ALL state to electron-store under key `adminPinLockout` so a
    // crash-and-relaunch attack cannot reset the counter.
    //
    // CONTRACT: src/main/adminPin.js is NEVER modified by Phase 5.
    // (Phase 3 D-10 hand-off: "Phase 5 adds lockout ON TOP of this module".)
    //
    // All timestamps are numeric Unix ms internally; persisted lockedUntil is
    // an ISO string for JSON-friendly storage.

    const adminPin = require('./adminPin');

    const WINDOW_MS   = 60_000;          // D-10: 60-second rolling failure window
    const MAX_ATTEMPTS = 5;              // D-10: 5 failures trips lockout
    const LOCKOUT_MS  = 5 * 60_000;      // D-10: 5-minute lockout

    const STORE_KEY = 'adminPinLockout';

    function readState(store) {
      const raw = store.get(STORE_KEY);
      if (!raw || typeof raw !== 'object') {
        return { attempts: [], lockedUntil: null };
      }
      return {
        attempts: Array.isArray(raw.attempts) ? raw.attempts.filter((t) => typeof t === 'number') : [],
        lockedUntil: typeof raw.lockedUntil === 'string' ? raw.lockedUntil : null,
      };
    }

    function isCurrentlyLocked(state, now) {
      if (!state.lockedUntil) return false;
      const until = new Date(state.lockedUntil).getTime();
      return Number.isFinite(until) && until > now;
    }

    function prune(attempts, now) {
      return attempts.filter((t) => typeof t === 'number' && now - t < WINDOW_MS);
    }

    /**
     * Verify a PIN attempt with persistent rate-limit lockout.
     *
     * @param {object} store - electron-store instance with .get/.set
     * @param {string} pin - user-entered PIN digits
     * @returns {{ok:boolean, locked:boolean, lockedUntil:(Date|null)}}
     */
    function verifyPinWithLockout(store, pin) {
      const now = Date.now();
      const state = readState(store);

      // D-12: currently locked — refuse without burning a scrypt call
      if (isCurrentlyLocked(state, now)) {
        return {
          ok: false,
          locked: true,
          lockedUntil: new Date(state.lockedUntil),
        };
      }

      // Prune stale attempts outside rolling window
      state.attempts = prune(state.attempts, now);
      // Clear any expired lockedUntil so a post-expiry good PIN returns cleanly
      if (state.lockedUntil) {
        state.lockedUntil = null;
      }

      // Delegate to Phase 3 adminPin (scrypt + timingSafeEqual)
      const ok = adminPin.verifyPin(store, pin);

      if (ok) {
        // D-11: full reset on success
        store.set(STORE_KEY, { attempts: [], lockedUntil: null });
        return { ok: true, locked: false, lockedUntil: null };
      }

      // Failed — record attempt
      state.attempts.push(now);
      let lockedUntilIso = null;
      if (state.attempts.length >= MAX_ATTEMPTS) {
        lockedUntilIso = new Date(now + LOCKOUT_MS).toISOString();
      }

      // Atomic single-key write (electron-store store.set is atomic per D-11
      // precedent from Phase 3). Write BEFORE returning per RESEARCH Pitfall 3.
      store.set(STORE_KEY, {
        attempts: state.attempts,
        lockedUntil: lockedUntilIso,
      });

      return {
        ok: false,
        locked: state.attempts.length >= MAX_ATTEMPTS,
        lockedUntil: lockedUntilIso ? new Date(lockedUntilIso) : null,
      };
    }

    module.exports = {
      verifyPinWithLockout,
      // Test-only exports
      _WINDOW_MS: WINDOW_MS,
      _MAX_ATTEMPTS: MAX_ATTEMPTS,
      _LOCKOUT_MS: LOCKOUT_MS,
      _STORE_KEY: STORE_KEY,
    };
    ```
  </action>
  <verify>
    <automated>node --check src/main/adminPinLockout.js && node -e "const m=require('./src/main/adminPinLockout');if(typeof m.verifyPinWithLockout!=='function')process.exit(1);if(m._MAX_ATTEMPTS!==5)process.exit(2);if(m._LOCKOUT_MS!==300000)process.exit(3);if(m._WINDOW_MS!==60000)process.exit(4);console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - File `src/main/adminPinLockout.js` exists
    - `node --check src/main/adminPinLockout.js` exits 0
    - `grep -nE "require\('./adminPin'\)" src/main/adminPinLockout.js` matches
    - `grep -nE "WINDOW_MS\s*=\s*60_?000" src/main/adminPinLockout.js` matches
    - `grep -nE "MAX_ATTEMPTS\s*=\s*5" src/main/adminPinLockout.js` matches
    - `grep -nE "LOCKOUT_MS\s*=\s*5\s*\*\s*60_?000" src/main/adminPinLockout.js` matches
    - `grep -nE "store\.set\('adminPinLockout'|store\.set\(STORE_KEY" src/main/adminPinLockout.js` matches at least twice (failure path + success reset)
    - `grep -n "verifyPinWithLockout" src/main/adminPinLockout.js` matches
    - `git diff --stat src/main/adminPin.js` is EMPTY (file not modified)
    - No `require('electron')` in adminPinLockout.js (`grep -n "require('electron" src/main/adminPinLockout.js` returns nothing)
  </acceptance_criteria>
  <done>adminPinLockout.js exists, exports verifyPinWithLockout with the documented shape, and does not touch adminPin.js.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Unit tests for adminPinLockout — happy path, counting, lockout, pruning, persistence</name>
  <read_first>
    - src/main/adminPinLockout.js (post Task 1)
    - src/main/adminPin.js (understand that verifyPin will be stubbed in tests via a fake store containing no real adminPin record — tests must stub `adminPin.verifyPin` OR construct a real PIN record via `adminPin.setPin` on a stub store)
    - test/ existing test harness pattern (node --test)
  </read_first>
  <behavior>
    - Uses a minimal in-memory store stub: a Map-backed object with .get/.set
    - Stubs `adminPin.verifyPin` via require cache override so tests control ok/fail outcomes deterministically without needing a real PIN hash
    - 10 distinct test cases covering all state transitions
  </behavior>
  <action>
    Create `test/adminPinLockout.test.js`:

    ```javascript
    // test/adminPinLockout.test.js
    const test = require('node:test');
    const assert = require('node:assert');
    const path = require('path');

    // In-memory store stub implementing the electron-store .get/.set contract.
    function makeStore() {
      const data = new Map();
      return {
        get: (k) => data.get(k),
        set: (k, v) => data.set(k, JSON.parse(JSON.stringify(v))), // deep-clone to simulate JSON persistence
        _data: data,
      };
    }

    // Stub adminPin.verifyPin via require cache so the wrapper delegates to our fake.
    const adminPinPath = require.resolve('../src/main/adminPin');
    let nextVerifyResult = false;
    let verifyCallCount = 0;
    require.cache[adminPinPath] = {
      id: adminPinPath,
      filename: adminPinPath,
      loaded: true,
      exports: {
        verifyPin: (_store, _pin) => {
          verifyCallCount++;
          return nextVerifyResult;
        },
        hasPin: () => true,
        buildRecord: () => ({}),
        setPin: () => {},
      },
    };

    const lockout = require('../src/main/adminPinLockout');

    function reset() {
      nextVerifyResult = false;
      verifyCallCount = 0;
    }

    test('constants: MAX_ATTEMPTS=5, WINDOW_MS=60000, LOCKOUT_MS=300000', () => {
      assert.strictEqual(lockout._MAX_ATTEMPTS, 5);
      assert.strictEqual(lockout._WINDOW_MS, 60_000);
      assert.strictEqual(lockout._LOCKOUT_MS, 300_000);
    });

    test('happy path: first-try correct PIN returns ok:true, locked:false', () => {
      reset();
      const store = makeStore();
      nextVerifyResult = true;
      const r = lockout.verifyPinWithLockout(store, '1234');
      assert.deepStrictEqual(r, { ok: true, locked: false, lockedUntil: null });
      assert.strictEqual(verifyCallCount, 1);
      // Store must have been reset to clean state
      assert.deepStrictEqual(store.get('adminPinLockout'), { attempts: [], lockedUntil: null });
    });

    test('single failure: ok:false, locked:false, attempts=[t]', () => {
      reset();
      const store = makeStore();
      nextVerifyResult = false;
      const r = lockout.verifyPinWithLockout(store, '9999');
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.locked, false);
      assert.strictEqual(r.lockedUntil, null);
      const saved = store.get('adminPinLockout');
      assert.strictEqual(saved.attempts.length, 1);
      assert.strictEqual(saved.lockedUntil, null);
    });

    test('5 consecutive failures trip lockout on the 5th', () => {
      reset();
      const store = makeStore();
      nextVerifyResult = false;
      let r;
      for (let i = 1; i <= 5; i++) {
        r = lockout.verifyPinWithLockout(store, '0000');
      }
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.locked, true, 'should be locked after 5 failures');
      assert.ok(r.lockedUntil instanceof Date);
      const saved = store.get('adminPinLockout');
      assert.strictEqual(saved.attempts.length, 5);
      assert.ok(typeof saved.lockedUntil === 'string');
      // lockedUntil should be ~5 minutes in the future
      const delta = new Date(saved.lockedUntil).getTime() - Date.now();
      assert.ok(delta > 4 * 60_000 && delta <= 5 * 60_000, 'lockedUntil delta: ' + delta);
    });

    test('while locked: subsequent calls return locked:true without calling adminPin.verifyPin', () => {
      reset();
      const store = makeStore();
      nextVerifyResult = false;
      for (let i = 0; i < 5; i++) lockout.verifyPinWithLockout(store, '0000');
      const callsAfterTrip = verifyCallCount;
      // Attempt during lockout — MUST NOT invoke adminPin.verifyPin (T-05-10)
      nextVerifyResult = true; // even if correct PIN, must stay locked
      const r = lockout.verifyPinWithLockout(store, '1234');
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.locked, true);
      assert.strictEqual(verifyCallCount, callsAfterTrip, 'adminPin.verifyPin must not be called while locked');
    });

    test('lockout persists across wrapper calls with shared store (simulates crash+restart)', () => {
      reset();
      const store = makeStore();
      nextVerifyResult = false;
      for (let i = 0; i < 5; i++) lockout.verifyPinWithLockout(store, '0000');
      // Simulate app restart: new "session" uses same store
      const r = lockout.verifyPinWithLockout(store, '0000');
      assert.strictEqual(r.locked, true);
    });

    test('correct PIN after lockout expiry returns ok:true and clears state', () => {
      reset();
      const store = makeStore();
      // Manually seed an EXPIRED lockout
      const expired = new Date(Date.now() - 1000).toISOString();
      store.set('adminPinLockout', { attempts: [1,2,3,4,5], lockedUntil: expired });
      nextVerifyResult = true;
      const r = lockout.verifyPinWithLockout(store, '1234');
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.locked, false);
      assert.strictEqual(r.lockedUntil, null);
      assert.deepStrictEqual(store.get('adminPinLockout'), { attempts: [], lockedUntil: null });
      assert.strictEqual(verifyCallCount, 1, 'expired lockout must allow adminPin.verifyPin call');
    });

    test('attempts outside 60s window are pruned', () => {
      reset();
      const store = makeStore();
      const stale = Date.now() - 70_000; // 70s ago — outside 60s window
      store.set('adminPinLockout', { attempts: [stale, stale, stale, stale], lockedUntil: null });
      nextVerifyResult = false;
      const r = lockout.verifyPinWithLockout(store, '0000');
      // After pruning, only the new failure remains → 1 attempt, not 5 → NOT locked
      assert.strictEqual(r.locked, false);
      const saved = store.get('adminPinLockout');
      assert.strictEqual(saved.attempts.length, 1, 'stale attempts should be pruned');
    });

    test('successful PIN fully resets counter mid-window', () => {
      reset();
      const store = makeStore();
      nextVerifyResult = false;
      for (let i = 0; i < 3; i++) lockout.verifyPinWithLockout(store, '0000');
      assert.strictEqual(store.get('adminPinLockout').attempts.length, 3);
      // Now a correct one — D-11 full reset
      nextVerifyResult = true;
      const r = lockout.verifyPinWithLockout(store, '1234');
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(store.get('adminPinLockout'), { attempts: [], lockedUntil: null });
    });

    test('store write happens on EVERY failed attempt (no batching)', () => {
      reset();
      const store = makeStore();
      let writes = 0;
      const origSet = store.set;
      store.set = (k, v) => { if (k === 'adminPinLockout') writes++; return origSet(k, v); };
      nextVerifyResult = false;
      for (let i = 0; i < 4; i++) lockout.verifyPinWithLockout(store, '0000');
      assert.strictEqual(writes, 4, 'expected one store write per failed attempt');
    });
    ```
  </action>
  <verify>
    <automated>node --test test/adminPinLockout.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/adminPinLockout.test.js` exits 0
    - Output shows `# pass 10` (or all-green with 10 tests)
    - No `# fail`
    - Test file uses only Node builtins (`node:test`, `node:assert`, `path`)
    - `grep -nE "MAX_ATTEMPTS" test/adminPinLockout.test.js` matches
    - `grep -nE "verifyCallCount" test/adminPinLockout.test.js` matches (proves timing-safe assert that adminPin is NOT called while locked)
  </acceptance_criteria>
  <done>10 unit tests green covering happy path, failure counting, lockout trip, bypass-while-locked, persistence, pruning, post-expiry clear, reset-on-success, per-attempt write.</done>
</task>

</tasks>

<verification>
1. `node --check src/main/adminPinLockout.js` exits 0
2. `node --test test/adminPinLockout.test.js` — all 10 tests green
3. `git diff src/main/adminPin.js` is empty (contract preserved)
4. Phase 3 regression tests still pass (run existing adminPin test suite if one exists)
5. No new npm deps
</verification>

<success_criteria>
- ADMIN-03 fully implemented: 5 wrong / 60s → 5-min lockout, crash-resistant, timing-side-channel safe
- adminPin.js contract preserved (zero diff)
- Wrapper is dependency-injected and pure-testable
- Plan 04 can import `verifyPinWithLockout` and wire it to the new `verify-admin-pin` IPC handler
</success_criteria>

<output>
After completion, create `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-02-SUMMARY.md` with:
- adminPinLockout.js exports list
- Test pass count (should be 10)
- Verification that adminPin.js diff is empty
</output>
