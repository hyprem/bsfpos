// src/main/authFlow.js
// -----------------------------------------------------------------------------
// Phase 3 auth state machine — Task 1: pure reducer.
//
// The executor (module-scoped state, webContents glue, credentialsStore /
// adminPin persistence, timer management, IPC handlers) is Task 2 and will be
// appended to this file in a later session. Task 1 ships the pure reducer
// only, unit-testable standalone with no Electron import.
//
// Per D-21 (03-CONTEXT.md) Option A: reCAPTCHA blocks scripted retries, so
// this reducer has NO retry branch and NO dedicated failed-login state. Any
// login failure transitions directly to CREDENTIALS_UNAVAILABLE with effects:
//   { clear-timer 'post-submit', clear-credentials, log, show-error:'credentials-unavailable' }
// Recovery is admin-mediated: CREDENTIALS_UNAVAILABLE + pin-ok ->
// NEEDS_CREDENTIALS (credentials overlay, firstRun=false).
//
// State set (six — dedicated failed-login state removed per D-21):
//   BOOTING -> NEEDS_CREDENTIALS -> LOGIN_DETECTED -> LOGIN_SUBMITTED
//     -> CASH_REGISTER_READY | CREDENTIALS_UNAVAILABLE
//
// Reducer contract:
//   reduce(state, event, ctx) -> { next, sideEffects: [...] }
//   * Pure. No side effects. No mutation of arguments.
//   * ctx shape: { hasCreds: boolean }. Extra fields are ignored (per D-21,
//     the old { attempts, maxAttempts } retry bookkeeping is gone).
//   * sideEffects is always a new array; side-effect objects are plain data.
//
// Failure detection uses a text-match primary signal emitted by inject.js
// as `login-failed`, with the post-submit watchdog (POST_SUBMIT_WATCHDOG_MS)
// as a fallback. Both events route to CREDENTIALS_UNAVAILABLE identically.
// -----------------------------------------------------------------------------

const STATES = Object.freeze({
  BOOTING:                 'BOOTING',
  NEEDS_CREDENTIALS:       'NEEDS_CREDENTIALS',
  LOGIN_DETECTED:          'LOGIN_DETECTED',
  LOGIN_SUBMITTED:         'LOGIN_SUBMITTED',
  CASH_REGISTER_READY:     'CASH_REGISTER_READY',
  CREDENTIALS_UNAVAILABLE: 'CREDENTIALS_UNAVAILABLE',
});

const POST_SUBMIT_WATCHDOG_MS = 8000;
const BOOT_WATCHDOG_MS        = 12000;

// -----------------------------------------------------------------------------
// Side-effect builders
// -----------------------------------------------------------------------------

// D-21: every login failure emits the same side-effect list. Callers pass the
// reason string so the log line distinguishes text-match vs watchdog.
function loginFailureSideEffects(reason) {
  return [
    { kind: 'log', reason: reason },
    { kind: 'clear-timer', name: 'post-submit' },
    { kind: 'clear-credentials' },
    { kind: 'show-error', variant: 'credentials-unavailable' },
  ];
}

// -----------------------------------------------------------------------------
// PURE REDUCER
// -----------------------------------------------------------------------------

