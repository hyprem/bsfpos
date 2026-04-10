---
phase: 05-admin-exit-logging-auto-update-branded-polish
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - src/host/host.css
  - src/host/host.html
  - src/host/host.js
  - src/inject/inject.js
  - src/main/adminPinLockout.js
  - src/main/authFlow.js
  - src/main/autoUpdater.js
  - src/main/badgeInput.js
  - src/main/credentialsStore.js
  - src/main/keyboardLockdown.js
  - src/main/logger.js
  - src/main/magiclineView.js
  - src/main/main.js
  - src/main/preload.js
  - src/main/sessionReset.js
  - src/main/updateGate.js
  - package.json
findings:
  critical: 2
  warning: 8
  info: 13
  total: 23
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-04-10
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Overall the code is carefully written with explicit attention to security-critical concerns (DPAPI, PIN lockout persistence, PAT redaction, CSP, context isolation). Several meaningful issues found relating to PAT handling in logs, audit taxonomy correctness, a lockout bypass via the legacy `verify-pin` IPC path, and listener/timer lifecycle issues across window recreation. None are catastrophic, but CR-01 and CR-02 are security-relevant and should be fixed before production.

## Critical Issues

### CR-01: PAT value passed into audit log — relies on redactor allowlist as sole defence

**File:** `src/main/main.js:662`
**Issue:** `log.audit('update.pat.configured', { pat: pat });` passes the plaintext PAT as a field value. It is currently redacted to `[cipher:<N>]` because `logger.js` `CIPHER_FIELDS` includes `'pat'`, but this is a fragile single-point-of-failure defence: any rename (`patValue`, `token2`) would write the raw PAT to the on-disk audit log. Even when redacted, emitting the exact PAT length is an information leak that narrows brute-force assumptions about GitHub fine-grained token format. Never pass the raw secret into the logger at all.

**Fix:**
```js
// main.js:662
log.audit('update.pat.configured', { length: pat.length });
```
Additionally consider adding a dev-mode assertion in `logger.js._redactValue` that throws if any value matching a plausible PAT pattern (e.g. `^github_pat_`) is passed through, regardless of field name.

### CR-02: Legacy `verify-pin` IPC bypasses admin PIN lockout entirely

**File:** `src/main/main.js:430-456`, `src/main/authFlow.js:469-482`
**Issue:** The Phase 3 `verify-pin` handler calls `authFlow.handlePinAttempt(pin)` which calls `adminPin.verifyPin(store, pin)` directly with NO rate limiting. The whole point of Phase 5 `adminPinLockout` is to rate-limit admin PIN attempts, but `preload.js:32` unconditionally exposes the `verifyPin` renderer method. Any code path that routes admin PIN through `verifyPin` (or an attacker that can reach the channel) brute-forces the PIN at full speed, completely defeating the new lockout module. This also makes lockout state inconsistent: failed attempts via `verify-pin` never increment the counter, and successful attempts via `verify-pin` never reset it.

**Fix:** Route admin-PIN verification exclusively through `adminPinLockout.verifyPinWithLockout` for every IPC channel, including the Phase 3 legacy path. For the reset-loop branch, also wrap with the lockout:
```js
// main.js verify-pin handler — wrap both branches with the lockout
const result = adminPinLockout.verifyPinWithLockout(store, pin);
if (result.locked) {
  try {
    mainWindow.webContents.send('show-pin-lockout', {
      lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null,
    });
  } catch (_) {}
  return { ok: false, locked: true };
}
if (!result.ok) {
  if (resetLoopPending) return { ok: false };
  authFlow.notify({ type: 'pin-bad' });
  return { ok: false };
}
// result.ok
if (resetLoopPending) {
  resetLoopPending = false;
  app.relaunch(); app.quit();
  return { ok: true };
}
authFlow.notify({ type: 'pin-ok' });
return { ok: true };
```

## Warnings

### WR-01: Admin-hotkey `before-input-event` listeners not re-attached on view/window recreation

**File:** `src/main/main.js:320-326, 370-376`
**Issue:** The `before-input-event` admin-hotkey listeners are added inside the `app.whenReady()` closure once, against the current `mainWindow` and `magiclineView.webContents`. The magiclineView webContents is destroyed and recreated on every `sessionReset.hardReset()` (see `destroyMagiclineView` + `createMagiclineView`), so after any hard reset the Ctrl+Shift+F12 hotkey no longer works on the Magicline child view — only the host wc fallback and the `globalShortcut` registration survive. The global shortcut is a partial safety net, but if it fails to register (log.warn at line 299) the admin can be locked out of the kiosk after the first reset.

**Fix:** Move the admin-hotkey attachment into `createMagiclineView()` alongside `attachLockdown` so every newly-created webContents automatically gets it. Export `openAdminPinModal` or pass it through as a dep.

### WR-02: Update-failed IPC send does not check `mainWindow.isDestroyed()`

**File:** `src/main/main.js:96-102`
**Issue:** `onUpdateFailed` callback sends `show-magicline-error` via `mainWindow.webContents.send`. If the updater fires after shutdown or window close, `mainWindow` may be destroyed. The try/catch will swallow the throw, but also swallow other programming errors silently.

