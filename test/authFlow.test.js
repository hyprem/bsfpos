// test/authFlow.test.js
// Unit tests for the pure reducer in src/main/authFlow.js.
// Task 1 of plan 03-04. Executor tests come in Task 2.
//
// Per D-21 (03-CONTEXT.md): no retry state, no LOGIN_FAILED, any login
// failure routes to CREDENTIALS_UNAVAILABLE with clear-credentials.

const test = require('node:test');
const assert = require('node:assert');
const { reduce, STATES, _POST_SUBMIT_WATCHDOG_MS, _BOOT_WATCHDOG_MS } = require('../src/main/authFlow');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function hasSideEffect(sideEffects, kind, match) {
  return sideEffects.some((sx) => {
    if (sx.kind !== kind) return false;
    if (!match) return true;
    for (const k of Object.keys(match)) {
      if (sx[k] !== match[k]) return false;
    }
    return true;
  });
}

const CTX_CREDS   = Object.freeze({ hasCreds: true });
const CTX_NOCREDS = Object.freeze({ hasCreds: false });

// -----------------------------------------------------------------------------
// STATES invariants
// -----------------------------------------------------------------------------

test('STATES has exactly 6 entries and does NOT include LOGIN_FAILED (D-21)', () => {
  const keys = Object.keys(STATES);
  assert.strictEqual(keys.length, 6);
  assert.ok(keys.includes('BOOTING'));
  assert.ok(keys.includes('NEEDS_CREDENTIALS'));
  assert.ok(keys.includes('LOGIN_DETECTED'));
  assert.ok(keys.includes('LOGIN_SUBMITTED'));
  assert.ok(keys.includes('CASH_REGISTER_READY'));
  assert.ok(keys.includes('CREDENTIALS_UNAVAILABLE'));
  assert.ok(!keys.includes('LOGIN_FAILED'), 'LOGIN_FAILED must not exist per D-21');
});

test('STATES is frozen', () => {
  assert.ok(Object.isFrozen(STATES));
});

test('watchdog constants are sane', () => {
  assert.strictEqual(_POST_SUBMIT_WATCHDOG_MS, 8000);
  assert.strictEqual(_BOOT_WATCHDOG_MS, 12000);
});

// -----------------------------------------------------------------------------
// Purity
// -----------------------------------------------------------------------------

test('reduce does not mutate its arguments', () => {
  const state = STATES.BOOTING;
  const event = Object.freeze({ type: 'creds-loaded' });
  const ctx = Object.freeze({ hasCreds: true });
  // If the reducer tried to mutate the frozen args it would throw in strict mode.
  const r = reduce(state, event, ctx);
  assert.ok(r);
  assert.strictEqual(ctx.hasCreds, true);
});

test('reduce returns a fresh sideEffects array every call', () => {
  const r1 = reduce(STATES.BOOTING, { type: 'creds-loaded' }, CTX_CREDS);
  const r2 = reduce(STATES.BOOTING, { type: 'creds-loaded' }, CTX_CREDS);
  assert.notStrictEqual(r1.sideEffects, r2.sideEffects);
});

test('reduce ignores extra ctx fields (attempts etc. are gone in D-21)', () => {
  // Legacy callers might still pass attempts; reducer must not care.
  const r = reduce(STATES.BOOTING, { type: 'creds-loaded' }, { hasCreds: true, attempts: 99, maxAttempts: 3 });
  assert.strictEqual(r.next, STATES.BOOTING);
  assert.ok(hasSideEffect(r.sideEffects, 'start-timer', { name: 'boot' }));
});

// -----------------------------------------------------------------------------
// BOOTING state
// -----------------------------------------------------------------------------

test('BOOTING + creds-loaded (hasCreds=true) stays BOOTING + arms boot watchdog', () => {
  const r = reduce(STATES.BOOTING, { type: 'creds-loaded' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.BOOTING);
  assert.ok(hasSideEffect(r.sideEffects, 'start-timer', { name: 'boot', ms: 12000 }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'creds-loaded' }));
});

