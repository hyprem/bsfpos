---
phase: 03-credentials-auto-login-state-machine
plan: 05
subsystem: inject-layer + magicline-view
tags: [auth, inject, drain-queue, authFlow]
requires: [03-04]
provides:
  - inject-detect-login
  - inject-fill-and-submit-login
  - stable-selectors-login
  - drain-authflow-delegation
affects:
  - src/inject/inject.js
  - src/inject/fragile-selectors.js
  - src/main/magiclineView.js
tech-stack:
  added: []
  patterns: [drain-queue-event, idempotent-reinjection, hash-dedupe, lazy-require]
key-files:
  created: []
  modified:
    - src/inject/inject.js
    - src/inject/fragile-selectors.js
    - src/main/magiclineView.js
decisions:
  - "Dedupe login-detected by hash string (not boolean) so hash-change re-routes re-fire"
  - "Reset lastLoginEmitForHash after click so post-failure re-renders can re-detect"
  - "Lazy require('./authFlow') inline — avoids eager pull-in during magiclineView isolation tests"
  - "Forward cash-register-ready to authFlow BEFORE splash-hide so state transition log lands first"
metrics:
  tasks: 3
  files: 3
  duration: ~10min
  completed: 2026-04-09
requirements: [AUTH-03]
---

# Phase 3 Plan 05: inject login hooks + authFlow drain delegation

Wires Phase 2's injection layer to Phase 3's auth state machine. Three
files touched, all changes additive — no behavioural change to
Phase 2 paths (drift, cash-register-ready splash lift, observer events).

## Commits

| Task | Commit  | Files                                | Description |
|------|---------|--------------------------------------|-------------|
| 1    | fe020ed | src/inject/inject.js                 | detectLogin + fillAndSubmitLogin + idempotency re-entry wire-up + initial-pass call |
| 2    | 7072c41 | src/inject/fragile-selectors.js      | 3 new STABLE entries for login username/password/login-button |
| 3    | 15ecff8 | src/main/magiclineView.js            | KNOWN_EVENT_TYPES extended + handleInjectEvent delegation to authFlow.notify |

## Task 1 — inject.js

Three additive edits inside the existing IIFE:

1. **Idempotency-guard re-entry block (lines 36-41):** added a third
   `try/catch` calling `window.__bskiosk_detectLogin` so re-injection on
   `did-navigate-in-page` re-checks for login form presence. Previously
   only `hideDynamic` and `detectReady` were re-run.