**Fix:**
```js
onUpdateFailed: (err) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send('show-magicline-error', { variant: 'update-failed' }); }
  catch (e) { log.error('update-failed variant send failed: ' + (e && e.message)); }
},
```

### WR-03: `admin.exit` audit event emitted for EVERY admin menu action, not only actual exit

**File:** `src/main/main.js:582`
**Issue:** `log.audit('admin.exit', { action: String(action) })` fires for all actions (check-updates, view-logs, reload, etc.), not only `exit-to-windows`. The canonical taxonomy in `logger.js` comment defines `admin.exit` as a distinct event pair with `admin.open`. This pollutes the taxonomy and makes it impossible to count real kiosk exits from logs.

**Fix:** Use `admin.action` for button taps and reserve `admin.exit` for the actual exit case:
```js
log.audit('admin.action', { action: String(action) });
// ... later
case 'exit-to-windows': {
  log.audit('admin.exit', {});
  // ... existing quit code
}
```

### WR-04: `view-logs` action leaves hooks unchanged but does not re-enter kiosk after Explorer closes

**File:** `src/main/main.js:596-602`
**Issue:** `app.setKiosk(false)` is called to let Explorer render above the kiosk window, but there is no re-enable path — after the admin closes Explorer the kiosk stays out of kiosk mode for the next member session, exposing taskbar and window controls. This is a real production security regression on an unattended kiosk.

**Fix:** Either (a) restore `app.setKiosk(true)` after a short delay / on next focus, (b) remove the setKiosk toggle entirely and let Explorer open behind the kiosk window (admin can use exit-to-windows if they need to see it), or (c) track state so the next `show` event re-enters kiosk mode. Option (b) is safest:
```js
case 'view-logs': {
  // Explorer opens as a separate process — no need to leave kiosk mode.
  try { await shell.openPath(app.getPath('logs')); }
  catch (e) { log.error('shell.openPath failed: ' + (e && e.message)); return { ok: false, error: String(e && e.message) }; }
  return { ok: true };
}
```

### WR-05: `checkForUpdates()` admin button silently triggers a full binary download

**File:** `src/main/autoUpdater.js:78-85, 131-146`
**Issue:** The `update-available` event handler unconditionally calls `updater.downloadUpdate()`. A plain admin "Updates prüfen" tap thus always triggers a download if an update exists. The admin UI copy says "wird bei nächster Ruhepause installiert" so the intent is visible, but the comment on line 81 ("Kick off download explicitly since autoDownload=false") hides the significance. On a metered or flaky kiosk connection this is expensive and surprising.

**Fix:** Make the comment loud about the surprise and consider gating behind an admin confirmation, or separate "check" from "check + download".

### WR-06: `resetLoopPending` latch cleared only by `verify-pin`, not by `request-pin-recovery`

**File:** `src/main/main.js:28, 458-465, 495-506`
**Issue:** `resetLoopPending` is set by `request-reset-loop-recovery` and cleared only on successful verify-pin. If the user calls `requestPinRecovery` (different preload method) while the reset-loop modal is showing, the flag stays set. The next `verify-pin` success will then take the reset-loop branch and call `app.relaunch() + app.quit()` instead of entering the credentials overlay — an unexpected branch collision.

**Fix:** Clear `resetLoopPending = false` in the `request-pin-recovery` handler, or make the two flows mutually exclusive at the PIN modal level (pass context through to main and branch there).

### WR-07: `adminPinLockout.verifyPinWithLockout` reads and writes store non-atomically

**File:** `src/main/adminPinLockout.js:53-101`
**Issue:** Classic read-modify-write. `electron-store` guarantees atomic single `set`, but between `readState` (line 55) and `store.set` (line 91) any concurrent call would be lost. In practice this kiosk is single-renderer + single-instance-locked so it's safe, but the `T-05-10` comment on line 58 suggests this module is meant to be attacker-resilient. Worth an explicit comment anchoring the assumption.

**Fix:** Add a comment that the single-instance lock + renderer-only IPC access makes R-M-W safe; future fan-out must add locking.

### WR-08: `healthWatchdogTimer` / `authPollTimer` not cleared on `sessionReset.hardReset`

**File:** `src/main/main.js:131-165`, `src/main/sessionReset.js:67-161`
**Issue:** The Phase 5 post-update health watchdog runs a 2-minute timer plus a 2-second `authFlow.getState()` poller. If a hard reset lands during that window, the poller will keep running against the NEW view's authFlow, which may be correct — but the watchdog is not gated against resets, so a single ill-timed reset could cause the watchdog to expire and incorrectly latch `autoUpdateDisabled=true`.

**Fix:** Either (a) register the health watchdog as a post-reset listener via `sessionReset.onPostReset` so it re-starts cleanly after reset, or (b) clear both timers in `sessionReset.hardReset` and re-arm if `pendingUpdate` is still present.

## Info

### IN-01: PAT header-injection guard depends on `/\s/` also matching `\r\n`