test('BOOTING + creds-loaded (hasCreds=false) -> NEEDS_CREDENTIALS + show overlay firstRun', () => {
  const r = reduce(STATES.BOOTING, { type: 'creds-loaded' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.NEEDS_CREDENTIALS);
  assert.ok(hasSideEffect(r.sideEffects, 'show-credentials-overlay', { firstRun: true }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'first-run' }));
});

test('BOOTING + safestorage-unavailable -> CREDENTIALS_UNAVAILABLE', () => {
  const r = reduce(STATES.BOOTING, { type: 'safestorage-unavailable' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'show-error', { variant: 'credentials-unavailable' }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'safestorage-unavailable' }));
});

test('BOOTING + decrypt-failed -> CREDENTIALS_UNAVAILABLE', () => {
  const r = reduce(STATES.BOOTING, { type: 'decrypt-failed' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'show-error', { variant: 'credentials-unavailable' }));
});

test('BOOTING + login-detected + hasCreds -> LOGIN_DETECTED + fill-and-submit + post-submit timer', () => {
  const r = reduce(STATES.BOOTING, { type: 'login-detected' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.LOGIN_DETECTED);
  assert.ok(hasSideEffect(r.sideEffects, 'clear-timer', { name: 'boot' }));
  assert.ok(hasSideEffect(r.sideEffects, 'fill-and-submit'));
  assert.ok(hasSideEffect(r.sideEffects, 'start-timer', { name: 'post-submit', ms: 8000 }));
});

test('BOOTING + login-detected WITHOUT creds -> stays BOOTING (no fill-and-submit)', () => {
  const r = reduce(STATES.BOOTING, { type: 'login-detected' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.BOOTING);
  assert.strictEqual(hasSideEffect(r.sideEffects, 'fill-and-submit'), false);
});

test('BOOTING + cash-register-ready -> CASH_REGISTER_READY (cookie-session skip-login)', () => {
  const r = reduce(STATES.BOOTING, { type: 'cash-register-ready' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CASH_REGISTER_READY);
  assert.ok(hasSideEffect(r.sideEffects, 'clear-timer', { name: 'boot' }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'cash-register-ready-cookie' }));
});

test('BOOTING + timer-expired(boot) -> CREDENTIALS_UNAVAILABLE (D-21: was LOGIN_FAILED)', () => {
  const r = reduce(STATES.BOOTING, { type: 'timer-expired', name: 'boot' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'show-error', { variant: 'credentials-unavailable' }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'boot-watchdog-expired' }));
});

test('BOOTING + unknown event -> stays BOOTING with no side effects', () => {
  const r = reduce(STATES.BOOTING, { type: 'random-garbage' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.BOOTING);
  assert.deepStrictEqual(r.sideEffects, []);
});

// -----------------------------------------------------------------------------
// LOGIN_DETECTED state
// -----------------------------------------------------------------------------

test('LOGIN_DETECTED + login-submitted -> LOGIN_SUBMITTED', () => {
  const r = reduce(STATES.LOGIN_DETECTED, { type: 'login-submitted' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.LOGIN_SUBMITTED);
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'submit-fired' }));
});

test('LOGIN_DETECTED + login-failed -> CREDENTIALS_UNAVAILABLE + clear-credentials (D-21 text-match)', () => {
  const r = reduce(STATES.LOGIN_DETECTED, { type: 'login-failed' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'clear-credentials'));
  assert.ok(hasSideEffect(r.sideEffects, 'clear-timer', { name: 'post-submit' }));
  assert.ok(hasSideEffect(r.sideEffects, 'show-error', { variant: 'credentials-unavailable' }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'login-failed-text-match' }));
});

test('LOGIN_DETECTED + timer-expired(post-submit) -> CREDENTIALS_UNAVAILABLE + clear-credentials (D-21 watchdog)', () => {
  const r = reduce(STATES.LOGIN_DETECTED, { type: 'timer-expired', name: 'post-submit' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'clear-credentials'));
  assert.ok(hasSideEffect(r.sideEffects, 'show-error', { variant: 'credentials-unavailable' }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'post-submit-watchdog-expired' }));
});

