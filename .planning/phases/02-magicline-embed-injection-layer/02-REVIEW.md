---
phase: 02-magicline-embed-injection-layer
reviewed: 2026-04-09T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - package.json
  - src/host/host.html
  - src/host/host.css
  - src/host/host.js
  - src/main/preload.js
  - src/inject/inject.css
  - src/inject/fragile-selectors.js
  - src/inject/inject.js
  - src/main/magiclineView.js
  - src/main/main.js
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-04-09
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 2 cleanly implements the Magicline embed + injection layer per the CONTEXT/RESEARCH decisions. Security posture is solid: `contextIsolation: true`, `sandbox: true`, no `preload` on the child view, no raw `ipcRenderer` exposure in the host preload, CSP is set on host.html, and IPC events from the untrusted Magicline main world are whitelisted and never `eval`d. The drain-queue pattern is implemented idempotently and defensively.

No Critical issues were found. The Warnings are all reliability / dead-code concerns that could bite on later phases (window recreation, sidebar classification drift, stale IPC stub). Info items are minor quality improvements.

## Warnings

### WR-01: `cash-register-ready` ipcMain stub is dead code and diverges from Phase 2 wiring

**File:** `src/main/main.js:63-68`
**Issue:** The Phase 1 stub `ipcMain.on('cash-register-ready', ...)` is still registered, but Phase 2 bypasses it entirely — `magiclineView.handleInjectEvent` sends `splash:hide` directly to `mainWindow.webContents` when it sees a `cash-register-ready` drain event. No sender ever emits an ipcMain `cash-register-ready` channel message, so this handler is unreachable. It creates two concerning impressions: (1) a reader debugging splash-lift failures will set a breakpoint here and be confused when it never fires, and (2) if a future phase re-introduces an ipcMain sender it will silently race with the direct-send path, double-lifting or interleaving splash state.
**Fix:** Remove the stub (and its comment). Splash lift is now owned entirely by `magiclineView.handleInjectEvent`.
```js
// DELETE lines 60-68 of src/main/main.js
```

### WR-02: `nav.SidebarWrapper-sc-bb205641-0` is classified STABLE but is a styled-components hash — it is fragile

**File:** `src/inject/fragile-selectors.js:37` and `src/inject/inject.css:25`
**Issue:** The `SidebarWrapper-sc-bb205641-0` selector lives in the `STABLE_SELECTORS` array and in the "STABLE data-role selectors" section of `inject.css`. The `-sc-<hash>-0` suffix is a styled-components generated class name, which drifts on version bumps exactly like MUI `css-xxxxx` hashes. Misclassifying it as stable means: (a) future developers will treat a sidebar drift as a "should not happen" regression rather than the routine rename it actually is, and (b) if Magicline renames it, `selfCheck()` will still correctly emit a drift event (good), but the drift overlay will trigger for what looks like a "stable" selector and the runbook lookup will be wrong.
**Fix:** Move this selector into `FRAGILE_SELECTORS` in `fragile-selectors.js` and into the FRAGILE section of `inject.css`. Prefer a structural fallback if available (e.g., `[data-role="sidebar"]` if Magicline exposes one) — if none exists, still re-categorize as fragile.
```js
// fragile-selectors.js — move this entry from STABLE_SELECTORS to FRAGILE_SELECTORS
{ category: 'fragile', selector: 'nav.SidebarWrapper-sc-bb205641-0', fallback: null, purpose: 'Left sidebar' }
```

### WR-03: `resize` listener and `drainTimer` are never cleaned up; module state leaks on window teardown

**File:** `src/main/magiclineView.js:112-113, 45-46, 203-223`
**Issue:** `createMagiclineView` attaches `mainWindow.on('resize', resizeHandler)` and starts a `setInterval` drain timer, but neither is removed on `mainWindow`'s `closed` event, and the module-scoped `magiclineView = null; drainTimer = null; readyFired = false; driftActive = false;` are never reset. Phase 4 (and the auto-recovery paths in later phases) plan to tear down and recreate the main window on crash/hang recovery. When that happens today:
  1. The old `resizeHandler` closure still holds a reference to the dead `mainWindow` and to the destroyed `magiclineView`, preventing GC.
  2. The `drainTimer` keeps firing against the destroyed webContents; the `wc.isDestroyed()` guard clears it on the next tick, but in the meantime `createMagiclineView` sees the stale non-null `magiclineView` module variable and hits the early-return "already created" warning instead of building a fresh instance.
  3. `readyFired` / `driftActive` flags persist across window recreations, so a recovered kiosk will never lift its splash again because `readyFired === true` from the dead session.
**Fix:** Add a teardown path that clears all module state on the main window's `closed` event, and unhook the resize listener. Best approach is a `destroyMagiclineView()` export wired into `mainWindow.once('closed', ...)`:
```js
// magiclineView.js
function destroyMagiclineView(mainWindow) {
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  if (mainWindow && resizeHandler) mainWindow.removeListener('resize', resizeHandler);
  magiclineView = null;
  readyFired    = false;
  driftActive   = false;
}
// inside createMagiclineView, hoist resizeHandler to module scope, and:
mainWindow.once('closed', () => destroyMagiclineView(mainWindow));
module.exports = { createMagiclineView, destroyMagiclineView, /* ... */ };
```

