---
status: issues_found
phase: 04-nfc-input-idle-session-lifecycle
depth: standard
files_reviewed: 18
findings:
  critical: 1
  warning: 4
  info: 8
  total: 13
reviewed_at: 2026-04-10
---

# Phase 04 Code Review

**Status:** issues_found — 1 critical, 4 warning, 8 info across 18 files (12 source + 6 tests).

Phase 4 wires `badgeInput`, `idleTimer`, and `sessionReset` into a coherent lifecycle with solid automated coverage (102/102 across the Phase 4 suite + 100-cycle harness). The state machines are well-isolated, NFC-03 sentinel-null is correct, and the logging-hygiene contract (badge content never logged) is honored. Two real correctness bugs surfaced in the reset/teardown path.

---

## Critical

### CR-01: `WebContentsView` leak across every session reset

**Files:** `src/main/magiclineView.js:433-452` (`destroyMagiclineView`), `src/main/magiclineView.js:144` (`addChildView`)

`destroyMagiclineView` clears module state but never removes the child view from `mainWindow.contentView` nor destroys its `webContents`. On the next `createMagiclineView` call (step 10 of `hardReset`), a new view is added on top of the orphaned one. Each reset cycle:

- Orphaned `WebContentsView` + `webContents` remain composited on the host window.
- Old webContents still has `before-input-event` (badgeInput, lockdown), `render-process-gone`, `dom-ready`, `did-navigate-in-page` listeners attached. A stray `render-process-gone` on the orphan can re-trigger `sessionReset.hardReset({reason:'crash'})` and trip the reset-loop guard on its own.
- Duplicate `idleTimer.bump()` via shared module buffer in `badgeInput.js` if any stray key reaches the orphan.
- Memory + GPU growth across long kiosk uptime.

The 100-cycle harness does NOT catch this because it mocks `destroyMagiclineView` / `createMagiclineView` as no-ops.

**Fix sketch:**

```js
function destroyMagiclineView(mainWindow) {
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  if (mainWindow && resizeHandler) {
    try { mainWindow.removeListener('resize', resizeHandler); } catch (e) {}
  }
  if (magiclineView) {
    try {
      if (mainWindow?.contentView?.removeChildView) {
        mainWindow.contentView.removeChildView(magiclineView);
      }
    } catch (e) { log.warn('magicline.view.removeChildView failed: ' + (e && e.message)); }
    try {
      const wc = magiclineView.webContents;
      if (wc && !wc.isDestroyed() && typeof wc.close === 'function') wc.close();
    } catch (e) { log.warn('magicline.view.wc.close failed: ' + (e && e.message)); }
  }
  resizeHandler = null;
  magiclineView = null;
  readyFired = false;
  driftActive = false;
  revealed = false;
  hideCssKey = null;
  log.info('magicline.view.destroyed');
}
```

Regression test: real (or closer-to-real) fake `contentView` tracking `addChildView`/`removeChildView` across 3+ `hardReset` cycles.

---

## Warnings

### WR-01: Reset-loop admin recovery PIN flow never reaches `app.relaunch`

**Files:** `src/main/main.js:251-275`, `src/main/preload.js:26`, `src/host/host.js:289-357`

The reset-loop recovery chain is wired only halfway:

1. `sessionReset.hardReset` sends `show-magicline-error { variant:'reset-loop' }`.
2. `host.js` shows the overlay with a "PIN eingeben" button → calls `window.kiosk.requestResetLoopRecovery()`.
3. `main.js` line 251 receives `request-reset-loop-recovery` and sends `show-pin-modal` with `{ context:'reset-loop' }`.
4. **`preload.js:26`** drops the payload: `onShowPinModal: (cb) => ipcRenderer.on('show-pin-modal', () => cb())`. `host.js` `showPinModal` takes no argument and never learns the reset-loop context.
5. On correct PIN, `host.js` calls `window.kiosk.verifyPin(...)` (invoke channel `verify-pin`) → `authFlow.handlePinAttempt` → `pin-ok` reducer side-effect → transitions to NEEDS_CREDENTIALS and shows credentials overlay.
6. `main.js:265` `ipcMain.on('pin-ok', ...)` listens for `context:'reset-loop'` — but **no renderer code ever sends `pin-ok`**. `app.relaunch()` is unreachable.

Net effect: after the reset-loop banner, correct PIN silently punts the user to the credentials overlay instead of relaunching. Loop-latched state remains until the Windows user logs out / machine reboots, blocking further resets.

**Fix (option a):** Expose `notifyResetLoopPinOk(pin)` in preload, wire host.js reset-loop path to it, verify PIN in main, then `app.relaunch() + app.quit()`. Add an integration test: trip loop → `request-reset-loop-recovery` → verify PIN → assert `app.relaunch` invoked.

### WR-02: `badgeInput` shared module state persists across `hardReset`

**Files:** `src/main/badgeInput.js:51-73`, `src/main/main.js:141`, `src/main/magiclineView.js:178`

Module-level `buffer`, `lastKeyTime`, `bufferTimer`, `productSearchFocused` are shared across any attached webContents. During `hardReset`, the Magicline child view is torn down and rebuilt. Mid-reset keystrokes on the host wc call `commitBuffer(hostWc)`, which runs `document.querySelector('[data-role="customer-search"] input')` on the HOST renderer where that selector doesn't exist and `__bskiosk_setMuiValue` is not injected. The inner guard prevents a crash (silent no-op) but violates the "badge always commits to Magicline" invariant.

