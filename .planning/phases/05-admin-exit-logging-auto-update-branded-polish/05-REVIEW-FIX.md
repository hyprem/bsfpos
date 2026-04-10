---
phase: 05-admin-exit-logging-auto-update-branded-polish
fixed_at: 2026-04-10T00:00:00Z
review_path: .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-04-10
**Source review:** .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (2 critical + 8 warnings; info findings excluded by fix_scope)
- Fixed: 10
- Skipped: 0
- Regression suite: `node --test test/*.test.js` → 265/265 passing (baseline preserved)

## Fixed Issues

### CR-01: PAT value passed into audit log

**Files modified:** `src/main/main.js`
**Commit:** c721739
**Applied fix:** Replaced `log.audit('update.pat.configured', { pat: pat })` with `{ length: pat.length }` so the raw secret never enters the logger at all. Belt-and-braces: the `CIPHER_FIELDS` redactor remains as a second line of defence, but the leak surface (including incidental length disclosure under any rename) is eliminated at the call site.

### CR-02: Legacy `verify-pin` IPC bypasses admin PIN lockout

**Files modified:** `src/main/main.js`
**Commit:** c973211
**Applied fix:** Rewrote the `verify-pin` IPC handler to route ALL PIN material through `adminPinLockout.verifyPinWithLockout` instead of calling `adminPin.verifyPin` directly. Preserved both success branches: (a) `resetLoopPending` → `app.relaunch()` + `app.quit()`, and (b) Phase 3 `authFlow.notify({type:'pin-ok'})` for the `pin-recovery` state transition. On lockout, emits `pin.lockout` audit + sends `show-pin-lockout` IPC (same payload shape as the `verify-admin-pin` path, so the host's existing `onShowPinLockout` listener paints over the modal). Lockout counter is now UNIFIED across both IPC channels — brute-forcing via `verify-pin` is no longer possible.

**Logic verification note:** This fix changes the PIN verification routing. Manual smoke test recommended to confirm (a) reset-loop PIN entry still triggers relaunch, (b) Phase 3 pin-recovery still transitions authFlow, (c) 5 failed attempts via verify-pin now trigger the 5-minute lockout panel.

### WR-01: Admin-hotkey listener not re-attached on view recreation

**Files modified:** `src/main/main.js`, `src/main/magiclineView.js`
**Commit:** e17faa5
**Applied fix:** Moved the Ctrl+Shift+F12 `before-input-event` listener into `createMagiclineView()` so every newly-constructed child webContents automatically gets it. Added a module-scoped `adminHotkeyHandler` callback plus a `setAdminHotkeyHandler(fn)` export from magiclineView.js. main.js now calls `setAdminHotkeyHandler(openAdminPinModal)` ONCE before the first `createMagiclineView` invocation; magiclineView re-applies the listener on every recreation (post-`sessionReset.hardReset`), so the hotkey no longer silently stops working after the first session reset.

### WR-02: Update-failed IPC send does not check `isDestroyed()`

**Files modified:** `src/main/main.js`
**Commit:** a60eb37
**Applied fix:** Added `if (!mainWindow || mainWindow.isDestroyed()) return;` guard at the top of the `onUpdateFailed` callback. The inner try/catch is preserved as a belt-and-braces around a legitimate IPC send; the guard prevents the catch from swallowing shutdown-race errors.

### WR-03: `admin.exit` audit event emitted for every admin menu action

**Files modified:** `src/main/main.js`
**Commit:** 5ad5230
**Applied fix:** Renamed the per-action dispatch audit event to `admin.action` (with `{action: '...'}` payload). Reserved `admin.exit` exclusively for the `exit-to-windows` branch, emitted as an empty-payload event at the top of that case. Log parsers can now cleanly count real kiosk exits.

### WR-04: `view-logs` leaves kiosk mode disabled

**Files modified:** `src/main/main.js`
**Commit:** cb0c967
**Applied fix:** Removed the `app.setKiosk(false)` call from the `view-logs` admin action. Explorer opens as a separate process and will appear behind the kiosk window; if the admin needs to see it they can use `exit-to-windows`. This eliminates the production security regression where the kiosk would stay out of kiosk mode for subsequent member sessions after an admin opened the logs folder.

### WR-05: `update-available` silently triggers full binary download

**Files modified:** `src/main/autoUpdater.js`
**Commit:** 4a2d4f2
**Applied fix:** Expanded the comment on the `updater.on('update-available')` handler into a multi-line SURPRISE warning explaining that every check-on-available triggers a multi-MB download, that the admin UI copy does not make this visible, and what to do if it becomes a problem on a metered kiosk connection. No functional change — the behaviour remains as designed (autoDownload=false solely so we control the kick-off), but the surprise is now documented loudly at the call site.

### WR-06: `resetLoopPending` latch not cleared by `request-pin-recovery`

**Files modified:** `src/main/main.js`
**Commit:** 38e0f9a
**Applied fix:** Added `resetLoopPending = false;` at the top of the `request-pin-recovery` IPC handler. This prevents the branch collision where a user triggering pin-recovery while the reset-loop modal is visible would cause the next verify-pin success to take the relaunch path instead of the credentials overlay path.

### WR-07: `adminPinLockout.verifyPinWithLockout` non-atomic read-modify-write

**Files modified:** `src/main/adminPinLockout.js`
**Commit:** 999d0e8
**Applied fix:** Added a multi-line safety comment above `verifyPinWithLockout` explicitly anchoring the assumptions that make the R-M-W safe: (1) `app.requestSingleInstanceLock` prevents a second main process from racing, and (2) `ipcMain.handle` channels run on the single-threaded main event loop so no concurrent PIN attempts can interleave. Includes a forward-looking note that fan-out to worker threads or a second BrowserWindow would require an in-process mutex around the cycle.

### WR-08: `healthWatchdogTimer` / `authPollTimer` not cleared on hard reset

**Files modified:** `src/main/main.js`, `src/main/sessionReset.js`
**Commit:** 699662f
**Applied fix:** Added an append-only `onPreReset(cb)` subscriber API to sessionReset.js (complementing the existing single-slot `onPostReset` which is owned by updateGate). Pre-reset subscribers fire synchronously at the top of a non-suppressed `hardReset`, after the loop-detect guard but before the teardown mutex. main.js registers two pre-reset hooks: (1) clear both `healthWatchdogTimer` and `authPollTimer` so they do not fire against a detached webContents, and (2) a 500ms-delayed re-check of `pendingUpdate` that re-arms `startHealthWatchdog` if the update is still mid-flight. Eliminates the race where a single ill-timed hard reset during the post-update window could latch `autoUpdateDisabled=true`.

**Logic verification note:** The 500ms delay is a timing heuristic — short enough to re-arm before the watchdog deadline, long enough for `createMagiclineView` to have finished rebuilding the child view. Manual smoke test recommended on the real kiosk.

---

_Fixed: 2026-04-10_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