test('LOGIN_DETECTED + unknown event -> stays', () => {
  const r = reduce(STATES.LOGIN_DETECTED, { type: 'pin-ok' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.LOGIN_DETECTED);
  assert.deepStrictEqual(r.sideEffects, []);
});

// -----------------------------------------------------------------------------
// LOGIN_SUBMITTED state
// -----------------------------------------------------------------------------

test('LOGIN_SUBMITTED + cash-register-ready -> CASH_REGISTER_READY', () => {
  const r = reduce(STATES.LOGIN_SUBMITTED, { type: 'cash-register-ready' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CASH_REGISTER_READY);
  assert.ok(hasSideEffect(r.sideEffects, 'clear-timer', { name: 'post-submit' }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'cash-register-ready' }));
});

test('LOGIN_SUBMITTED + login-failed -> CREDENTIALS_UNAVAILABLE + clear-credentials', () => {
  const r = reduce(STATES.LOGIN_SUBMITTED, { type: 'login-failed' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'clear-credentials'));
  assert.ok(hasSideEffect(r.sideEffects, 'show-error', { variant: 'credentials-unavailable' }));
});

test('LOGIN_SUBMITTED + timer-expired(post-submit) -> CREDENTIALS_UNAVAILABLE + clear-credentials', () => {
  const r = reduce(STATES.LOGIN_SUBMITTED, { type: 'timer-expired', name: 'post-submit' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'clear-credentials'));
});

test('LOGIN_SUBMITTED + login-detected (re-fire) -> STAYS LOGIN_SUBMITTED + log only (D-21: not a failure)', () => {
  const r = reduce(STATES.LOGIN_SUBMITTED, { type: 'login-detected' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.LOGIN_SUBMITTED);
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'login-redetected-ignored' }));
  // Must NOT route to failure or clear credentials.
  assert.strictEqual(hasSideEffect(r.sideEffects, 'clear-credentials'), false);
  assert.strictEqual(hasSideEffect(r.sideEffects, 'show-error'), false);
});

test('LOGIN_SUBMITTED + unrelated timer -> stays', () => {
  const r = reduce(STATES.LOGIN_SUBMITTED, { type: 'timer-expired', name: 'boot' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.LOGIN_SUBMITTED);
});

// -----------------------------------------------------------------------------
// NEEDS_CREDENTIALS state
// -----------------------------------------------------------------------------

test('NEEDS_CREDENTIALS + credentials-submitted -> BOOTING + hide overlay + rerun-boot', () => {
  const r = reduce(STATES.NEEDS_CREDENTIALS, { type: 'credentials-submitted' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.BOOTING);
  assert.ok(hasSideEffect(r.sideEffects, 'hide-credentials-overlay'));
  assert.ok(hasSideEffect(r.sideEffects, 'rerun-boot'));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'creds-saved' }));
});

test('NEEDS_CREDENTIALS + unknown -> stays', () => {
  const r = reduce(STATES.NEEDS_CREDENTIALS, { type: 'pin-ok' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.NEEDS_CREDENTIALS);
});

// -----------------------------------------------------------------------------
// CREDENTIALS_UNAVAILABLE state
// -----------------------------------------------------------------------------

test('CREDENTIALS_UNAVAILABLE + pin-recovery-requested -> stays + show-pin-modal', () => {
  const r = reduce(STATES.CREDENTIALS_UNAVAILABLE, { type: 'pin-recovery-requested' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'show-pin-modal'));
});

test('CREDENTIALS_UNAVAILABLE + pin-ok -> NEEDS_CREDENTIALS + show overlay firstRun:false', () => {
  const r = reduce(STATES.CREDENTIALS_UNAVAILABLE, { type: 'pin-ok' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.NEEDS_CREDENTIALS);
  assert.ok(hasSideEffect(r.sideEffects, 'hide-pin-modal'));
  assert.ok(hasSideEffect(r.sideEffects, 'show-credentials-overlay', { firstRun: false }));
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'pin-ok' }));
});

test('CREDENTIALS_UNAVAILABLE + pin-bad -> stays + log pin-bad', () => {
  const r = reduce(STATES.CREDENTIALS_UNAVAILABLE, { type: 'pin-bad' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'pin-bad' }));
});