**Fix:** Add `badgeInput.resetBuffer()` called from `sessionReset.hardReset` between destroy and recreate, OR short-circuit `commitBuffer` when the committing wc is not the Magicline child (compare via `getMagiclineWebContents()`).

### WR-03: `attachBadgeInput` silently re-attaches on the same webContents

**Files:** `src/main/badgeInput.js:75-109`, `src/main/magiclineView.js:178`

No guard against double-attachment. Related to CR-01 — if `createMagiclineView` were ever re-entered without destroy, every keystroke would trigger N bumps + N commit attempts.

**Fix:** `WeakSet` guard:

```js
const attachedWcs = new WeakSet();
function attachBadgeInput(wc) {
  if (attachedWcs.has(wc)) { log.warn('badgeInput.attach: already attached, skipping'); return; }
  attachedWcs.add(wc);
  wc.on('before-input-event', ...);
}
```

### WR-04: `sessionReset.hardReset` can throw out of `createMagiclineView` → kiosk stuck in no-view state

**Files:** `src/main/sessionReset.js:140`, `src/main/magiclineView.js:102-223`

Step 10 `createMagiclineView(mainWindow, store)` can throw (e.g., `WebContentsView` constructor, sync `loadURL` error). `hardReset`'s `try/finally` clears `resetting` but lets the error propagate. Caller `idleTimer.expired()` doesn't await/catch → unhandled rejection → kiosk with no view, splash still showing, render-process-gone listener gone with the dead view. Staff intervention required.

**Fix:** Wrap step 10 in its own try/catch, log an error, surface `show-magicline-error` variant for "kiosk must restart" — or close+recreate the main window as a safer recovery.

---

## Info

### IN-01: `badgeInput` schedules a 100ms silent-timeout on every non-buffered keystroke

**File:** `src/main/badgeInput.js:99-107`

When the admission condition is false, line 107 still schedules `commitBuffer` which early-returns at line 59. Harmless but adds a 100ms-delayed no-op per human keystroke outside a burst. Only schedule the timer inside the admission branch.

### IN-02: `idleTimer.dismiss()` logs a duplicate state transition

**File:** `src/main/idleTimer.js:77-81`

`dismiss()` logs `OVERLAY_SHOWING -> IDLE reason=dismissed`, then calls `start()` which logs `IDLE -> IDLE reason=start`. Minor noise for the Phase 5 audit parser.

### IN-03: `idleTimer.start()` unconditionally logs same-state transitions

**File:** `src/main/idleTimer.js:57-62`

`IDLE -> IDLE reason=start` emitted when called from `authFlow.start-idle-timer` after cash-register-ready. Same fix as IN-02: skip log when transition is to the same state.

### IN-04: `authFlow` documents a `login-failed` text-match signal that inject.js never emits

**Files:** `src/main/authFlow.js:29-31` + reducer branches 148/176; `src/inject/inject.js`; `src/main/magiclineView.js:69-81` `KNOWN_EVENT_TYPES`

Doc comment claims "Failure detection uses a text-match primary signal emitted by inject.js as `login-failed`". Reality: `inject.js` never calls `emit('login-failed', ...)` and `KNOWN_EVENT_TYPES` doesn't contain it — any such emit would be dropped as `magicline.inject.unknown-event-type`. Every login failure waits for the 8s watchdog. Phase 3 territory; flagged because the files are in scope.

**Fix:** Implement the text-match scanner in inject.js + add `'login-failed'` to `KNOWN_EVENT_TYPES`, OR delete the doc claim.

### IN-05: `sessionReset.hardReset` does not validate `mainWindow.webContents` before `.send`

**File:** `src/main/sessionReset.js:91-93, 111`

Step 5 sends `splash:show` in a bare try/catch. In a post-close-before-quit race, `mainWindow.webContents` may be destroyed. Guard with `if (mainWindow.webContents && !mainWindow.webContents.isDestroyed())` — pattern already used in `idleTimer.onTimeout`.

### IN-06: `main.js` `ipcMain.on('pin-ok', ...)` is unreachable dead code

**File:** `src/main/main.js:265-275`

See WR-01. The listener + its `log.warn('ipc.pin-ok: ignored payload without reset-loop context')` will never fire in the current wiring.

### IN-07: `badgeInput` module-scoped state couples tightly to the single-window kiosk invariant

**File:** `src/main/badgeInput.js:45-49`

Intentional (D-01). Note: if the kiosk ever grows a second BrowserWindow, the shared buffer will leak NFC scans. Consider a test asserting `attachBadgeInput` is called exactly twice during startup (host + Magicline).

### IN-08: `magiclineView.createMagiclineView` silently returns existing instance on re-entry

**File:** `src/main/magiclineView.js:103-106`

Combined with CR-01, a misuse passing a stale `mainWindow` would silently return the old instance wired to the old window. Either throw on re-entry forcing callers to destroy first, or fold into the CR-01 fix so re-entry becomes safe.

---

## Files Reviewed

`src/main/badgeInput.js`, `src/main/idleTimer.js`, `src/main/sessionReset.js`, `src/main/magiclineView.js`, `src/main/authFlow.js`, `src/main/main.js`, `src/main/preload.js`, `src/inject/inject.js`, `src/inject/fragile-selectors.js`, `src/host/host.html`, `src/host/host.css`, `src/host/host.js`, `test/badgeInput.test.js`, `test/idleTimer.test.js`, `test/sessionReset.test.js`, `test/authFlow.test.js`, `test/sessionReset.harness.js`, `test/phase4-integration.test.js`
