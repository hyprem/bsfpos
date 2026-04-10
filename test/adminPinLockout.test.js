// test/adminPinLockout.test.js
// Phase 5 Plan 02 — ADMIN-03 unit tests for the lockout wrapper.
// Uses an in-memory store stub and stubs adminPin.verifyPin via require cache
// so we can deterministically drive ok/fail without building real scrypt records.
const test = require('node:test');
const assert = require('node:assert');

// In-memory store stub implementing the electron-store .get/.set contract.
function makeStore() {
  const data = new Map();
  return {
    get: (k) => data.get(k),
    // deep-clone on set to simulate JSON-round-trip persistence
    set: (k, v) => data.set(k, JSON.parse(JSON.stringify(v))),
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
  store.set('adminPinLockout', { attempts: [1, 2, 3, 4, 5], lockedUntil: expired });
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
