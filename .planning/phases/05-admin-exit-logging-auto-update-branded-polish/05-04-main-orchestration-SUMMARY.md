---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 04
subsystem: main-process-orchestration
tags: [main-process, orchestration, ipc, hotkey, electron-updater, health-watchdog, ADMIN-01, ADMIN-02, ADMIN-06, ADMIN-07, ADMIN-08]
requires:
  - src/main/adminPinLockout.js (Plan 05-02)
  - src/main/updateGate.js (Plan 05-03)
  - src/main/sessionReset.onPostReset (Plan 05-03)
  - src/main/logger.audit (Plan 05-01)
  - electron-updater ^6.8.3 (Plan 05-01)
provides:
  - src/main/autoUpdater.js — NsisUpdater wrapper with runtime PAT via addAuthHeader
  - Ctrl+Shift+F12 hotkey → admin PIN modal (globalShortcut + before-input-event)
  - 5 new Phase 5 IPC channels: verify-admin-pin, get-admin-diagnostics,
    admin-menu-action, close-admin-menu, submit-update-pat
  - Full Phase 5 IPC surface in preload.js (9 subscribers, 5 invokes)
  - Post-update health watchdog (2-min timer + authFlow poller)
  - sessionReset.getLastResetAt() accessor
  - authFlow.getState() public accessor
affects:
  - Plan 05-05 (host UI) — consumes the full IPC surface exposed here
  - Plan 05-06 (log migration + verification) — asserts the event taxonomy used here