function reduce(state, event, ctx) {
  const c = ctx || {};
  switch (state) {
    case STATES.BOOTING: {
      if (event.type === 'creds-loaded') {
        if (c.hasCreds) {
          return {
            next: STATES.BOOTING,
            sideEffects: [
              { kind: 'log', reason: 'creds-loaded' },
              { kind: 'start-timer', name: 'boot', ms: BOOT_WATCHDOG_MS },
            ],
          };
        }
        return {
          next: STATES.NEEDS_CREDENTIALS,
          sideEffects: [
            { kind: 'log', reason: 'first-run' },
            { kind: 'show-credentials-overlay', firstRun: true },
          ],
        };
      }
      if (event.type === 'safestorage-unavailable') {
        return {
          next: STATES.CREDENTIALS_UNAVAILABLE,
          sideEffects: [
            { kind: 'log', reason: 'safestorage-unavailable' },
            { kind: 'show-error', variant: 'credentials-unavailable' },
          ],
        };
      }
      if (event.type === 'decrypt-failed') {
        return {
          next: STATES.CREDENTIALS_UNAVAILABLE,
          sideEffects: [
            { kind: 'log', reason: 'decrypt-failed' },
            { kind: 'show-error', variant: 'credentials-unavailable' },
          ],
        };
      }
      if (event.type === 'login-detected' && c.hasCreds) {
        return {
          next: STATES.LOGIN_DETECTED,
          sideEffects: [
            { kind: 'log', reason: 'login-detected' },
            { kind: 'clear-timer', name: 'boot' },
            { kind: 'fill-and-submit' },
            { kind: 'start-timer', name: 'post-submit', ms: POST_SUBMIT_WATCHDOG_MS },
          ],
        };
      }
      if (event.type === 'cash-register-ready') {
        // Pitfall #10 (research): cookie-session skip-login path.
        // Magicline served the cash register directly without a login page.
        return {
          next: STATES.CASH_REGISTER_READY,
          sideEffects: [
            { kind: 'log', reason: 'cash-register-ready-cookie' },
            { kind: 'clear-timer', name: 'boot' },
          ],
        };
      }
      if (event.type === 'timer-expired' && event.name === 'boot') {
        // D-21: boot watchdog expired = Magicline unreachable or stuck.
        // Treat as credentials-unavailable so admin can retry via PIN recovery.
        return {
          next: STATES.CREDENTIALS_UNAVAILABLE,
          sideEffects: [
            { kind: 'log', reason: 'boot-watchdog-expired' },
            { kind: 'show-error', variant: 'credentials-unavailable' },
          ],
        };
      }
      return { next: state, sideEffects: [] };
    }

    case STATES.LOGIN_DETECTED: {
      if (event.type === 'login-submitted') {
        return {
          next: STATES.LOGIN_SUBMITTED,
          sideEffects: [{ kind: 'log', reason: 'submit-fired' }],
        };
      }
      if (event.type === 'login-failed') {
        // D-21: text-match primary failure signal from inject.js.
        return {
          next: STATES.CREDENTIALS_UNAVAILABLE,
          sideEffects: loginFailureSideEffects('login-failed-text-match'),
        };
      }
      if (event.type === 'timer-expired' && event.name === 'post-submit') {
        // D-21: watchdog fallback — inject.js may have missed the error text.
        return {
          next: STATES.CREDENTIALS_UNAVAILABLE,
          sideEffects: loginFailureSideEffects('post-submit-watchdog-expired'),
        };
      }
      return { next: state, sideEffects: [] };
    }

    case STATES.LOGIN_SUBMITTED: {
      if (event.type === 'cash-register-ready') {
        return {
          next: STATES.CASH_REGISTER_READY,
          sideEffects: [
            { kind: 'log', reason: 'cash-register-ready' },
            { kind: 'clear-timer', name: 'post-submit' },
          ],
        };
      }
      if (event.type === 'login-failed') {
        return {
          next: STATES.CREDENTIALS_UNAVAILABLE,
          sideEffects: loginFailureSideEffects('login-failed-text-match'),
        };
      }
      if (event.type === 'timer-expired' && event.name === 'post-submit') {
        return {
          next: STATES.CREDENTIALS_UNAVAILABLE,
          sideEffects: loginFailureSideEffects('post-submit-watchdog-expired'),
        };
      }
      if (event.type === 'login-detected') {
        // Probe B (plan 03-01) verified the form stays mounted on failure,
        // so a re-fire shouldn't happen in practice. If it does, log and stay
        // — per D-21 this is NOT treated as a failure signal.
        return {
          next: state,
          sideEffects: [{ kind: 'log', reason: 'login-redetected-ignored' }],
        };
      }
      return { next: state, sideEffects: [] };
    }

    case STATES.NEEDS_CREDENTIALS: {
      if (event.type === 'credentials-submitted') {
        return {
          next: STATES.BOOTING,
          sideEffects: [
            { kind: 'log', reason: 'creds-saved' },
            { kind: 'hide-credentials-overlay' },
            { kind: 'rerun-boot' },
          ],
        };
      }
      return { next: state, sideEffects: [] };
    }

    case STATES.CREDENTIALS_UNAVAILABLE: {
      if (event.type === 'pin-recovery-requested') {
        return {
          next: state,
          sideEffects: [{ kind: 'show-pin-modal' }],
        };
      }
      if (event.type === 'pin-ok') {
        return {
          next: STATES.NEEDS_CREDENTIALS,
          sideEffects: [
            { kind: 'log', reason: 'pin-ok' },
            { kind: 'hide-pin-modal' },
            { kind: 'show-credentials-overlay', firstRun: false },
          ],
        };
      }
      if (event.type === 'pin-bad') {
        return {
          next: state,
          sideEffects: [{ kind: 'log', reason: 'pin-bad' }],
        };
      }
      return { next: state, sideEffects: [] };
    }

    case STATES.CASH_REGISTER_READY:
    default:
      return { next: state, sideEffects: [] };
  }
}

