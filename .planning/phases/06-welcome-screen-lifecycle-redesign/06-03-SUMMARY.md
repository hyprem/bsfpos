---
phase: 06-welcome-screen-lifecycle-redesign
plan: 03
subsystem: main-orchestration
tags: [welcome-screen, cold-boot, ipc, orchestration, d-03, d-05]
requires:
  - "06-01 (host welcome layer + welcome:show/hide/tap IPC surface)"
  - "06-02 (idleTimer 10s + sessionReset welcome branch that emits welcome:show itself)"
provides:
  - "Cold boot lands on welcome layer (no pre-warmed Magicline view)"
  - "welcome:tap IPC handler — creates Magicline view + starts authFlow on demand"
  - "startLoginFlow helper reusable by welcome:tap (idempotent)"
affects:
  - src/main/main.js
tech-stack:
  added: []
  patterns:
    - "Lazy view creation gated behind user interaction (welcome:tap)"
    - "did-finish-load guard for cold-boot IPC sends to host renderer"
    - "Sender-validated ipcMain.on handler (T-06-12 spoofing mitigation)"
key-files:
  created:
    - .planning/phases/06-welcome-screen-lifecycle-redesign/06-03-SUMMARY.md
  modified:
    - src/main/main.js
decisions:
  - "D-03 realised: cold boot skips createMagiclineView + authFlow.start; only splash:hide + welcome:show are sent to the host"
  - "D-05 orchestration half realised: welcome:tap is the sole entry into the login flow; sessionReset.js welcome-mode branch (Plan 06-02) still emits welcome:show itself on completion — main does not re-send"
  - "runAutoUpdaterInit kept at cold-boot time (independent of Magicline view) to preserve Phase 5 auto-updater wiring"
  - "splash:hide explicitly sent at cold boot because the Phase 1 splash previously hid on Magicline did-finish-load, which no longer fires at boot"
metrics:
  duration: "~10 min"
  completed: 2026-04-13
  tasks: 1
  commits: 2 (pending orchestrator hand-commit — sandbox denied git for executor; same pattern as Plan 06-02 Task 2)
---

# Phase 6 Plan 03: main.js Cold-Boot-to-Welcome Orchestration + welcome:tap IPC Handler Summary

Rewire `src/main/main.js` so cold boot lands on the welcome layer instead of auto-logging into Magicline. The first tap drives the full login flow via a new `ipcMain.on('welcome:tap')` handler. Completes Wave 2 of Phase 6 — wire-up of the user-visible welcome-as-resting-state lifecycle (D-03 + orchestration half of D-05).

## What Was Built

### Task 1 — Gate cold-boot view creation behind welcome:tap (src/main/main.js)

All edits landed below the existing `// === ORCHESTRATION ===` marker inside the `if (mainWindow)` branch of `app.whenReady`. `createMainWindow` untouched; `setAdminHotkeyHandler(openAdminPinModal)` preserved verbatim immediately above the refactored block.

**Deleted** (old cold-boot block, ~lines 410–453):

- Top-level `createMagiclineView(mainWindow, store)` call
- Local `startAuthFlow` arrow that called `authFlow.start(...)` + `tryInitAutoUpdater` + `autoUpdater.checkForUpdates` + `startUpdateCheckInterval`
- `did-finish-load` / `isLoading()` guard that invoked `startAuthFlow`

**Added:**

1. **`startLoginFlow()` helper** — wraps `createMagiclineView(mainWindow, store)` + `authFlow.start({...})`. Reusable by welcome:tap. Idempotent via magiclineView's early-return guard (lines 116–120) and authFlow's state-reseed-on-start contract. Catches and logs errors as `phase6.startLoginFlow failed`.

2. **`runAutoUpdaterInit()` helper** — preserves the Phase 5 wiring (`tryInitAutoUpdater(store)` → `autoUpdater.checkForUpdates()` → `startUpdateCheckInterval()`). Called from cold boot only, independent of any Magicline view. Logged as `phase5.autoUpdater.init failed` on error (unchanged taxonomy).

3. **`showWelcomeOnColdBoot()` helper** — sends `splash:hide` then `welcome:show` to `mainWindow.webContents`, logs `phase6.cold-boot.welcome-shown`, then calls `runAutoUpdaterInit()`. The explicit `splash:hide` is required because the Phase 1 splash layer previously auto-hid on Magicline's `did-finish-load`, which no longer fires at boot (no Magicline view exists yet). Guarded by the same `mainWindow.webContents.isLoading() ? once('did-finish-load', fn) : fn()` pattern that the deleted `startAuthFlow` used, so the IPC is not dropped before the host renderer subscribes.

4. **`ipcMain.on('welcome:tap', ev => {...})` handler** — placed just below `showWelcomeOnColdBoot`, before the existing `ipcMain.handle('submit-credentials', ...)` handler. Behavior:
   - **T-06-12 sender validation:** `if (ev.sender !== mainWindow.webContents) { log.warn(...); return; }` — only the host renderer can trigger. Magicline child webContents cannot spoof.
   - Logs `phase6.welcome:tap received — starting login flow` (T-06-14 per-tap audit).
   - Sends `welcome:hide` + `splash:show` to the host (splash acts as the loading cover during the 3–5s login).
   - Calls `startLoginFlow()` — creates the Magicline view (idempotent) + starts authFlow.

