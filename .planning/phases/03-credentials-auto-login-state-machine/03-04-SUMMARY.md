# Plan 03-04 — auth state machine — SUMMARY (Task 1 partial)

**Status: Task 1 complete. Task 2 deferred to next session.**

Plan 03-04 was split at the Task 1/Task 2 boundary per user direction on
2026-04-09. Task 1 ships the pure reducer + its unit tests. Task 2 (the
executor — module-scoped state, webContents glue, credentialsStore / adminPin
persistence, timer management, IPC handlers) will be appended to
`src/main/authFlow.js` in a later session.

## D-21 compliance

This plan was originally written assuming a 3-retry model (`MAX_ATTEMPTS`,
`RETRY_BACKOFF_MS`, `retryOrFail`, `LOGIN_FAILED` state). The D-21 override in
03-CONTEXT.md (Option A selected after Probe B uncovered Magicline's
reCAPTCHA on first failure) supersedes that model. The override block at the
top of the plan's `<tasks>` section lists every delta. Task 1 honours the
override in full:

- **No retry logic.** No `MAX_ATTEMPTS`, no `RETRY_BACKOFF_MS`, no
  `retryOrFail`. `ctx` is now just `{ hasCreds }` (extra fields silently
  ignored so legacy callers don't break).
- **No `LOGIN_FAILED` state.** The final state set is six:
  `BOOTING / NEEDS_CREDENTIALS / LOGIN_DETECTED / LOGIN_SUBMITTED /
  CASH_REGISTER_READY / CREDENTIALS_UNAVAILABLE`.
- **Any login failure → `CREDENTIALS_UNAVAILABLE`** with the D-21 side-effect
  list: `clear-timer post-submit`, `clear-credentials`, structured `log`,
  `show-error credentials-unavailable`. Emitted identically by both the
  text-match primary signal and the watchdog fallback.
- **New inject event: `login-failed`** handled in `LOGIN_DETECTED` and
  `LOGIN_SUBMITTED`. Plan 03-05 will wire the MutationObserver that emits
  this event when the German error substring appears.
- **`LOGIN_SUBMITTED + login-detected` re-fire is no longer a failure.**
  Probe B confirmed the form stays mounted on failure — a re-fire
  shouldn't happen in practice. If it does, the reducer logs
  `login-redetected-ignored` and stays in `LOGIN_SUBMITTED`.
- **`BOOTING + timer-expired(boot)`** now routes to `CREDENTIALS_UNAVAILABLE`
  with `show-error credentials-unavailable` (was `LOGIN_FAILED`).

Acceptance greps:

- `grep -c "CREDENTIALS_UNAVAILABLE|login-failed|clear-credentials"` = **20**
- `grep -c "LOGIN_FAILED|MAX_ATTEMPTS|RETRY_BACKOFF|retryOrFail"` = **0**

## Exported surface (Task 1)

```js
exports.reduce                    // (state, event, ctx) => { next, sideEffects }
exports.STATES                    // frozen { BOOTING, NEEDS_CREDENTIALS, LOGIN_DETECTED,
                                  //          LOGIN_SUBMITTED, CASH_REGISTER_READY,
                                  //          CREDENTIALS_UNAVAILABLE }
exports._POST_SUBMIT_WATCHDOG_MS  // 8000
exports._BOOT_WATCHDOG_MS         // 12000
```

Task 2 will add (appended to the same file):

```js
exports.start                       // (deps) => void — wires the executor
exports.notify                      // (event) => void — feeds the reducer from main.js
exports.handleCredentialsSubmit     // (payload) => Promise<void> — atomic first-run persist
exports.handlePinAttempt            // (pin) => void — verifies + fires pin-ok/pin-bad
exports.handlePinRecoveryRequested  // () => void — triggered by error overlay button
exports._getCurrentStateForTests    // () => string (test-only accessor)
```

## Side-effect protocol

The reducer emits plain-data side-effect objects. Task 2's executor is the
ONLY place that talks to webContents, credentialsStore, adminPin, or
setTimeout. Complete side-effect vocabulary that Task 2 must handle:

| kind                        | fields                          | handler action |
|-----------------------------|---------------------------------|----------------|
| `log`                       | `reason`                        | `log.info('auth.state: prev -> next reason=' + reason)` (AUTH-04 artifact) |
| `start-timer`               | `name`, `ms`                    | `setTimeout` keyed by name, stored in `timers[name]` |
| `clear-timer`               | `name`                          | `clearTimeout(timers[name])` + `delete timers[name]` |
| `fill-and-submit`           | —                               | `wc.executeJavaScript('window.__bskiosk_fillAndSubmitLogin(u,p)')` with JSON.stringify'd args |
| `show-credentials-overlay`  | `firstRun`                      | IPC `show-credentials-overlay` to host |
| `hide-credentials-overlay`  | —                               | IPC `hide-credentials-overlay` to host |
| `show-pin-modal`            | —                               | IPC `show-pin-modal` to host |
| `hide-pin-modal`            | —                               | IPC `hide-pin-modal` to host |
| `show-error`                | `variant` (`'credentials-unavailable'` | `'drift'`) | IPC `show-magicline-error` to host with variant |
| `clear-credentials`         | —                               | `credentialsStore.clearCredentials(store)` + flip executor's local `hasCreds` to false |
| `rerun-boot`                | —                               | re-enter `BOOTING` — executor recomputes `hasCreds` from the store and fires `creds-loaded` |

## Tests

`node --test test/authFlow.test.js` → **33 / 33 passing**. Coverage:

- STATES invariants (exactly 6 states, frozen, no `LOGIN_FAILED`)
- Purity: reduce does not mutate arguments, returns fresh sideEffects arrays,
  ignores extra ctx fields (forward-compatibility for legacy callers)
- BOOTING transitions: 9 tests (creds-loaded both branches, safestorage-unavailable,
  decrypt-failed, login-detected both branches, cash-register-ready skip-login,
  boot-watchdog-expired, unknown event)
- LOGIN_DETECTED transitions: 4 tests (login-submitted, login-failed text-match,
  timer-expired watchdog, unknown)
- LOGIN_SUBMITTED transitions: 5 tests (cash-register-ready, login-failed,
  timer-expired, login-detected re-fire, unrelated timer)
- NEEDS_CREDENTIALS: 2 tests (credentials-submitted, unknown)
- CREDENTIALS_UNAVAILABLE: 4 tests (pin-recovery-requested, pin-ok, pin-bad, unknown)
- CASH_REGISTER_READY: 1 test asserting terminal behaviour across 5 event types
- Happy-path walkthrough: BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY
- **D-21 failure-path walkthrough:** BOOTING → LOGIN_SUBMITTED → `login-failed`
  → CREDENTIALS_UNAVAILABLE → `pin-recovery-requested` → `pin-ok` →
  NEEDS_CREDENTIALS → `credentials-submitted` → BOOTING, asserting the correct
  side-effects at each step

## Files

- `src/main/authFlow.js` (new, ~235 lines — reducer only; executor appended in Task 2)
- `test/authFlow.test.js` (new, ~320 lines — 33 tests)
- `.planning/phases/03-credentials-auto-login-state-machine/03-04-SUMMARY.md` (this file; Task 2 will extend it)

## Follow-ups

- **Task 2 (next session):** append the executor to `src/main/authFlow.js`,
  add executor tests to `test/authFlow.test.js`. The side-effect protocol
  table above is the contract.
- **Plan 03-05:** inject.js emits the new `login-failed` event from a
  MutationObserver watching for the German error substring defined in D-21.
  Also add `LOGIN_ERROR_SUBSTRING` to `fragile-selectors.js`.
- **Plan 03-06:** credentials overlay gains a "yield to child view for
  reCAPTCHA" affordance for the admin recovery path (D-21 bullet 3).
