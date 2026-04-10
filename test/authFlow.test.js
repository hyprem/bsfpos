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

test('BOOTING + cash-register-ready emits {kind:"start-idle-timer"} side-effect (Phase 4 D-08)', () => {
  const r = reduce(STATES.BOOTING, { type: 'cash-register-ready' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CASH_REGISTER_READY);
  // Phase 4 D-08: idle timer must arm when cash register becomes ready
  assert.ok(hasSideEffect(r.sideEffects, 'start-idle-timer'),
    'expected start-idle-timer side-effect on BOOTING→CASH_REGISTER_READY');
  // Regression guard: existing side effects must still be present
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'cash-register-ready-cookie' }),
    'existing log side-effect regressed');
  assert.ok(hasSideEffect(r.sideEffects, 'clear-timer', { name: 'boot' }),
    'existing clear-timer boot side-effect regressed');
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

test('LOGIN_SUBMITTED + cash-register-ready emits {kind:"start-idle-timer"} side-effect (Phase 4 D-08)', () => {
  const r = reduce(STATES.LOGIN_SUBMITTED, { type: 'cash-register-ready' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.CASH_REGISTER_READY);
  // Phase 4 D-08: idle timer must arm on the post-login path too
  assert.ok(hasSideEffect(r.sideEffects, 'start-idle-timer'),
    'expected start-idle-timer side-effect on LOGIN_SUBMITTED→CASH_REGISTER_READY');
  // Regression guard: existing side effects must still be present
  assert.ok(hasSideEffect(r.sideEffects, 'log', { reason: 'cash-register-ready' }),
    'existing log side-effect regressed');
  assert.ok(hasSideEffect(r.sideEffects, 'clear-timer', { name: 'post-submit' }),
    'existing clear-timer post-submit side-effect regressed');
});

test('non-cash-register-ready events do NOT emit start-idle-timer (Phase 4 D-08)', () => {
  // login-detected from BOOTING
  const r1 = reduce(STATES.BOOTING, { type: 'login-detected' }, CTX_CREDS);
  assert.strictEqual(hasSideEffect(r1.sideEffects, 'start-idle-timer'), false);
  // timer-expired boot from BOOTING
  const r2 = reduce(STATES.BOOTING, { type: 'timer-expired', name: 'boot' }, CTX_CREDS);
  assert.strictEqual(hasSideEffect(r2.sideEffects, 'start-idle-timer'), false);
  // login-submitted from LOGIN_DETECTED
  const r3 = reduce(STATES.LOGIN_DETECTED, { type: 'login-submitted' }, CTX_CREDS);
  assert.strictEqual(hasSideEffect(r3.sideEffects, 'start-idle-timer'), false);
  // login-failed from LOGIN_SUBMITTED
  const r4 = reduce(STATES.LOGIN_SUBMITTED, { type: 'login-failed' }, CTX_CREDS);
  assert.strictEqual(hasSideEffect(r4.sideEffects, 'start-idle-timer'), false);
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

// -----------------------------------------------------------------------------
// EXECUTOR-LAYER TESTS (Plan 03-10) — module-scoped state, side-effect dispatch,
// store/safeStorage glue. Use fake deps with spies; no electron import.
// -----------------------------------------------------------------------------

const authFlow = require('../src/main/authFlow');
const credentialsStore = require('../src/main/credentialsStore');
const adminPin = require('../src/main/adminPin');

// --- Fakes ---------------------------------------------------------------

function makeFakeStore(initial) {
  const data = Object.assign({}, initial || {});
  const calls = { set: [], get: [], delete: [], has: [] };
  const store = {
    get(k) { calls.get.push(k); return data[k]; },
    set(a, b) {
      calls.set.push(b === undefined ? a : { [a]: b });
      if (typeof a === 'object' && a !== null) {
        for (const k of Object.keys(a)) data[k] = a[k];
      } else {
        data[a] = b;
      }
    },
    delete(k) { calls.delete.push(k); delete data[k]; },
    has(k) { calls.has.push(k); return Object.prototype.hasOwnProperty.call(data, k); },
    _data: data,
    _calls: calls,
  };
  return store;
}

function makeFakeSafeStorage(opts) {
  const o = opts || {};
  return {
    isEncryptionAvailable: () => o.available !== false,
    encryptString: (s) => {
      if (o.encryptThrows) throw new Error('encryptString fake throw');
      // Pseudo-encrypt: just wrap with a marker so we can round-trip in tests.
      return Buffer.from('FAKE:' + s, 'utf8');
    },
    decryptString: (buf) => {
      if (o.decryptThrows) throw new Error('decryptString fake throw');
      const s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
      if (s.startsWith('FAKE:')) return s.slice(5);
      return s;
    },
  };
}

function makeFakeWebContents() {
  const calls = [];
  return {
    _calls: calls,
    executeJavaScript: (js) => { calls.push(js); return Promise.resolve(); },
  };
}

function makeFakeMainWindow() {
  const sent = [];
  return {
    _sent: sent,
    webContents: {
      send: (channel, payload) => { sent.push({ channel: channel, payload: payload }); },
    },
  };
}

function makeFakeLog() {
  const lines = { info: [], warn: [], error: [] };
  return {
    _lines: lines,
    info:  (m) => lines.info.push(m),
    warn:  (m) => lines.warn.push(m),
    error: (m) => lines.error.push(m),
  };
}

function makeDeps(overrides) {
  const o = overrides || {};
  return {
    webContents: o.webContents || makeFakeWebContents(),
    store:       o.store       || makeFakeStore(),
    safeStorage: o.safeStorage || makeFakeSafeStorage(),
    mainWindow:  o.mainWindow  || makeFakeMainWindow(),
    log:         o.log         || makeFakeLog(),
  };
}

function seedCredentials(store, safeStorage, creds) {
  const cipher = credentialsStore.buildCiphertext(safeStorage, creds);
  store.set('credentialsCiphertext', cipher);
}

// --- Tests ---------------------------------------------------------------

test('executor: start() happy path with cached creds → BOOTING + arms boot watchdog', () => {
  authFlow._resetForTests();
  const deps = makeDeps();
  seedCredentials(deps.store, deps.safeStorage, { user: 'u', pass: 'p' });
  authFlow.start(deps);
  // After creds-loaded with hasCreds=true, reducer stays in BOOTING.
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.BOOTING);
  // Audit-trail log line for the side-effect 'log' was emitted.
  const hasAuthState = deps.log._lines.info.some((l) => /^auth\.state:/.test(l));
  assert.ok(hasAuthState, 'expected auth.state log line');
  authFlow._resetForTests();
});

test('executor: start() with safestorage unavailable → CREDENTIALS_UNAVAILABLE + show-error', () => {
  authFlow._resetForTests();
  const deps = makeDeps({ safeStorage: makeFakeSafeStorage({ available: false }) });
  authFlow.start(deps);
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.CREDENTIALS_UNAVAILABLE);
  const errSent = deps.mainWindow._sent.find((m) => m.channel === 'show-magicline-error');
  assert.ok(errSent, 'expected show-magicline-error IPC');
  assert.strictEqual(errSent.payload.variant, 'credentials-unavailable');
  authFlow._resetForTests();
});

test('executor: start() with decrypt failure → CREDENTIALS_UNAVAILABLE', () => {
  authFlow._resetForTests();
  const safeStorage = makeFakeSafeStorage();
  const store = makeFakeStore();
  // Seed with a real ciphertext, then swap safeStorage to one that throws on decrypt.
  seedCredentials(store, safeStorage, { user: 'u', pass: 'p' });
  const brokenSafe = makeFakeSafeStorage({ decryptThrows: true });
  const deps = makeDeps({ store: store, safeStorage: brokenSafe });
  authFlow.start(deps);
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.CREDENTIALS_UNAVAILABLE);
  authFlow._resetForTests();
});