**File:** `src/main/main.js:651`
**Issue:** `/\s/.test(pat)` rejects PATs containing whitespace, which incidentally blocks `\r\n` header injection into `updater.addAuthHeader('Bearer ' + opts.pat)`. This is only safe because `\s` matches CR/LF/tab. Worth an explicit comment anchoring this.

**Fix:** Comment: `// /\s/ rejects \r\n so addAuthHeader('Bearer ' + pat) cannot inject headers`

### IN-02: Numerous empty `catch (_) {}` blocks swallow programming errors

**File:** `src/main/main.js` (many lines: 541, 550, 561, 588, 592, 605, 610, 611, 616, 618, 625, 626, 643, 661, 670, 671, ...)
**Issue:** Defensive against destroyed windows but hides real bugs. A single helper would be cleaner and more consistent:
```js
function safeSend(ch, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send(ch, payload); }
  catch (e) { log.warn('ipc.send(' + ch + ') failed: ' + (e && e.message)); }
}
```

### IN-03: `preload.js` IPC listeners have no removal path

**File:** `src/main/preload.js:14-54`
**Issue:** All `onXxx` methods call `ipcRenderer.on(...)` with no off-switch. Safe in this single-host-page kiosk, but a comment noting the assumption would help future maintenance.

### IN-04: `authFlow.js` emits two audit log lines per transition with different schemas

**File:** `src/main/authFlow.js:282-284, 386-393`
**Issue:** The reducer emits a `log` side effect producing `event=auth.state state=X reason=Y`, and `notify()` independently emits `event=auth.state from=X to=Y reason=Z` on transitions. Same event name, two schemas, every transition. Downstream log parsing cannot assume a stable field set.

**Fix:** Drop the reducer-emitted `log` side effect (the executor already logs authoritatively), or rename it to `auth.reason` to distinguish from transition events.

### IN-05: Host PIN field `minlength` HTML attribute is informational only

**File:** `src/host/host.html:91`
**Issue:** `minlength="4" maxlength="6"` is not enforced by native form submission (there is no form submit), so the JS regex `/^[0-9]{4,6}$/` is the only guard. Fine, but the HTML attributes are decorative.

### IN-06: `host.js` mixes ES5 `var` with `async/await` and arrow functions

**File:** `src/host/host.js` (whole file)
**Issue:** Style inconsistency. `var` has function-scope bleed semantics; `let`/`const` would align with the async parts.

### IN-07: `magiclineView.js` uses `ipcMain.emit(...)` as an internal pub/sub

**File:** `src/main/magiclineView.js:230-232`
**Issue:** `ipcMain.emit('audit-sale-completed')` is a technically-valid but non-obvious way to dispatch a main-process-internal event. It abuses the IPC dispatcher as an EventEmitter. A direct function call or dedicated EventEmitter module would be clearer and type-safer.

### IN-08: Idle overlay dismisses on both `pointerdown` AND `touchstart` — duplicate fires

**File:** `src/host/host.js:716-718`
**Issue:** Modern browsers fire both events for a single touch. `dismissIdleOverlay` runs twice per tap, doubling IPC traffic. The operation is idempotent so nothing breaks, but it's wasted work.

**Fix:** Use only `pointerdown` — it is the unified modern pointer event.

### IN-09: Runtime dependencies use caret ranges, not tilde pinning

**File:** `package.json:16-20`
**Issue:** `"electron-log": "^5.2.0"`, `"electron-store": "^10.1.0"`, `"electron-updater": "^6.8.3"` allow minor upgrades. CLAUDE.md recommends tight pinning for reproducible kiosk builds. devDependencies correctly use `~`.

**Fix:** Switch to `~5.2.0` / `~10.1.0` / `~6.8.3`.

### IN-10: `logger.js` `String(value)` stringifies objects as `[object Object]`

**File:** `src/main/logger.js:89`
**Issue:** Non-allowlisted object values produce useless log output. All current call sites pass primitives, but a JSON.stringify fallback would be future-proof.

### IN-11: `verify-admin-pin` ordering — main fires hide/show IPCs before invoke resolves

**File:** `src/main/main.js:534-550`, `src/host/host.js:393-405`
**Issue:** On success, main fires `hide-pin-modal` + `show-admin-menu` then returns the invoke promise. Renderer receives the IPCs before `res.ok`. Host.js is careful to early-return on `res.ok` so the modal doesn't flash, but this ordering is subtle and timing-sensitive. Works today — worth a comment.

### IN-12: `inject.js` depends on `JETZT_VERKAUFEN_TEXT` from `fragile-selectors.js`

**File:** `src/inject/inject.js:95`
**Issue:** A missing `JETZT_VERKAUFEN_TEXT` constant would throw ReferenceError, caught by the outer try/catch so the kiosk fails safely. Noting for awareness — this is intentional drift-isolation.

### IN-13: `updateGate.js` module-scoped singleton state is not documented as a singleton

**File:** `src/main/updateGate.js:17-19`
**Issue:** `maintenanceTimer` / `postResetArmed` / `fired` are module-scoped, meaning you cannot run two gates simultaneously. Fine for the single-instance kiosk, but a `// MODULE IS A SINGLETON — single-instance lock guarantees this` comment would help future readers.

---

_Reviewed: 2026-04-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