## Info

### IN-01: `detectReady` hash regex matches `#/cash-register-settings` and any other suffix

**File:** `src/inject/inject.js:143`
**Issue:** `/#\/cash-register/.test(location.hash)` matches any hash that *contains* `#/cash-register`, including future Magicline routes like `#/cash-register-settings` or `#/cash-register/archive`. The secondary `[data-role="product-search"] input` guard currently prevents a false positive, but the regex's intent is "we're on the cash register page" and it should be anchored.
**Fix:** `/^#\/cash-register(\/|$|\?)/.test(location.hash)`

### IN-02: `MutationObserver` scope is latched at first injection and never re-evaluated

**File:** `src/inject/inject.js:168-179`
**Issue:** `observeTarget = document.querySelector('main')` runs once inside the IIFE. If `<main>` is absent at dom-ready (React hydration not complete), the observer latches onto `document.body` for the lifetime of the page. Subsequent re-injections hit the `__bskiosk_injected__` guard and skip observer setup, so the fallback scope persists. This defeats the scoping optimization without alerting anyone — the `observer-scope-fallback` event fires silently exactly once.
**Fix:** Either (a) accept the current behavior and add a comment noting the latch, or (b) re-check and re-attach the observer at the top of each re-injection before the idempotency early-return.

### IN-03: `preload.js` registers IPC listeners without cleanup or single-registration guard

**File:** `src/main/preload.js:9-12`
**Issue:** `ipcRenderer.on('splash:hide', ...)` is called every time `window.kiosk.onHideSplash(cb)` is invoked by host.js. Today host.js calls each `on*` exactly once so the stack depth is 1, but if a future host page re-registers (e.g., after a soft reload or a phase-5 overlay re-initializes), listeners will pile up and fire each callback N times. This is a well-known Electron footgun.
**Fix:** Either expose a one-shot `kiosk.onHideSplash` that asserts "only call me once," or swap to `ipcRenderer.removeAllListeners(channel)` before each `.on(...)`, or return an unsubscribe function from each `on*` method.
```js
onHideSplash: (cb) => {
  ipcRenderer.removeAllListeners('splash:hide');
  ipcRenderer.on('splash:hide', () => cb());
},
```

### IN-04: No timeout fallback for `cash-register-ready` — splash can hang indefinitely on silent Magicline failure

**File:** `src/inject/inject.js:139-150`, `src/main/magiclineView.js:139-145`
**Issue:** If Magicline loads but `[data-role="product-search"] input` never appears (e.g., new login wall, service worker returning a stale cached shell, hard layout change that keeps all our selectors matching but removes product-search), `readyEmitted` stays false, no drift event fires, the drain queue stays empty, and the splash remains visible forever with no operator signal. The kiosk is effectively bricked until someone opens RDP. Phase 4 plans to address this with the watchdog, but given that the splash is the *only* surface the member sees, a Phase 2 safety net is worth considering.
**Fix:** Add a main-process wall-clock timer (e.g., 60s) started at `createMagiclineView` that, if `readyFired && !driftActive` are both false when it fires, emits the drift overlay with a distinct message ("Verbindung zu Kasse prüfen — bitte Studio-Personal benachrichtigen"). Clear the timer on either `readyFired` or `driftActive` transition.

### IN-05: Drain-poll `executeJavaScript` begins before `loadURL` resolves; early errors are silently swallowed

**File:** `src/main/magiclineView.js:139-143, 212-217`
**Issue:** `startEventDrain(wc, mainWindow)` is called before `wc.loadURL(MAGICLINE_URL)`. During the first ~100-500ms the webContents may still be on `about:blank` or navigating, and `executeJavaScript` will throw. The catch correctly swallows, but you also lose signal on genuine injection-script errors that happen to land in the same window. Consider logging the first N transient drain errors at `debug` level (or gating the drain on `did-finish-load`) so a persistent failure isn't indistinguishable from the expected startup noise.
**Fix:** Add a monotonic counter: after 10 consecutive drain failures post-dom-ready, log a single `log.warn('magicline.drain.sustained-failure')` so sustained breakage is visible in audit.log.

### IN-06: `computeDefaultZoom` reads `screen.getPrimaryDisplay()` at `createMagiclineView` time — doesn't react to kiosk reboot into a different resolution

**File:** `src/main/magiclineView.js:61-79, 120`
**Issue:** Minor but worth flagging since the CONTEXT.md explicitly says "the real kiosk screen resolution is UNKNOWN." `computeDefaultZoom` runs once per process. If the display mode changes (user swaps to a different monitor, Windows DPI scaling changes on resume from sleep) the zoom factor is stale until the app restarts. Low impact for a kiosk that runs on fixed hardware, but worth a comment.
**Fix:** Add a comment documenting the one-shot behavior, or listen to `screen.on('display-metrics-changed', ...)` and re-apply `setZoomFactor` when the primary display geometry changes.

---

_Reviewed: 2026-04-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
