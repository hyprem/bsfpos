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
// EXECUTOR — to be appended in Task 2 (module-scoped state, webContents glue,
// credentialsStore / adminPin persistence, IPC handlers). Task 1 is pure
// reducer only.
// -----------------------------------------------------------------------------

exports.reduce = reduce;
exports.STATES = STATES;
exports._POST_SUBMIT_WATCHDOG_MS = POST_SUBMIT_WATCHDOG_MS;
exports._BOOT_WATCHDOG_MS = BOOT_WATCHDOG_MS;