// -----------------------------------------------------------------------------
// EXECUTOR (Plan 03-10) — module-scoped state, webContents glue,
// credentialsStore / adminPin persistence, timer management, IPC handlers.
// The reducer above is pure; the executor is the impure shell that drives it.
// -----------------------------------------------------------------------------

const credentialsStore = require('./credentialsStore');
const adminPin = require('./adminPin');

let currentState = STATES.BOOTING;
let deps = null; // { webContents, store, safeStorage, mainWindow, log }
const timers = Object.create(null);
let hasCreds = false;

function _sendToOverlay(channel, payload) {
  try {
    if (deps && deps.mainWindow && deps.mainWindow.webContents
        && typeof deps.mainWindow.webContents.send === 'function') {
      if (payload === undefined) {
        deps.mainWindow.webContents.send(channel);
      } else {
        deps.mainWindow.webContents.send(channel, payload);
      }
    }
  } catch (e) {
    if (deps && deps.log) deps.log.warn('authFlow.send(' + channel + ') failed: ' + (e && e.message));
  }
}

function _runSideEffect(effect) {
  try {
    switch (effect.kind) {
      case 'log':
        deps.log.info('auth.state: ' + currentState + ' reason=' + effect.reason);
        return;
      case 'start-timer': {
        // Defensive: clear any existing timer with the same name first.
        if (timers[effect.name]) {
          clearTimeout(timers[effect.name]);
          delete timers[effect.name];
        }
        const name = effect.name;
        timers[name] = setTimeout(() => {
          delete timers[name];
          notify({ type: 'timer-expired', name: name });
        }, effect.ms);
        return;
      }
      case 'clear-timer':
        if (timers[effect.name]) {
          clearTimeout(timers[effect.name]);
          delete timers[effect.name];
        }
        return;
      case 'fill-and-submit': {
        const creds = credentialsStore.loadCredentials(deps.store, deps.safeStorage);
        if (!creds || creds === credentialsStore.DECRYPT_FAILED) {
          notify({ type: 'decrypt-failed' });
          return;
        }
        // CRITICAL: JSON.stringify BOTH user and pass — never raw concat.
        // This escapes quotes, backslashes, control chars, and unicode safely.
        const js = 'window.__bskiosk_fillAndSubmitLogin('
          + JSON.stringify(creds.user) + ','
          + JSON.stringify(creds.pass) + ')';
        try {
          const p = deps.webContents.executeJavaScript(js);
          if (p && typeof p.catch === 'function') {
            p.catch((e) => deps.log.warn('fill-and-submit failed: ' + (e && e.message)));
          }
        } catch (e) {
          deps.log.warn('fill-and-submit threw: ' + (e && e.message));
        }
        return;
      }
      case 'show-credentials-overlay':
        _sendToOverlay('show-credentials-overlay', { firstRun: !!effect.firstRun });
        return;
      case 'hide-credentials-overlay':
        _sendToOverlay('hide-credentials-overlay');
        return;
      case 'show-pin-modal':
        _sendToOverlay('show-pin-modal');
        return;
      case 'hide-pin-modal':
        _sendToOverlay('hide-pin-modal');
        return;
      case 'show-error':
        _sendToOverlay('show-magicline-error', { variant: effect.variant });
        return;
      case 'clear-credentials':
        credentialsStore.clearCredentials(deps.store);
        hasCreds = false;
        return;
      case 'rerun-boot': {
        const loaded = credentialsStore.loadCredentials(deps.store, deps.safeStorage);
        hasCreds = !!(loaded && loaded !== credentialsStore.DECRYPT_FAILED);
        notify({ type: 'creds-loaded' });
        // Proactively re-poke detectLogin in the page. Magicline's login form
        // may already be rendered (eager child-view load during Phase 2), in
        // which case the MutationObserver won't fire again and login-detected
        // won't re-trigger on its own. Calling detectLogin directly forces a
        // fresh DOM check. Safe because detectLogin is idempotent and dedups.
        try {
          deps.webContents.executeJavaScript(
            'try { window.__bskiosk_detectLogin && window.__bskiosk_detectLogin(); } catch(e) {}',
            true
          ).catch((e) => deps.log.warn('rerun-boot detectLogin poke failed: ' + (e && e.message)));
        } catch (e) {
          deps.log.warn('rerun-boot detectLogin poke threw: ' + (e && e.message));
        }
        return;
      }
      default:
        deps.log.warn('auth.unknown-side-effect kind=' + effect.kind);
        return;
    }
  } catch (e) {
    if (deps && deps.log) {
      deps.log.error('auth.side-effect-handler-threw kind=' + effect.kind + ' err=' + (e && e.message));
    }
  }
}