test('executor: handleCredentialsSubmit performs ATOMIC single store.set with both keys (D-11)', async () => {
  authFlow._resetForTests();
  const deps = makeDeps();
  // Drive into NEEDS_CREDENTIALS first so credentials-submitted is meaningful.
  authFlow.start(deps);
  // No creds yet → reducer should be NEEDS_CREDENTIALS.
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.NEEDS_CREDENTIALS);
  // Reset call log to isolate the submit.
  deps.store._calls.set.length = 0;
  const result = await authFlow.handleCredentialsSubmit({ user: 'u', pass: 'p', pin: '1234' });
  assert.strictEqual(result.ok, true);
  // CRITICAL: exactly ONE store.set call composing both keys.
  // (rerun-boot side-effect calls store.has/get but NOT store.set, so we
  // count only the submit-driven set.)
  const setsWithBoth = deps.store._calls.set.filter((arg) =>
    arg && typeof arg === 'object'
    && Object.prototype.hasOwnProperty.call(arg, 'adminPin')
    && Object.prototype.hasOwnProperty.call(arg, 'credentialsCiphertext')
  );
  assert.strictEqual(setsWithBoth.length, 1, 'exactly one atomic set with both keys');
  // And no separate single-key sets for adminPin / credentialsCiphertext.
  const splitSets = deps.store._calls.set.filter((arg) =>
    arg && typeof arg === 'object'
    && Object.keys(arg).length === 1
    && (Object.prototype.hasOwnProperty.call(arg, 'adminPin')
        || Object.prototype.hasOwnProperty.call(arg, 'credentialsCiphertext'))
  );
  assert.strictEqual(splitSets.length, 0, 'no split single-key sets allowed');
  authFlow._resetForTests();
});

test('executor: handleCredentialsSubmit with safestorage unavailable returns ok:false and notifies', async () => {
  authFlow._resetForTests();
  const deps = makeDeps({ safeStorage: makeFakeSafeStorage({ available: false }) });
  // start() would immediately fire safestorage-unavailable, so just call submit
  // directly after a manual start to exercise the catch path. We assign deps and
  // current state via start; since safestorage is unavailable, state is already
  // CREDENTIALS_UNAVAILABLE.
  authFlow.start(deps);
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.CREDENTIALS_UNAVAILABLE);
  const result = await authFlow.handleCredentialsSubmit({ user: 'u', pass: 'p', pin: '1234' });
  assert.strictEqual(result.ok, false);
  authFlow._resetForTests();
});