**Preserved verbatim** (per plan's Step C):

- `setAdminHotkeyHandler(openAdminPinModal)`
- `sessionResetMod.onPreReset(...)` WR-08 health-watchdog stop/re-arm wiring
- `require('./sessionReset').init(...)` and `require('./idleTimer').init(...)`
- `startHealthWatchdog(store)`
- All `ipcMain.handle` handlers: submit-credentials, verify-pin, request-pin-recovery, launch-touch-keyboard, verify-admin-pin, get-admin-diagnostics, admin-menu-action, close-admin-menu, submit-update-pat
- All `ipcMain.on` handlers: audit-sale-completed, idle-dismissed, idle-expired, request-reset-loop-recovery
- Render-process-gone recovery in magiclineView (still calls `hardReset` with no mode → default `'reset'` branch → view recreated — correct)

## Verification

**Automated pattern grep** (plan's `<verify>` script, all 7 checks):

```
patterns ok
```

Checks confirmed:
- `welcome:show` present (cold-boot send)
- `ipcMain.on('welcome:tap'` handler present
- `startLoginFlow` helper present
- `welcome:hide` send-on-tap present
- `splash:hide` cold-boot send present
- `ev.sender !== mainWindow.webContents` sender validation present
- `runAutoUpdaterInit` helper present

**Test suite:** `node --test test/*.test.js` → **285/285 passing** (0 failures, 0 regressions). Note: plan's `<verify>` specified `npm test`, but `package.json` has no `test` script (Phase 6 Plan 01 SUMMARY already documented this); `node --test` is the canonical runner (same command used by Plan 06-02's test run of 285/285).

**createMagiclineView call sites in main.js after the edit:**
- Line 423 (inside `startLoginFlow`) — the only call. No stray top-level call remains in `app.whenReady`.

**Trace (documented in plan's Step C):**

1. Cold boot → splash visible → `splash:hide` + `welcome:show` sent → welcome layer visible.
2. User taps → `welcome:tap` → main sends `welcome:hide` + `splash:show` → `createMagiclineView` + `authFlow.start`.
3. First-run-no-creds path: authFlow detects no creds → `show-credentials-overlay` IPC → credentials overlay (layer 400) covers splash.
4. User submits creds → authFlow persists + transitions to BOOTING → Magicline loads → cash register ready → splash hides via existing Magicline `did-finish-load` path in host.js.
5. Idle 60s → "Noch da?" 10s countdown → idleTimer.expired → sessionReset welcome-mode → Magicline view destroyed → `welcome:show` emitted by sessionReset itself (not main).
6. Tap again → full fresh login cycle.

## Decisions Realised

| D-XX | Behavior |
|------|----------|
| D-03 | Cold boot lands on welcome; no pre-warmed Magicline view; first tap pays full ~3–5s login latency |
| D-05 (orchestration half) | `welcome:tap` IPC handler is the sole entry into the login flow; `startLoginFlow` reused between cold-boot first-tap and post-reset-reset re-entries |

## Deviations from Plan

None. Plan executed exactly as written. The plan's `<verify>` automated check specified `npm test`, but the project has no `test` script (already-documented fact from Phase 6 Plan 01 SUMMARY); `node --test test/*.test.js` was used instead as the canonical runner and 285/285 passed.

## Known Stubs

None. All code paths in the refactor are wired end-to-end against existing Phase 1–5 modules.

## Threat Flags

No new surface beyond the registered threat model (T-06-12 through T-06-17 — all mitigated or explicitly accepted in the plan's `<threat_model>`). The `welcome:tap` handler mitigates T-06-12 via `ev.sender` validation exactly as specified.

## Commits

> **Note:** Executor sandbox denied `git commit` during this run (same transient condition that affected Plan 06-02 Task 2). The orchestrator is expected to hand-commit the staged `src/main/main.js` + `.planning/phases/06-welcome-screen-lifecycle-redesign/06-03-SUMMARY.md` using the provided messages:
>
> 1. Code: `feat(phase-06-03): cold boot lands on welcome + welcome:tap handler`
> 2. Summary: `docs(phase-06-03): summary`

## Self-Check: PASSED

- src/main/main.js: FOUND (7/7 required patterns, no stray top-level createMagiclineView)
- test suite: 285/285 PASS
- .planning/phases/06-welcome-screen-lifecycle-redesign/06-03-SUMMARY.md: FOUND (this file)
- Marker discipline: honoured — all edits below `// --- ORCHESTRATION` marker at line 239; `createMainWindow` untouched
- Preserved wiring (spot-checked via grep): setAdminHotkeyHandler, sessionResetMod.onPreReset, idleTimer.init, startHealthWatchdog, all ipcMain.handle + ipcMain.on handlers listed in plan Step C
