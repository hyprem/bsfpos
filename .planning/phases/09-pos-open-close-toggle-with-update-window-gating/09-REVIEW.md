---
phase: 09-pos-open-close-toggle-with-update-window-gating
reviewed: 2026-04-20T12:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/main/updateGate.js
  - src/main/main.js
  - src/main/preload.js
  - src/main/sessionReset.js
  - src/host/host.html
  - src/host/host.css
  - src/host/host.js
  - test/updateGate.test.js
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-04-20T12:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed the Phase 09 POS open/close toggle with update window gating feature across 8 files. The implementation is generally solid -- the updateGate module is well-isolated and testable, the preload API surface is clean, and the host.js renderer correctly handles POS state transitions. The main concerns are: a command injection vector in the TabTip launcher, a state synchronization gap on the POS close confirmation overlay, and a potential double-fire on the welcome screen tap handler.

## Critical Issues

### CR-01: Command injection via child_process.exec for TabTip

**File:** `src/main/main.js:699`
**Issue:** `child_process.exec()` is used instead of `child_process.execFile()` to launch TabTip.exe. While the command string is currently hardcoded (no user input flows into it), `exec()` spawns a shell and is the wrong API for launching a known executable at a fixed path. If this pattern is copied or the path ever becomes configurable, it becomes a command injection vector. Additionally, the double-escaped backslashes (`C:\\\\Program Files\\\\...`) produce the literal path `C:\\Program Files\\...` which is incorrect on Windows -- it should be `C:\Program Files\...`.
**Fix:**
```js
// Replace exec() with execFile() -- no shell, no injection surface
child_process.execFile(
  'C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe',
  [],
  (err) => {
    if (err) {
      log.warn('ipc.launch-touch-keyboard execFile failed: ' + (err && err.message));
      resolve({ ok: false, error: String(err && err.message) });
    } else {
      log.info('ipc.launch-touch-keyboard: tabtip launched');
      resolve({ ok: true });
    }
  }
);
```

## Warnings

### WR-01: POS close confirm overlay not dismissed on IPC-driven admin menu hide

**File:** `src/host/host.js:659-667`
**Issue:** `hideAdminMenu()` correctly calls `hidePosCloseConfirm()` (line 666), which handles the case where the admin menu is closed while the confirm overlay is showing. However, when `toggle-pos-open` is invoked from the confirm "Ja, schliessen" button (lines 935-943), the confirm overlay is hidden but the admin menu remains visible and the toggle button is updated in-place. If the IPC call to `adminMenuAction('toggle-pos-open')` fails or returns `{ok: false}`, the confirm overlay is still hidden (line 939 runs unconditionally) but the POS state is not updated, leaving the button label out of sync with the actual store value.
**Fix:**
```js
posConfirmYes.addEventListener('click', function () {
  if (window.kiosk && window.kiosk.adminMenuAction) {
    window.kiosk.adminMenuAction('toggle-pos-open').then(function (result) {
      if (result && result.ok) {
        hidePosCloseConfirm();
        posOpenState = result.posOpen;
        updatePosToggleButton(result.posOpen);
      } else {
        // Still hide confirm but show an error or keep state consistent
        hidePosCloseConfirm();
      }
    });
  }
});
```

### WR-02: Welcome screen double-fire from pointerdown + touchstart on touch devices

**File:** `src/host/host.js:1082-1083`
**Issue:** Both `pointerdown` and `touchstart` are bound to `handleWelcomeTap` on the welcome screen element. On touch devices, a single finger tap fires both events. While `enterSplashPendingMode()` has a re-entry guard (`if (splashPendingMode) return`), `notifyWelcomeTap()` is called twice, sending two `welcome:tap` IPC messages to main. In main.js the handler sets `welcomeTapPending = true` and calls `startLoginFlow()` twice. `createMagiclineView` is documented as idempotent and `authFlow.start` re-seeds state, so this is not a crash, but it's wasteful and produces duplicate log entries.
**Fix:** Use only `pointerdown` (which fires for both mouse and touch on modern Chromium) and remove the `touchstart` binding, or add a debounce/guard in `handleWelcomeTap`:
```js
var welcomeTapFired = false;
function handleWelcomeTap(ev) {
  if (welcomeTapFired) return;
  welcomeTapFired = true;
  // ... existing logic ...
  // Reset on next welcome:show
}
```

### WR-03: posOpenState in host.js can drift from store truth on error paths

**File:** `src/host/host.js:142-143`
**Issue:** `applyPosState` sets `posOpenState = posOpen` at line 142, but the POS toggle button click handler at line 921 uses `posOpenState` to decide whether to show the confirm dialog. If `adminMenuAction('toggle-pos-open')` succeeds on the main side but the IPC response is lost (e.g., window destroyed mid-flight), `posOpenState` in the renderer will be stale. The `pos-state-changed` IPC subscription (lines 1141-1146) would correct this on the next welcome:show, but during the same admin session the button would show the wrong action. This is a minor race but worth noting for a kiosk where the admin menu is the only control surface.
**Fix:** After any `toggle-pos-open` action, refresh diagnostics to re-sync state:
```js
// After toggle, always refresh diagnostics to ensure sync
if (window.kiosk && window.kiosk.getAdminDiagnostics) {
  window.kiosk.getAdminDiagnostics().then(function(d) { if (d) renderDiagnostics(d); });
}
```

## Info

### IN-01: Commented-out / dead code pattern in hideSplashFinal

**File:** `src/host/host.js:74`
**Issue:** `try { void payload; } catch (_) {}` is a no-op statement that exists only as a placeholder for future use. The try/catch around `void` can never throw. This is harmless but reads as dead code.
**Fix:** Remove the try/catch or replace with a comment:
```js
// payload: { degraded: bool } — reserved for future use
```

### IN-02: Test file monkey-patches global.setInterval without error-path coverage

**File:** `test/updateGate.test.js:81-109`
**Issue:** Multiple tests monkey-patch `global.setInterval` and `global.clearInterval`. If an assertion throws before the `finally` block restores them, subsequent tests in the same process could break. The current structure with try/finally is correct, but the fake timer IDs (`'fake-timer'`, `'fake-timer-2'`, etc.) mean `clearInterval` in production code receives a string instead of a number. This works because the test's `clearInterval` checks `id === 'fake-timer'`, but it silently masks any bug where `clearInterval` is called with the wrong ID.
**Fix:** Consider using a shared test helper that returns numeric IDs and tracks clear calls, or use Node's built-in `mock.timers` API (available in Node 20+) for more robust timer testing.

---

_Reviewed: 2026-04-20T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