2. **`detectLogin` + `__bskiosk_fillAndSubmitLogin` (after detectReady block):**
   - `detectLogin` mirrors `detectReady` but inverted: positive gate is
     `[data-role="username"]` present, negative gate is the
     `#/cash-register` hash regex. Dedupe uses `lastLoginEmitForHash`
     (hash STRING, not a boolean) so re-routes from cash-register back
     to `/#/login` emit a fresh `login-detected`.
   - `window.__bskiosk_fillAndSubmitLogin(user, pass)` queries the three
     data-role selectors, calls `__bskiosk_setMuiValue` on username and
     password, waits one `requestAnimationFrame` for MUI controlled
     input state to settle, then `.click()`s the login button. Resets
     `lastLoginEmitForHash = null` right before emitting `login-submitted`
     so failure re-renders at the same hash CAN fire a second
     `login-detected` (needed for D-21's two-path failure signal).
   - Credentials are only in-scope as function arguments — never
     persisted on `window` or closure beyond the single call.

3. **Initial pass (bottom of IIFE):** added `detectLogin();` next to
   `detectReady();` so a page that loads already at `/#/login` fires
   immediately without waiting for the first mutation.

No modification to `setMuiValue`, `hideDynamicElements`, `selfCheck`,
`detectReady`, or the `MutationObserver` setup.

## Task 2 — fragile-selectors.js

Appended three entries to `STABLE_SELECTORS` with a `// Phase 3` marker
comment:

```js
{ category: 'stable', selector: '[data-role="username"]',     purpose: 'Login: username field' },
{ category: 'stable', selector: '[data-role="password"]',     purpose: 'Login: password field' },
{ category: 'stable', selector: '[data-role="login-button"]', purpose: 'Login: submit button' }
```

`FRAGILE_SELECTORS` untouched. These participate in the EMBED-05
`selfCheck` so a Magicline rename of any of the three data-role
attributes will emit a `drift` event on the cash-register page the
first time the user logs in — acceptable noise bounded to one
`driftReportedFor` dedupe key per selector per page load.

## Task 3 — magiclineView.js

Three additive edits:

1. **`KNOWN_EVENT_TYPES`:** added `'login-detected'` and
   `'login-submitted'` to the whitelist Set at lines 60-66.

2. **`cash-register-ready` block:** after the existing
   `log.info('magicline.cash-register-ready: ...')` line, added a
   lazy-require delegation to `authFlow.notify({ type: 'cash-register-ready', payload })`.
   Placed BEFORE the reveal + splash-hide IPC sends so authFlow's
   state-transition log line appears before the splash fade in
   audit logs. Wrapped in its own try/catch so authFlow breakage
   cannot block splash-lift.

3. **New `login-detected` / `login-submitted` block:** added after
   `observer-attach-failed` and before the closing brace of
   `handleInjectEvent`. Logs the event at info level, then delegates
   to `authFlow.notify({ type, payload })`. Uses `require('./authFlow')`
   inline (not top-of-file) so magiclineView.js can still be required
   in isolation without pulling authFlow + its dependencies into scope.

Existing `drift`, `observer-scope-fallback`, and `observer-attach-failed`
handling is unchanged.

## Verification

- `node --check src/inject/inject.js` → ok
- `node --check src/inject/fragile-selectors.js` → ok
- `node --check src/main/magiclineView.js` → ok
- `grep -c "__bskiosk_detectLogin" src/inject/inject.js` → 2 (declaration + idempotency re-entry)
- `grep -c "__bskiosk_fillAndSubmitLogin" src/inject/inject.js` → 1
- `grep -c "lastLoginEmitForHash" src/inject/inject.js` → 4 (declaration + dedupe compare + store + reset-on-submit)
- `grep -c "lastLoginEmitForHash = null" src/inject/inject.js` → 1
- `grep -c "detectLogin()" src/inject/inject.js` → 2 (idempotency re-entry + initial-pass)
- `grep -c 'data-role="username"' src/inject/fragile-selectors.js` → 1
- `grep -c 'data-role="password"' src/inject/fragile-selectors.js` → 1
- `grep -c 'data-role="login-button"' src/inject/fragile-selectors.js` → 1
- `grep -c "require('./authFlow').notify" src/main/magiclineView.js` → 2
- `grep -q "'login-detected'" src/main/magiclineView.js` → ok
- `grep -q "'login-submitted'" src/main/magiclineView.js` → ok

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All wiring is live — `authFlow.notify` is the Plan 03-04 reducer
façade (Task 2 of Plan 03-04 will appended the executor that actually
consumes these events, but the `.notify` delegation point exists and
is the documented contract).

## Threat Flags

None. All additions stay inside existing trust boundaries:
- inject.js runs in Magicline's already-untrusted main world
- fillAndSubmitLogin receives credentials from the main process
  via `executeJavaScript` (Plan 03-04 Task 2 territory); no new
  network endpoints, no new file/IPC surface
- magiclineView.js delegation is a same-process lazy require

## Follow-ups

- Plan 03-06+ will wire `main.js` to call `authFlow.start(...)` after
  `createMagiclineView` returns so the lazy `require('./authFlow')`
  here has a live instance to talk to.
- If verification reveals the Phase 3 login selectors trigger a
  drift-overlay flash after successful login (because `selfCheck`
  runs on the cash-register page where login selectors are absent),
  file a Phase 3-polish follow-up to add `appliesOn` filtering to
  `fragile-selectors.js` entries. The plan flagged this as accepted
  bounded noise.

## Self-Check: PASSED

Files verified present with expected content:
- src/inject/inject.js (272 lines, FOUND)
- src/inject/fragile-selectors.js (55 lines, FOUND)
- src/main/magiclineView.js (+25 lines, FOUND)

Commits verified on branch worktree-agent-aefb8952:
- fe020ed feat(03-05): add detectLogin and fillAndSubmitLogin to inject.js — FOUND
- 7072c41 feat(03-05): add 3 login stable selectors to fragile-selectors.js — FOUND
- 15ecff8 feat(03-05): delegate auth events to authFlow from magiclineView — FOUND