test('CREDENTIALS_UNAVAILABLE + unknown -> stays', () => {
  const r = reduce(STATES.CREDENTIALS_UNAVAILABLE, { type: 'cash-register-ready' }, CTX_NOCREDS);
  assert.strictEqual(r.next, STATES.CREDENTIALS_UNAVAILABLE);
});

// -----------------------------------------------------------------------------
// CASH_REGISTER_READY is a terminal state
// -----------------------------------------------------------------------------

test('CASH_REGISTER_READY + any event -> stays (terminal state)', () => {
  for (const evtType of ['login-detected', 'login-failed', 'timer-expired', 'pin-ok', 'credentials-submitted']) {
    const r = reduce(STATES.CASH_REGISTER_READY, { type: evtType }, CTX_CREDS);
    assert.strictEqual(r.next, STATES.CASH_REGISTER_READY, 'stays on ' + evtType);
  }
});

// -----------------------------------------------------------------------------
// Full happy-path walk-through
// -----------------------------------------------------------------------------

test('happy path: cached creds → login → submit → cash register ready', () => {
  let state = STATES.BOOTING;
  // 1. boot with creds
  let r = reduce(state, { type: 'creds-loaded' }, CTX_CREDS);
  state = r.next;
  assert.strictEqual(state, STATES.BOOTING);
  // 2. Magicline shows login
  r = reduce(state, { type: 'login-detected' }, CTX_CREDS);
  state = r.next;
  assert.strictEqual(state, STATES.LOGIN_DETECTED);
  assert.ok(hasSideEffect(r.sideEffects, 'fill-and-submit'));
  // 3. inject reports submit fired
  r = reduce(state, { type: 'login-submitted' }, CTX_CREDS);
  state = r.next;
  assert.strictEqual(state, STATES.LOGIN_SUBMITTED);
  // 4. cash register appears
  r = reduce(state, { type: 'cash-register-ready' }, CTX_CREDS);
  state = r.next;
  assert.strictEqual(state, STATES.CASH_REGISTER_READY);
});

// -----------------------------------------------------------------------------
// Full failure-path walk-through (D-21 Option A)
// -----------------------------------------------------------------------------

test('failure path (D-21): cached creds → login → wrong password → CREDENTIALS_UNAVAILABLE → PIN → re-entry', () => {
  let state = STATES.BOOTING;
  let r = reduce(state, { type: 'creds-loaded' }, CTX_CREDS);
  state = r.next;
  r = reduce(state, { type: 'login-detected' }, CTX_CREDS);
  state = r.next;
  r = reduce(state, { type: 'login-submitted' }, CTX_CREDS);
  state = r.next;
  assert.strictEqual(state, STATES.LOGIN_SUBMITTED);
  // Magicline error banner matched by inject.js text-match
  r = reduce(state, { type: 'login-failed' }, CTX_CREDS);
  state = r.next;
  assert.strictEqual(state, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'clear-credentials'));
  assert.ok(hasSideEffect(r.sideEffects, 'show-error', { variant: 'credentials-unavailable' }));
  // Admin taps "PIN eingeben"
  r = reduce(state, { type: 'pin-recovery-requested' }, CTX_NOCREDS);
  state = r.next;
  assert.strictEqual(state, STATES.CREDENTIALS_UNAVAILABLE);
  assert.ok(hasSideEffect(r.sideEffects, 'show-pin-modal'));
  // Admin enters correct PIN
  r = reduce(state, { type: 'pin-ok' }, CTX_NOCREDS);
  state = r.next;
  assert.strictEqual(state, STATES.NEEDS_CREDENTIALS);
  assert.ok(hasSideEffect(r.sideEffects, 'show-credentials-overlay', { firstRun: false }));
  // Admin re-enters creds
  r = reduce(state, { type: 'credentials-submitted' }, CTX_NOCREDS);
  state = r.next;
  assert.strictEqual(state, STATES.BOOTING);
  assert.ok(hasSideEffect(r.sideEffects, 'rerun-boot'));
});
