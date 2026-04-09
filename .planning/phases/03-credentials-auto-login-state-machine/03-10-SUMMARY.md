---
phase: 03-credentials-auto-login-state-machine
plan: 10
subsystem: auth
tags: [auth, state-machine, executor, recovery, gap-closure]
requires:
  - src/main/authFlow.js (reducer from 03-04 Task 1)
  - src/main/credentialsStore.js (buildCiphertext, loadCredentials, clearCredentials)
  - src/main/adminPin.js (buildRecord, verifyPin)
  - src/main/logger.js
provides:
  - authFlow.start(deps)
  - authFlow.notify(event)
  - authFlow.handleCredentialsSubmit({user, pass, pin})
  - authFlow.handlePinAttempt(pin)
  - authFlow.handlePinRecoveryRequested()
  - authFlow._getCurrentStateForTests / _resetForTests / _runSideEffect (test hooks)
affects:
  - Plan 03-07 IPC handlers (now resolve to live executor functions)
  - Plan 03-08 integration tests (become runnable)
tech-stack:
  added: []
  patterns:
    - "Pure reducer + impure executor split (reducer untouched from 03-04)"
    - "Module-scoped deps + timers map; injection via start(opts)"
    - "D-11 atomic persist: single store.set({adminPin, credentialsCiphertext})"
    - "Pure builders (adminPin.buildRecord + credentialsStore.buildCiphertext) composed at the executor layer"
    - "JSON.stringify of every credential value before injection into executeJavaScript — never raw concat"
key-files:
  created: []
  modified:
    - src/main/authFlow.js
    - test/authFlow.test.js
decisions:
  - "Executor uses an internal _sendToOverlay helper that swallows IPC errors so a missing renderer never blocks the state machine — logged via deps.log.warn"
  - "Side-effect handlers are wrapped in try/catch individually so a single failing handler does not abort the rest of the side-effect list (matches plan instruction 'never let one failing handler block the rest')"
  - "start() resets currentState to BOOTING explicitly so a re-start (after _resetForTests or a future hot-reload) cannot inherit stale state"
  - "start-timer defensively clears any existing timer with the same name before re-arming, eliminating a potential leak if the reducer ever emits two start-timer effects for the same name without an intervening clear-timer"
  - "Pre-start notify() is a no-op (defensive) — protects against IPC handlers firing before main.js calls authFlow.start()"
metrics:
  duration: ~25min
  completed: 2026-04-09
---

# Phase 3 Plan 10: authFlow Executor Recovery Summary

Recovered the deferred Plan 03-04 Task 2 executor layer — appended start/notify/handleCredentialsSubmit/handlePinAttempt/handlePinRecoveryRequested + 11 executor tests to the existing reducer-only authFlow.js, unblocking 03-07's live IPC handlers and 03-08's integration tests.

## What Shipped

**Task 1 — `src/main/authFlow.js` executor append (commit `bf9f21e`)**
- Added module-scoped state: `currentState`, `deps`, `timers` map, `hasCreds`.
- Added executor functions:
  - `start(opts)` — validates deps, computes initial `hasCreds` via `credentialsStore.loadCredentials`, fires `safestorage-unavailable` / `decrypt-failed` / `creds-loaded` as appropriate.
  - `notify(event)` — feeds reducer, emits `auth.state: prev -> next reason=X` audit log on transition (AUTH-04), drains side effects in order, isolates handler errors.
  - `_runSideEffect(effect)` — full dispatch table for all 11 effect kinds in the 03-04-SUMMARY contract (`log`, `start-timer`, `clear-timer`, `fill-and-submit`, `show-credentials-overlay`, `hide-credentials-overlay`, `show-pin-modal`, `hide-pin-modal`, `show-error`, `clear-credentials`, `rerun-boot`).
  - `handleCredentialsSubmit({user, pass, pin})` — composes `adminPin.buildRecord(pin)` + `credentialsStore.buildCiphertext(safeStorage, {user, pass})` and persists via a **single atomic** `store.set({adminPin, credentialsCiphertext})` call (D-11). Fires `credentials-submitted` on success, `safestorage-unavailable` on `EncryptionUnavailableError`.
  - `handlePinAttempt(pin)` — `adminPin.verifyPin` → `pin-ok`/`pin-bad` notify, never throws.
  - `handlePinRecoveryRequested()` — fires `pin-recovery-requested`.
  - Test hooks: `_getCurrentStateForTests`, `_resetForTests`, `_runSideEffect`.
- `fill-and-submit` builds JS via `'window.__bskiosk_fillAndSubmitLogin(' + JSON.stringify(creds.user) + ',' + JSON.stringify(creds.pass) + ')'` — JSON.stringify on EVERY value, no raw concat, escaping verified by test.
- The Task 1 reducer block above the executor is byte-for-byte unchanged (verified by all 33 original tests still passing).

