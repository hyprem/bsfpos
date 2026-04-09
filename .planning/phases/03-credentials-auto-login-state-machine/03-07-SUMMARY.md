---
phase: 03-credentials-auto-login-state-machine
plan: 07
subsystem: main-process-orchestration
tags: [main, ipc, authFlow, wiring, tabtip, safeStorage]
requires:
  - 03-04 (authFlow reducer exports — executor still deferred)
  - 03-05 (magiclineView delegation to authFlow.notify)
  - 03-06 (host-ui preload surface: submit-credentials, verify-pin, request-pin-recovery, launch-touch-keyboard)
provides:
  - main-authflow-wiring
  - ipc-submit-credentials-handler
  - ipc-verify-pin-handler
  - ipc-request-pin-recovery-handler
  - ipc-launch-touch-keyboard-handler
  - magicline-webcontents-accessor
affects:
  - src/main/main.js
  - src/main/magiclineView.js
tech-stack:
  added: []
  patterns:
    - lazy-require (already established)
    - ipcMain.handle try/catch envelope
    - child_process.exec for Windows shell invocation
    - ordering-critical initialization (Pitfall #2)
key-files:
  modified:
    - src/main/main.js
    - src/main/magiclineView.js
  created:
    - .planning/phases/03-credentials-auto-login-state-machine/03-07-AUTH06-RUNBOOK.md
decisions:
  - "authFlow.start called AFTER createMagiclineView inside whenReady — the BrowserWindow created by createMainWindow satisfies Pitfall #2 safeStorage.isEncryptionAvailable() ordering constraint"
  - "Magicline child view accessed via two paths: return value of createMagiclineView AND a getMagiclineWebContents() module-level accessor (defensive redundancy for future refactors)"
  - "launch-touch-keyboard handler hardcodes tabtip.exe path — no payload interpolation (T-03-10 mitigation)"
  - "Every ipcMain handler wraps authFlow calls in try/catch returning {ok:false} envelopes so renderer IPC never throws across the contextBridge boundary"
  - "Non-win32 platforms get launch-touch-keyboard {ok:false, error:'not-windows'} — renderer already treats ok:false as a no-op soft-fallback"
metrics:
  tasks: 3
  files: 3
  duration: single-session
  completed: 2026-04-09
requirements: [AUTH-02, AUTH-04, AUTH-05, AUTH-06]
---

# Phase 03 Plan 07: main.js authFlow + IPC wiring Summary

One-liner: Wire authFlow.start + four Phase 3 ipcMain.handle registrations (submit-credentials, verify-pin, request-pin-recovery, launch-touch-keyboard) into main.js after createMagiclineView inside whenReady, and expose getMagiclineWebContents from magiclineView.js.

## Outcome

| Task | Name                                                                   | Commit  | Files                                                                                     |
| ---- | ---------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| 1    | Expose magicline webContents from createMagiclineView                  | d30c951 | src/main/magiclineView.js                                                                  |
| 2    | Wire authFlow.start + ipcMain handlers + launch-touch-keyboard         | 0fa886b | src/main/main.js                                                                           |
| 3    | AUTH-06 dedicated staff account runbook                                | b24c743 | .planning/phases/03-credentials-auto-login-state-machine/03-07-AUTH06-RUNBOOK.md           |

## Final main.js orchestration order (inside app.whenReady)

Per the plan's Pitfall #2 + Pitfall ordering section:

1. `setLoginItemSettings` (existing Phase 1, prod-only)
2. `globalShortcut.register` no-ops (existing Phase 1, prod-only)
3. `createMainWindow()` (existing Phase 1) — **creates the BrowserWindow that satisfies the Pitfall #2 safeStorage prerequisite**
4. `attachLockdown(mainWindow.webContents)` (existing Phase 1)
5. `new Store({ name: 'config' })` (existing Phase 2)
6. `createMagiclineView(mainWindow, store)` (existing Phase 2) — returns the WebContentsView instance, now assigned to local `magiclineView`
7. **NEW** `authFlow.start({ mainWindow, magiclineWebContents: magiclineView.webContents, store, safeStorage })` — wraps failure in try/catch, logs `phase3.authFlow.start failed: ...` but never throws
8. **NEW** `ipcMain.handle('submit-credentials', ...)` — delegates to `authFlow.handleCredentialsSubmit(payload)`, returns `{ok:false, error}` envelope on throw
9. **NEW** `ipcMain.handle('verify-pin', ...)` — downcasts `payload.pin` to string, delegates to `authFlow.handlePinAttempt(pin)`
10. **NEW** `ipcMain.handle('request-pin-recovery', ...)` — delegates to `authFlow.handlePinRecoveryRequested()`, returns `{ok:true}`
11. **NEW** `ipcMain.handle('launch-touch-keyboard', ...)` — non-win32 early-returns `{ok:false, error:'not-windows'}`; win32 shells out via `child_process.exec` on the hardcoded TabTip.exe path
12. `mainWindow.once('closed', ...)` WR-03 destroy hook (existing Phase 2)

All pre-existing Phase 1 and Phase 2 behaviour preserved:
- Single-instance lock + process.exit(0) still the first executable call
- `will-quit` + `window-all-closed` handlers untouched
- createMainWindow function body untouched

## Four IPC channel registrations

| Channel                 | Payload shape                                                       | Return shape                                    | Delegates to                                  |
| ----------------------- | ------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `submit-credentials`    | `{firstRun, pin?, user, pass}` (validated downstream)               | `{ok: boolean, error?: string}`                 | `authFlow.handleCredentialsSubmit(payload)`   |
| `verify-pin`            | `{pin: string}` (downcast to string before forwarding)              | `{ok: boolean}`                                 | `authFlow.handlePinAttempt(pin)`              |
| `request-pin-recovery`  | (none)                                                              | `{ok: boolean}`                                 | `authFlow.handlePinRecoveryRequested()`       |
| `launch-touch-keyboard` | (none)                                                              | `{ok: boolean, error?: string}`                 | `child_process.exec('"…\\TabTip.exe"', …)`    |

## TabTip launcher detail

`child_process.exec` invocation uses a double-escaped hardcoded Windows path:

```js
const cmd = '"C:\\\\Program Files\\\\Common Files\\\\microsoft shared\\\\ink\\\\TabTip.exe"';
```

Double-escape is necessary because the string literal goes through JS escaping once and is then interpreted as a shell command string by `exec`. The final shell-level command is:

```
"C:\Program Files\Common Files\microsoft shared\ink\TabTip.exe"
```

No payload interpolation — T-03-10 mitigation. The attacker-controlled IPC payload never reaches `exec`.

## magiclineView.js accessor

Added a three-line `getMagiclineWebContents()` function at the bottom of the module before `module.exports`, and added it to the exports alongside `createMagiclineView` and `destroyMagiclineView`. Returns `magiclineView.webContents` or `null`. This is a defensive redundancy — main.js currently reads `.webContents` off the return value of `createMagiclineView` directly, but a future refactor that stores the instance elsewhere can use the module-level accessor without threading the instance through closures.

`createMagiclineView` already had `return magiclineView;` at line 167 — no change needed to honour the plan's "confirm with grep" contract.

## Verification

- `node --check src/main/main.js` → ok
- `node --check src/main/magiclineView.js` → ok
- `grep -q "require('./authFlow')" src/main/main.js` → ok
- `grep -q "safeStorage" src/main/main.js` → ok
- `grep -q "ipcMain" src/main/main.js` → ok
- `grep -q "child_process" src/main/main.js` → ok
- `grep -q "authFlow.start" src/main/main.js` → ok (3 matches: call + success log + failure log)
- `grep -q "magiclineWebContents" src/main/main.js` → ok
- `grep -q "ipcMain.handle.'submit-credentials'" src/main/main.js` → ok
- `grep -q "ipcMain.handle.'verify-pin'" src/main/main.js` → ok
- `grep -q "ipcMain.handle.'request-pin-recovery'" src/main/main.js` → ok
- `grep -q "ipcMain.handle.'launch-touch-keyboard'" src/main/main.js` → ok
- `grep -q "TabTip.exe" src/main/main.js` → ok
- `grep -q "createMagiclineView(mainWindow, store)" src/main/main.js` → ok (Phase 2 preserved)
- `grep -q "createMainWindow()" src/main/main.js` → ok (Phase 1 preserved)
- `grep -q "setLoginItemSettings" src/main/main.js` → ok (Phase 1 preserved)
- `grep -q "destroyMagiclineView" src/main/main.js` → ok (WR-03 preserved)
- `grep -q "getMagiclineWebContents" src/main/magiclineView.js` → ok
- `grep -q "return magiclineView;" src/main/magiclineView.js` → ok
- AUTH-06 runbook file exists, contains "AUTH-06" heading and "BSK Kiosk Terminal"

## Deviations from Plan

### Known at plan-time — authFlow executor not yet implemented

**1. [Rule 2 note — missing dependency] authFlow.{start,handleCredentialsSubmit,handlePinAttempt,handlePinRecoveryRequested} are not exported by src/main/authFlow.js**

- **Found during:** Task 2 pre-edit API audit (`node -e "console.log(Object.keys(require('./src/main/authFlow')))"` returned only `[reduce, STATES, _POST_SUBMIT_WATCHDOG_MS, _BOOT_WATCHDOG_MS]`).
- **Root cause:** Plan 03-04 was split at the Task 1/Task 2 boundary per user direction on 2026-04-09. Task 1 shipped the pure reducer. Task 2 (the executor — module-scoped state, webContents glue, credentialsStore / adminPin persistence, timer management, IPC handlers `start` / `handleCredentialsSubmit` / `handlePinAttempt` / `handlePinRecoveryRequested` / `notify`) was explicitly deferred to a later session. See `03-04-SUMMARY.md` lines 56-60.
- **Impact at boot:** `authFlow.start({...})` throws `TypeError: authFlow.start is not a function` at whenReady time. Plan 03-07 wraps this call in a try/catch and logs `phase3.authFlow.start failed: ...` — the main process does NOT crash. ipcMain handlers ARE registered successfully (ipcMain.handle call shape is valid). First renderer IPC attempt (`submit-credentials` etc.) hits the per-handler try/catch, logs `ipc.submit-credentials failed: authFlow.handleCredentialsSubmit is not a function`, and returns `{ok:false, error:"authFlow.handleCredentialsSubmit is not a function"}` to the renderer.
- **Why not fixed here:** This is a Plan 03-04 Task 2 gap, not a Plan 03-07 scope item. Plan 03-07 is explicitly the "glue plan" — its contract is to write the wiring code assuming the executor exists. Implementing the executor inline would (a) blow past Plan 03-07's scope, (b) duplicate work Plan 03-04 Task 2 owns, and (c) couple two plans that were deliberately split. The plan author had full visibility into Plan 03-04's deferral and wrote Plan 03-07 as-is anyway.
- **Action:** Plan 03-04 Task 2 must be executed before the app will boot end-to-end. Adding as an explicit follow-up below. **The wiring shipped here is CORRECT** — when authFlow Task 2 lands, no change to main.js is needed. The lazy delegation from `magiclineView.js` (Plan 03-05) to `require('./authFlow').notify(...)` will likewise resolve the moment `.notify` is added.

### Minor — declared unused vs used local

In Plan 03-07's Task 2 action block the plan example used `createMagiclineView(mainWindow, store);` without assigning the return. This summary's implementation assigns `const magiclineView = createMagiclineView(mainWindow, store);` so we can pass `magiclineView.webContents` to `authFlow.start`. This matches the plan's Change 2 example code block which explicitly writes `const magiclineView = createMagiclineView(mainWindow, store);`. Not a deviation from the plan text; flagging because the Phase 2 pre-existing code did NOT assign the return.

## Known Stubs

None from this plan. All wiring is live. The authFlow executor gap (above) is an upstream deferred-plan item, not a stub introduced by this plan.

## Threat Flags

None. All additions stay inside existing trust boundaries:
- `launch-touch-keyboard` uses a hardcoded command string with no renderer-payload interpolation (T-03-10 mitigation verified)
- Every `ipcMain.handle` handler type-checks its payload (or downcasts to the expected shape) before forwarding to authFlow — T-03-11 mitigation
- Main.js log lines around authFlow.start carry only success/failure state strings, never payload contents — T-03-12 mitigation

All three STRIDE entries (T-03-10, T-03-11, T-03-12) from the plan's `<threat_model>` are mitigated as specified.

## Deferred Issues

None within scope of Plan 03-07. The authFlow executor gap is tracked as an upstream Plan 03-04 Task 2 follow-up (see Deviations above).

## Follow-ups owned elsewhere

- **Plan 03-04 Task 2 (deferred):** append the authFlow executor (`start`, `notify`, `handleCredentialsSubmit`, `handlePinAttempt`, `handlePinRecoveryRequested`, side-effect dispatcher) to `src/main/authFlow.js`. No change to main.js will be needed afterwards — Plan 03-07's wiring is the contract that will come alive.
- **Plan 03-08 (phase acceptance):** live-kiosk walkthroughs covering first-run credentials entry, re-entry after safeStorage failure, PIN recovery from `credentials-unavailable` variant, and TabTip launch-on-tap of the Tastatur buttons.
- **Plan 03-09 (kiosk probes):** confirm tabtip.exe path is valid under Assigned Access user; confirm the hardcoded path survives both Windows 10 and Windows 11 Assigned Access sessions.
- **AUTH-06:** operator-executed. Runbook file in-repo; gym management must create the dedicated Magicline staff role before first install.

## Self-Check: PASSED

Files verified present with expected content:
- FOUND: src/main/main.js (Phase 3 wiring block present, all 4 ipcMain.handle registrations, authFlow.start call, child_process require, safeStorage in destructure, TabTip.exe literal)
- FOUND: src/main/magiclineView.js (getMagiclineWebContents function and export, return magiclineView preserved)
- FOUND: .planning/phases/03-credentials-auto-login-state-machine/03-07-AUTH06-RUNBOOK.md (AUTH-06 heading, BSK Kiosk Terminal literal, 7-step setup checklist)

Commits verified in git log:
- FOUND: d30c951 feat(03-07): export getMagiclineWebContents accessor
- FOUND: 0fa886b feat(03-07): wire authFlow + Phase 3 ipcMain handlers in main.js
- FOUND: b24c743 docs(03-07): AUTH-06 dedicated staff account runbook