test('executor: handlePinAttempt pin-ok routes from CREDENTIALS_UNAVAILABLE → NEEDS_CREDENTIALS', () => {
  authFlow._resetForTests();
  const store = makeFakeStore();
  // Seed a real PIN record.
  store.set('adminPin', adminPin.buildRecord('1234'));
  const deps = makeDeps({
    store: store,
    safeStorage: makeFakeSafeStorage({ available: false }), // forces CREDENTIALS_UNAVAILABLE
  });
  authFlow.start(deps);
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.CREDENTIALS_UNAVAILABLE);
  const result = authFlow.handlePinAttempt('1234');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.NEEDS_CREDENTIALS);
  authFlow._resetForTests();
});

test('executor: handlePinAttempt pin-bad keeps state in CREDENTIALS_UNAVAILABLE', () => {
  authFlow._resetForTests();
  const store = makeFakeStore();
  store.set('adminPin', adminPin.buildRecord('1234'));
  const deps = makeDeps({
    store: store,
    safeStorage: makeFakeSafeStorage({ available: false }),
  });
  authFlow.start(deps);
  const result = authFlow.handlePinAttempt('9999');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.CREDENTIALS_UNAVAILABLE);
  authFlow._resetForTests();
});

test('executor: handlePinRecoveryRequested fires show-pin-modal IPC from CREDENTIALS_UNAVAILABLE', () => {
  authFlow._resetForTests();
  const deps = makeDeps({ safeStorage: makeFakeSafeStorage({ available: false }) });
  authFlow.start(deps);
  // Clear send log to isolate.
  deps.mainWindow._sent.length = 0;
  authFlow.handlePinRecoveryRequested();
  const sent = deps.mainWindow._sent.find((m) => m.channel === 'show-pin-modal');
  assert.ok(sent, 'expected show-pin-modal IPC');
  authFlow._resetForTests();
});

test('executor: fill-and-submit JSON.stringify-escapes credentials with quotes/backslashes', () => {
  authFlow._resetForTests();
  const deps = makeDeps();
  const trickyUser = 'a"b\\c';
  const trickyPass = 'p"\\\nq';
  seedCredentials(deps.store, deps.safeStorage, { user: trickyUser, pass: trickyPass });
  authFlow.start(deps);
  // Drive BOOTING → LOGIN_DETECTED so fill-and-submit fires.
  authFlow.notify({ type: 'login-detected' });
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.LOGIN_DETECTED);
  assert.strictEqual(deps.webContents._calls.length, 1, 'executeJavaScript called once');
  const js = deps.webContents._calls[0];
  // Must call the global function with two JSON-stringified args.
  assert.ok(js.indexOf('window.__bskiosk_fillAndSubmitLogin(') === 0, 'starts with global call');
  // Extract the two args via a regex on the JSON.stringified forms.
  const expectedUserArg = JSON.stringify(trickyUser);
  const expectedPassArg = JSON.stringify(trickyPass);
  assert.ok(js.indexOf(expectedUserArg) !== -1, 'contains JSON-escaped user');
  assert.ok(js.indexOf(expectedPassArg) !== -1, 'contains JSON-escaped pass');
  // And the raw unescaped pass (with literal newline) MUST NOT appear in the JS.
  assert.ok(js.indexOf(trickyPass) === -1, 'raw unescaped pass must not appear');
  authFlow._resetForTests();
});

test('executor: rerun-boot re-reads credentials from store after credentials-submitted', async () => {
  authFlow._resetForTests();
  const deps = makeDeps();
  // First boot: no creds → NEEDS_CREDENTIALS.
  authFlow.start(deps);
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.NEEDS_CREDENTIALS);
  // Submit creds → reducer fires credentials-submitted → BOOTING + rerun-boot.
  // rerun-boot re-reads loadCredentials and calls notify({type:'creds-loaded'}),
  // which (with hasCreds=true now) leaves state in BOOTING.
  await authFlow.handleCredentialsSubmit({ user: 'u', pass: 'p', pin: '1234' });
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.BOOTING);
  // hasCreds must now be true — confirm by exercising login-detected which
  // requires hasCreds to advance to LOGIN_DETECTED.
  authFlow.notify({ type: 'login-detected' });
  assert.strictEqual(authFlow._getCurrentStateForTests(), STATES.LOGIN_DETECTED);
  authFlow._resetForTests();
});

test('executor: reducer regression guard — direct reduce() call still works (Task 1 not broken)', () => {
  const r = reduce(STATES.BOOTING, { type: 'creds-loaded' }, CTX_CREDS);
  assert.strictEqual(r.next, STATES.BOOTING);
  assert.ok(hasSideEffect(r.sideEffects, 'start-timer', { name: 'boot' }));
});

// -----------------------------------------------------------------------------
// Original failure-path walk-through (kept verbatim from Plan 03-04 Task 1)
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