function notify(event) {
  if (!deps) {
    // Pre-start notify is a no-op (defensive).
    return;
  }
  const ctx = { hasCreds: hasCreds };
  const result = reduce(currentState, event, ctx);
  if (result.next !== currentState) {
    deps.log.info('auth.state: ' + currentState + ' -> ' + result.next + ' reason=' + (event.type || 'unknown'));
  }
  currentState = result.next;
  for (const sx of result.sideEffects) {
    _runSideEffect(sx);
  }
}

function start(opts) {
  if (!opts || !opts.webContents || !opts.store || !opts.safeStorage
      || !opts.mainWindow || !opts.log) {
    throw new Error('authFlow.start: missing required dep (webContents, store, safeStorage, mainWindow, log)');
  }
  deps = {
    webContents: opts.webContents,
    store:       opts.store,
    safeStorage: opts.safeStorage,
    mainWindow:  opts.mainWindow,
    log:         opts.log,
  };
  currentState = STATES.BOOTING;

  if (!credentialsStore.isStoreAvailable(deps.safeStorage)) {
    notify({ type: 'safestorage-unavailable' });
    return;
  }
  const loaded = credentialsStore.loadCredentials(deps.store, deps.safeStorage);
  if (loaded === credentialsStore.DECRYPT_FAILED) {
    notify({ type: 'decrypt-failed' });
    return;
  }
  hasCreds = loaded !== null;
  notify({ type: 'creds-loaded' });
}

async function handleCredentialsSubmit(input) {
  try {
    if (!deps) throw new Error('authFlow.handleCredentialsSubmit: not started');
    const user = input && input.user;
    const pass = input && input.pass;
    const pin  = input && input.pin;
    const record = adminPin.buildRecord(pin);            // pure
    const ciphertext = credentialsStore.buildCiphertext( // pure
      deps.safeStorage,
      { user: user, pass: pass }
    );
    // D-11 atomic single set — both keys in one store.set call.
    deps.store.set({
      adminPin: record,
      credentialsCiphertext: ciphertext,
    });
    deps.log.info('auth.credentials-submitted: persisted (atomic)');
    notify({ type: 'credentials-submitted' });
    return { ok: true };
  } catch (e) {
    if (deps && deps.log) deps.log.error('handleCredentialsSubmit failed: ' + (e && e.message));
    if (e && e.code === 'safestorage-unavailable') {
      notify({ type: 'safestorage-unavailable' });
    }
    return { ok: false, error: e && e.message };
  }
}

function handlePinAttempt(pin) {
  try {
    if (!deps) throw new Error('authFlow.handlePinAttempt: not started');
    if (adminPin.verifyPin(deps.store, pin)) {
      notify({ type: 'pin-ok' });
      return { ok: true };
    }
    notify({ type: 'pin-bad' });
    return { ok: false };
  } catch (e) {
    if (deps && deps.log) deps.log.error('handlePinAttempt failed: ' + (e && e.message));
    return { ok: false, error: e && e.message };
  }
}

function handlePinRecoveryRequested() {
  notify({ type: 'pin-recovery-requested' });
}

exports.reduce = reduce;
exports.STATES = STATES;
exports._POST_SUBMIT_WATCHDOG_MS = POST_SUBMIT_WATCHDOG_MS;
exports._BOOT_WATCHDOG_MS = BOOT_WATCHDOG_MS;
exports.start = start;
exports.notify = notify;
exports.handleCredentialsSubmit = handleCredentialsSubmit;
exports.handlePinAttempt = handlePinAttempt;
exports.handlePinRecoveryRequested = handlePinRecoveryRequested;
exports._runSideEffect = _runSideEffect;
exports._getCurrentStateForTests = () => currentState;
exports._resetForTests = () => {
  currentState = STATES.BOOTING;
  deps = null;
  hasCreds = false;
  for (const k of Object.keys(timers)) {
    clearTimeout(timers[k]);
    delete timers[k];
  }
};