**Task 2 — `test/authFlow.test.js` executor coverage (commit `feee723`)**
Appended 11 executor tests using fake `store` / `safeStorage` / `webContents` / `mainWindow` / `log`:
1. start() happy path with cached creds → BOOTING + audit log emitted
2. start() with `safeStorage.isEncryptionAvailable=false` → CREDENTIALS_UNAVAILABLE + `show-magicline-error` IPC
3. start() with `decryptString` throw → CREDENTIALS_UNAVAILABLE
4. **handleCredentialsSubmit D-11 atomic-persist assertion** — spies on `store.set`, asserts exactly one call with both `adminPin` AND `credentialsCiphertext` keys, and zero split single-key sets
5. handleCredentialsSubmit with safestorage unavailable → returns `{ok:false}`
6. handlePinAttempt(correct PIN) → routes CREDENTIALS_UNAVAILABLE → NEEDS_CREDENTIALS
7. handlePinAttempt(wrong PIN) → stays CREDENTIALS_UNAVAILABLE, returns `{ok:false}`
8. handlePinRecoveryRequested → emits `show-pin-modal` IPC
9. fill-and-submit JSON.stringify escaping — credentials with `"`, `\\`, `\n` are correctly JSON-escaped and the raw unescaped pass does NOT appear in the executed JS
10. rerun-boot re-reads store after credentials-submitted (verified by exercising login-detected which requires fresh `hasCreds=true`)
11. Reducer regression guard — direct `reduce()` call still works post-edit

## Test Results

```
ℹ tests 44
ℹ pass 44
ℹ fail 0
```

All 33 original reducer tests + 11 new executor tests pass. No regression.

## Verification Results

| Check | Required | Actual |
|---|---|---|
| `node --check src/main/authFlow.js` | clean | clean |
| Executor exports (start/notify/handleCredentialsSubmit/handlePinAttempt/handlePinRecoveryRequested) | ≥5 | 5 |
| Atomic `store.set({...credentialsCiphertext...})` | ≥1 | 1 |
| `__bskiosk_fillAndSubmitLogin` literal | ≥1 | 1 |
| `auth.state:` log lines | ≥2 | 2 (transition trace + side-effect log) |
| `require('./credentialsStore')` | ≥1 | 1 |
| `require('./adminPin')` | ≥1 | 1 |
| `exports.reduce` (reducer untouched) | =1 | 1 |
| `node --test test/authFlow.test.js` | all pass | 44/44 pass |

## Deviations from Plan

None — plan executed exactly as written. Two small defensive additions documented as decisions above (start-timer pre-clear, pre-start notify no-op) were not deviations from the contract; both are pure hardening that never alter observable behavior under the documented happy paths.

## Side-Effect Protocol Compliance

Every kind in the 03-04-SUMMARY contract table has a handler in `_runSideEffect`. Unknown kinds log `auth.unknown-side-effect kind=X` and continue (never throw).

| kind | handler |
|---|---|
| log | `deps.log.info('auth.state: ' + currentState + ' reason=' + effect.reason)` |
| start-timer | clears existing timer with same name, then `setTimeout(() => notify({type:'timer-expired', name}), ms)` |
| clear-timer | `clearTimeout` + `delete timers[name]` |
| fill-and-submit | loads creds, JSON.stringify both, `webContents.executeJavaScript(...)` with `.catch` |
| show-credentials-overlay | IPC `show-credentials-overlay` with `{firstRun}` |
| hide-credentials-overlay | IPC `hide-credentials-overlay` |
| show-pin-modal | IPC `show-pin-modal` |
| hide-pin-modal | IPC `hide-pin-modal` |
| show-error | IPC `show-magicline-error` with `{variant}` |
| clear-credentials | `credentialsStore.clearCredentials(store)` + `hasCreds = false` |
| rerun-boot | re-reads `loadCredentials`, recomputes `hasCreds`, fires `creds-loaded` |

## Downstream Unblocked

- **Plan 03-07 IPC handlers** in `main.js` now resolve against real `authFlow.handleCredentialsSubmit`, `authFlow.handlePinAttempt`, `authFlow.handlePinRecoveryRequested` exports at runtime — auto-login flow is functional end-to-end.
- **Plan 03-08 integration/acceptance tests** become runnable.

## Self-Check: PASSED

- `src/main/authFlow.js` exists and modified — FOUND
- `test/authFlow.test.js` exists and modified — FOUND
- Commit `bf9f21e` (Task 1) — FOUND
- Commit `feee723` (Task 2) — FOUND
- 44/44 tests pass — VERIFIED