tech-stack:
  added: []
  patterns:
    - NsisUpdater direct construction + runtime addAuthHeader (mitigates #2314)
    - autoDownload=false + autoInstallOnAppQuit=false → manual gating via updateGate
    - Separate verify-admin-pin IPC channel — Phase 3 verify-pin + resetLoopPending
      intercept preserved byte-identical
    - adminMenuOpen guard flag on every admin-menu-action call
    - Two-attach before-input-event (host wc + magicline wc) for hotkey capture
    - Polling health check via authFlow.getState() — zero intrusion on authFlow
    - Dev-mode no-op guards everywhere (app.isPackaged=false)
key-files:
  created:
    - src/main/autoUpdater.js
  modified:
    - src/main/main.js (+352 lines, 337 → 689)
    - src/main/keyboardLockdown.js (+6 lines)
    - src/main/preload.js (+20 lines)
    - src/main/sessionReset.js (+17 lines — lastResetAt, getLastResetAt)
    - src/main/authFlow.js (+2 lines — public getState export)
decisions:
  - authFlow.getState() added as a public export (new, not previously in the
    plan's read-first list). The interfaces section of the plan noted this as
    conditional; since it did NOT exist, adding the public accessor was the
    cleanest path and mirrors _getCurrentStateForTests without diverging.
  - Health watchdog poll uses lazy require('./authFlow') inside the interval
    callback to avoid startup ordering issues and so the module survives
    dev-reloads.
  - onUpdateFailed callback guarded with mainWindow null-check to avoid
    crashing if the updater errors before the window exists.
metrics:
  duration: "~6 min"
  completed: 2026-04-10
  tasks: 4
  commits: 4
requirements: [ADMIN-01, ADMIN-02, ADMIN-06, ADMIN-07, ADMIN-08]
---

# Phase 5 Plan 04: Main-Process Orchestration Summary

**One-liner:** Wired all Phase 5 main-process behavior — `src/main/autoUpdater.js` NsisUpdater wrapper with runtime PAT injection, `Ctrl+Shift+F12` admin hotkey via dual globalShortcut + before-input-event, the full admin IPC surface (`verify-admin-pin`, `get-admin-diagnostics`, `admin-menu-action`, `close-admin-menu`, `submit-update-pat`), a 2-minute post-update health watchdog that polls `authFlow.getState()`, and the updateGate wiring against sessionReset — closing ADMIN-01/02/06/07/08 without touching the Phase 3 `resetLoopPending` intercept.

## What Shipped

### Task 1 — `src/main/autoUpdater.js` (commit `83bd232`)

Fresh 181-line module wrapping `electron-updater`'s `NsisUpdater` class directly (not the singleton) so the GitHub PAT can be injected at runtime via `addAuthHeader('Bearer ' + pat)` without embedding it in the installer.

Exports:
- `initUpdater({owner, repo, pat, store, isPackaged, onUpdateDownloaded, onUpdateFailed})` → `bool`
- `checkForUpdates()` → `{result: 'available'|'none'|'error'|'disabled', version?, error?}`
- `installUpdate()` — calls `updater.quitAndInstall(true, true)` (silent, force-run-after)
- `isEnabled()`, `getLastCheckAt()`, `_resetForTests()`

Key guards:
- Dev-mode no-op: `opts.isPackaged === false` returns `false` immediately
- PAT absent: returns `false` (silent disable per D-19)
- Idempotent: re-calling `initUpdater` tears down prior listeners via `removeAllListeners()`
- `autoDownload = false` + `autoInstallOnAppQuit = false` — all installs go through the updateGate path
- `update-downloaded` handler persists `store.set('pendingUpdate', {pendingVersion, installedAt})` BEFORE delegating to `onUpdateDownloaded` (D-29)
- `checkForUpdates` resolves (never rejects) on error — logs `update.failed` and returns `{result:'error'}`

All five update events emit `log.audit` with canonical taxonomy: `update.check`, `update.downloaded`, `update.install`, `update.failed`.

### Task 2 — `keyboardLockdown.js` Ctrl+Shift+F12 (commit `f45b93d`)

Single 6-line addition after `const reservedShortcuts = new Set();` — `reservedShortcuts.add('Ctrl+Shift+F12')` at module load so the set is populated before `attachLockdown` runs (Gotcha 5). `SUPPRESS_LIST` untouched — bare `F12` still suppressed.

### Task 3 — `main.js` Phase 5 orchestration (commit `df46711`)

337 → 689 lines (+352). Changes localized to:

1. **Imports (line 8 + new):** added `shell` to the existing electron destructure; new requires for `adminPinLockout`, `autoUpdater`, `updateGate`, `sessionResetMod`.
2. **Constants + state (~line 27):** `GITHUB_OWNER`/`GITHUB_REPO` (env-driven with `TODO-set-owner` fallback), `UPDATE_CHECK_INTERVAL_MS = 6h`, `HEALTH_WATCHDOG_MS = 2m`, `AUTH_POLL_MS = 2s`, and four module-scoped state vars (`adminMenuOpen`, `healthWatchdogTimer`, `authPollTimer`, `updateCheckInterval`).
3. **Phase 5 helper functions** (placed ABOVE `createMainWindow` so `createMainWindow` line range stays anchored):
   - `openAdminPinModal()` — sends `show-pin-modal` with `{context:'admin'}`
   - `tryInitAutoUpdater(store)` — decrypts PAT via safeStorage, calls `autoUpdater.initUpdater`
   - `armUpdateGate(store, info)` — injects `installFn` that sends `show-updating-cover` then calls `autoUpdater.installUpdate()`
   - `startUpdateCheckInterval()` — 6-hour `setInterval`
   - `startHealthWatchdog(store)` — reads `pendingUpdate`, starts 2-min `setTimeout` + 2-sec `setInterval` poller on `authFlow.getState()`
   - `clearHealthWatchdog(store)` — cancels both timers, deletes `pendingUpdate`
   - `buildAdminDiagnostics(store)` — returns `{version, lastUpdateCheck, authState, lastResetAt, updateStatus, patConfigured}`
4. **Ctrl+Shift+F12 globalShortcut registration** — inside existing `if (!isDev)` block, registers `openAdminPinModal` as the handler.
5. **before-input-event handlers on BOTH webContents** — host (right after `attachLockdown`) and Magicline (right after `createMagiclineView`). Both use `canonical(input)` from keyboardLockdown to match the chord.
6. **Health watchdog** — `startHealthWatchdog(store)` called BEFORE `createMagiclineView` so the auth-state poller picks up `CASH_REGISTER_READY` when authFlow transitions.
7. **Auto-updater boot sequence** — inside `startAuthFlow` after `authFlow.start` succeeds: `tryInitAutoUpdater` → if ok, initial `checkForUpdates()` + `startUpdateCheckInterval()`. Wrapped in try/catch so an updater failure cannot crash the auth flow.
8. **5 new IPC handlers** — inserted AFTER the existing `launch-touch-keyboard` block:
   - `verify-admin-pin` → `adminPinLockout.verifyPinWithLockout`; on `ok` sets `adminMenuOpen=true`, emits `log.audit('admin.open')`, sends `hide-pin-modal` + `show-admin-menu` with diagnostics. On `locked` emits `log.audit('pin.lockout')` + `show-pin-lockout`.
   - `get-admin-diagnostics` → returns `buildAdminDiagnostics(store)`
   - `admin-menu-action` → gated by `adminMenuOpen`; dispatches all 6 actions (check-updates / view-logs / reload / re-enter-credentials / configure-auto-update / exit-to-windows). `view-logs` drops kiosk via `app.setKiosk(false)` before `shell.openPath(app.getPath('logs'))` per Gotcha 7.
   - `close-admin-menu` → clears `adminMenuOpen`, sends `hide-admin-menu`
   - `submit-update-pat` → validates non-empty + no whitespace; encrypts via `safeStorage.encryptString` and stores under `githubUpdatePat`; clears `autoUpdateDisabled`; emits `log.audit('update.pat.configured', {pat})` (redacted by logger); re-inits updater; returns to admin menu.

**Preserved unchanged:**
- `createMainWindow()` body — untouched, still self-contained (Phase 1 ORCHESTRATION contract)
- `ipcMain.handle('verify-pin', ...)` + `resetLoopPending` intercept — **byte-identical diff verified** against `HEAD~3:src/main/main.js`
- Phase 4 `idle-dismissed`, `idle-expired`, `request-reset-loop-recovery` handlers
- `window-all-closed` / `will-quit` handlers
- Single-instance lock at file tail-entry

### Task 3 (bundled) — `sessionReset.js` + `authFlow.js` micro-additions

- `sessionReset.js` (+17 lines): `lastResetAt` module state, set inside `hardReset` right after `succeeded = true`, cleared in `_resetForTests`, exposed via new `getLastResetAt()` export. Phase 4 D-15 11-step flow untouched.
- `authFlow.js` (+2 lines): `exports.getState = () => currentState;` — mirrors the existing `_getCurrentStateForTests` test export but as a public production accessor for the health-watchdog poller. No behavior change.

### Task 4 — `preload.js` Phase 5 IPC surface (commit `da96d24`)

+20 lines. Existing `onShowPinModal` now forwards `payload` so host.js can branch on `context:'admin'` vs `context:'reset-loop'`. All Phase 1-4 methods preserved unchanged.

New exports:
- **Subscribers:** `onShowAdminMenu`, `onHideAdminMenu`, `onShowUpdateConfig`, `onHideUpdateConfig`, `onShowUpdatingCover`, `onHideUpdatingCover`, `onShowAdminUpdateResult`, `onShowPinLockout`, `onHidePinLockout`
- **Invokes:** `verifyAdminPin(pin)`, `getAdminDiagnostics()`, `adminMenuAction(action)`, `closeAdminMenu()`, `submitUpdatePat(pat)`

## Full Phase 5 IPC Channel Catalogue

**Main → Renderer (send):**
| Channel | Payload |
|---|---|
| `show-pin-modal` | `{context: 'admin' \| 'reset-loop'}` |
| `hide-pin-modal` | (none) |
| `show-admin-menu` | `{version, lastUpdateCheck, authState, lastResetAt, updateStatus, patConfigured}` |
| `hide-admin-menu` | (none) |
| `show-update-config` | `{hasExistingPat: boolean}` |
| `hide-update-config` | (none) |
| `show-updating-cover` | (none) |
| `hide-updating-cover` | (none) |
| `show-admin-update-result` | `{status, message?}` |
| `show-pin-lockout` | `{lockedUntil: ISOString}` |
| `hide-pin-lockout` | (none) |
| `show-magicline-error` (Phase 3) | extended variants: `'bad-release'`, `'update-failed'` |
| `show-credentials-overlay` (Phase 3) | `{firstRun: false}` re-used by re-enter-credentials |

**Renderer → Main (invoke):**
| Channel | Payload | Returns |
|---|---|---|
| `verify-admin-pin` | `{pin}` | `{ok, locked, lockedUntil}` |
| `get-admin-diagnostics` | (none) | diagnostics object |
| `admin-menu-action` | `{action}` | `{ok, result?, error?}` |
| `close-admin-menu` | (none) | `{ok}` |
| `submit-update-pat` | `{pat}` | `{ok, error?}` |

**Phase 3/4 preserved:** `verify-pin` (reset-loop only), `submit-credentials`, `request-pin-recovery`, `launch-touch-keyboard`, `idle-dismissed`, `idle-expired`, `request-reset-loop-recovery`.

## Phase 3 `resetLoopPending` Non-Regression Proof

```
$ diff <(sed -n '/ipcMain.handle..verify-pin/,/^      });/p' HEAD~3:src/main/main.js) \
       <(sed -n '/ipcMain.handle..verify-pin/,/^      });/p' HEAD:src/main/main.js)
verify-pin block byte-identical
```

The admin PIN flow uses the **separate** `verify-admin-pin` IPC channel, so the Phase 3/4 reset-loop recovery path is architecturally isolated and remains the ONLY consumer of `verify-pin`.

## Verification

| Check | Result |
|---|---|
| `node --check src/main/autoUpdater.js` | PASS |
| `node --check src/main/main.js` | PASS |
| `node --check src/main/preload.js` | PASS |
| `node --check src/main/keyboardLockdown.js` | PASS |
| `node --check src/main/sessionReset.js` | PASS |
| `node --check src/main/authFlow.js` | PASS |
| All modules require()-able at once | PASS (`all loadable`) |
| Full unit test suite (`node --test`) | **247/247 PASS** (includes 38 Phase 5 tests, 209 Phase 1-4 regression) |
| `grep -c ipcMain.handle src/main/main.js` | `9` (≥ 9 required) |
| `grep -c resetLoopPending src/main/main.js` | `4` (≥ 2 required) |
| `grep -c openAdminPinModal src/main/main.js` | `4` (≥ 4 required) |
| `grep -c Ctrl+Shift+F12 src/main/main.js` | `6` (≥ 3 required) |
| `grep -c tryInitAutoUpdater src/main/main.js` | `3` (≥ 2 required) |
| `grep -c 'startHealthWatchdog\|clearHealthWatchdog' src/main/main.js` | `4` |
| `grep -nE 'publish.*token' package.json` | (empty — T-05-21 verified) |
| `reservedShortcuts.has('Ctrl+Shift+F12')` at module load | `true` |
| `authFlow.getState()` returns `'BOOTING'` on fresh require | PASS |
| `sessionReset.getLastResetAt` is a function | PASS |
| `verify-pin` block byte-identical to HEAD~3 | PASS |
| `createMainWindow` function present and unmodified | PASS |
| Phase 1 ORCHESTRATION marker preserved | PASS |

## Threat Model Coverage

| Threat | Mitigation | Evidence |
|---|---|---|
| T-05-18 (admin PIN hits resetLoopPending intercept) | Separate `verify-admin-pin` channel | grep confirms both handlers exist; diff confirms Phase 3 block byte-identical |
| T-05-19 (exit-to-windows without PIN gate) | `adminMenuOpen` guard on every `admin-menu-action` | Handler rejects `{ok:false, error:'not-authorised'}` if flag is false |
| T-05-20 (PAT logged in plaintext) | `log.audit('update.pat.configured', {pat})` — `pat` hits `CIPHER_FIELDS` → `[cipher:N]` | Logger redactor from Plan 05-01 |
| T-05-21 (PAT embedded in installer) | NsisUpdater constructed with no `publish.token`; PAT via `addAuthHeader` at runtime | `grep publish.*token package.json` empty |
| T-05-22 (fake NSIS payload) | electron-updater verifies sha512 against `latest.yml` (default behavior, not overridden) | No override present |
| T-05-23 (DoS via check frequency) | `setInterval(6h)` + one on boot | `UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000` |
| T-05-24 (bad release bricks kiosk) | Health watchdog: `pendingUpdate` flag + 2-min `setTimeout`; expiry → `autoUpdateDisabled=true` + `show-magicline-error {variant:'bad-release'}` | `startHealthWatchdog` + `markBadRelease` logic |
| T-05-25 (hotkey registration order) | `reservedShortcuts.add('Ctrl+Shift+F12')` at module load (before `attachLockdown`); globalShortcut.register inside `!isDev` block | Module-load-time set insertion verified |
| T-05-26 (no audit trail for admin actions) | `log.audit('admin.open',{})` on PIN success + `log.audit('admin.exit',{action})` on every action dispatch | Handler source |
| T-05-27 (shell.openPath in kiosk) | `app.setKiosk(false)` called BEFORE `shell.openPath` in `view-logs` action | Handler source |

## Deviations from Plan

**1. [Rule 3 – Blocking fix] Added `authFlow.getState()` public export**
- **Found during:** Task 3 read-first (plan's interfaces section flagged this as conditional: "authFlow.getState(): string — Phase 3 Plan 3-04 exported this; verify via grep")
- **Issue:** Grep confirmed `authFlow.js` exposed `_getCurrentStateForTests` but NO public `getState`. The health-watchdog poller required a non-test accessor.
- **Fix:** Added `exports.getState = () => currentState;` — a 2-line mirror of the existing test-only accessor. No behavior change.
- **Files modified:** `src/main/authFlow.js`
- **Commit:** bundled into `df46711` with Task 3

**2. [Rule 2 – Missing critical functionality] mainWindow null-guard in onUpdateFailed**
- **Found during:** Task 3 drafting
- **Issue:** The plan's helper pseudocode for `tryInitAutoUpdater.onUpdateFailed` called `mainWindow.webContents.send(...)` without a null-check. An `error` event emitted before `mainWindow` exists (during the race between auth-flow init and first boot update check) would crash the main process.
- **Fix:** Added `if (mainWindow)` guard inside the try/catch.
- **Files modified:** `src/main/main.js`
- **Commit:** bundled into `df46711` with Task 3

**3. [Discretionary] Lazy require for authFlow inside health-watchdog poller**
- **Reason:** The poller's `setInterval` callback cannot assume `./authFlow` is already cached when the interval first ticks; a lazy `require('./authFlow')` inside the callback survives cold-require and hot-reload scenarios cleanly without module-load ordering constraints.
- **Files modified:** `src/main/main.js`
- **Not a true deviation** — plan explicitly suggested "register a polling check that reads `authFlow.getState()`" and left the ergonomics open.

No Rule 4 (architectural) deviations. No authentication gates encountered (all work is offline wiring).

## Key Decisions

- **`verify-admin-pin` is a brand-new IPC channel**, NOT an overload of `verify-pin`. This is the only safe way to preserve the Phase 3 `resetLoopPending` intercept byte-identical while also allowing admin PIN to trigger an entirely different UI flow (admin menu + diagnostics).
- **`adminMenuOpen` guard on every `admin-menu-action`** — zero trust in the renderer. Even if host.js were compromised and sent `exit-to-windows` without going through the PIN flow, the handler refuses with `not-authorised`.
- **Health watchdog uses polling, not eventing.** The plan's interfaces section flagged that `authFlow.start` does NOT expose an `onCashRegisterReady` callback. A 2-second poll on `authFlow.getState()` is simpler, requires zero modification to authFlow's internals, and the 2-second granularity is well within the 2-minute watchdog window.
- **`lastResetAt` as `number | null` (ms since epoch), NOT ISO string.** Matches `Date.now()` semantics used elsewhere in sessionReset; the admin menu renderer can format relative time (`vor 3 Min`) directly.
- **`owner`/`repo` as env-driven constants with `TODO-set-owner` fallback** — the runbook can set `BSFPOS_GH_OWNER` / `BSFPOS_GH_REPO` before the first prod build; no hard-coding of potentially sensitive identifiers in-source.

## main.js Line-Count Delta

- Before Plan 05-04: 337 lines
- After Plan 05-04: **689 lines** (+352)

## Commits

| Task | Type | Hash | Message |
|---|---|---|---|
| 1 | feat | `83bd232` | add autoUpdater NsisUpdater wrapper with runtime PAT injection |
| 2 | feat | `f45b93d` | register Ctrl+Shift+F12 admin hotkey in reservedShortcuts |
| 3 | feat | `df46711` | wire Phase 5 main-process orchestration |
| 4 | feat | `da96d24` | expose Phase 5 IPC surface via preload |

## Known Stubs

None. All helper functions are fully implemented; `GITHUB_OWNER`/`GITHUB_REPO` use a `TODO-set-owner` env fallback which is the documented runbook touch-point, not a stub (the updater gracefully no-ops with that sentinel since no PAT will be stored anyway).

## Next Plan

Plan 05-05 (host UI) — renders against the IPC surface catalogued above: admin menu layer 500 div, PIN lockout countdown, PAT config form, updating cover, bad-release/update-failed magicline-error variants.

## Self-Check: PASSED

- `src/main/autoUpdater.js` — FOUND (created)
- `src/main/main.js` — FOUND (modified, 689 lines)
- `src/main/keyboardLockdown.js` — FOUND (modified, reservedShortcuts contains 'Ctrl+Shift+F12')
- `src/main/preload.js` — FOUND (modified, +20 lines)
- `src/main/sessionReset.js` — FOUND (modified, getLastResetAt exported)
- `src/main/authFlow.js` — FOUND (modified, getState exported)
- Commit `83bd232` — FOUND in `git log`
- Commit `f45b93d` — FOUND in `git log`
- Commit `df46711` — FOUND in `git log`
- Commit `da96d24` — FOUND in `git log`
- Full test suite — 247/247 PASS
