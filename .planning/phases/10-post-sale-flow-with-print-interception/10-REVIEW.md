---
phase: 10-post-sale-flow-with-print-interception
reviewed: 2026-04-24T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - build/installer.nsh
  - docs/runbook/default-printer-setup.md
  - src/host/host.css
  - src/host/host.html
  - src/host/host.js
  - src/inject/fragile-selectors.js
  - src/inject/inject.js
  - src/main/magiclineView.js
  - src/main/main.js
  - src/main/preload.js
  - src/main/sessionReset.js
  - test/postSale.test.js
  - test/sessionReset.test.js
  - test/updateGate.test.js
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-24
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 10 introduces the post-sale "Vielen Dank" overlay triggered by a JS-level `window.print` override (primary, in `src/inject/inject.js`) with a cart-empty MutationObserver fallback (defense-in-depth). The flow funnels through a single `post-sale:trigger` ipcMain channel with a `postSaleShown` dedupe gate, then either rearms the idle timer (`next-customer`) or hard-resets to welcome (`auto-logout`) with `reason:'sale-completed'` (which is excluded from the reset-loop guard per Plan 01).

**Security surface (preload + ipcMain handlers):** Clean. The renderer-exposed surface (`notifyPostSaleNextCustomer`, `notifyPostSaleAutoLogout`, `onShowPostSale`, `onHidePostSale`) accepts no payloads — both invokes are parameter-less and the `on*` subscribers ignore the IPC payload entirely. There is no path by which a compromised renderer can inject arbitrary data into the main-process post-sale state machine. The internal `post-sale:trigger` channel is fired only by `magiclineView.js` console-message handler (via `ipcMain.emit`); the renderer cannot reach it through preload.

**NSIS installer:** Clean. The PowerShell snippet is built from hardcoded literals (no installer-provided strings interpolated), written to a temp file rather than passed inline, and runs with `-NoProfile -ExecutionPolicy Bypass`. Exit code is non-fatal per design (D-15 runbook fallback).

**Console sentinel DoS:** Bounded. A compromised Magicline that floods `BSK_PRINT_INTERCEPTED` would generate one `ipcMain.emit('post-sale:trigger')` per console line, but the `postSaleShown` dedupe gate in `main.js` short-circuits all duplicates with an `info`-level log. Audit-log volume is the worst residual cost.

**Race conditions:** Host-side `postSaleResolved` first-wins guard between the button tap and the countdown expiry is correct (single-threaded JS, check-then-set). Both the show path and the dismiss path properly clear `postSaleInterval`.

**Print-override bypass:** The window.print override only protects the main frame's `window` object. Iframes, workers, and blob: documents could in principle bypass it. The runbook + NSIS step setting Microsoft Print to PDF as the default printer is the documented mitigation, plus the cart-empty MutationObserver fallback. This is the design intent and is documented; not flagged.

The two warnings below are correctness/UX edge cases in the inject-side observer, not security issues. Info items cover style and minor cleanup.

## Warnings

### WR-01: Cart-empty observer race — momentary cart re-render zeros the arming gate

**File:** `src/inject/inject.js:182-187`
**Issue:** Inside the MutationObserver callback, any non-zero cart count immediately resets `_paymentConfirmedAt = 0`:
```js
if (count !== 0) {
  _paymentConfirmedAt = 0; // non-empty resets gate (multi-purchase + abandoned)
  return;
}
```
React MUI re-renders are known to briefly produce intermediate DOM states. If a sale-completion sequence re-renders the cart in two phases — for example, a brief "loading" placeholder that does not match `[data-role="cart-item"]` followed by the empty state — the gate works fine. But if Magicline's cart implementation ever renders an interim non-empty state (e.g. a single "thank you" item) between the `Jetzt verkaufen` click and the empty state, this will reset the arming and the fallback never fires. The 500ms debounce on the empty-side mutation absorbs glitches in the empty→non-empty direction but not the reverse. Combined with the fact that this fallback only matters when the `window.print` override has already failed (a low-probability event), the impact is small, but worth flagging because the fallback exists precisely to cover unanticipated Magicline behaviour.

**Fix:** Defer the gate clear to the same 500 ms debounce window so a transient non-empty observation does not erase the arming:
```js
if (count !== 0) {
  // Debounce non-empty observations too — only zero the gate after a
  // sustained non-empty period, otherwise React re-render glitches in the
  // wrong direction will erase the post-payment arming silently.
  if (_paymentConfirmedAt && !_postSaleFallbackTimer) {
    _postSaleFallbackTimer = setTimeout(function () {
      _postSaleFallbackTimer = null;
      if (_getCartItemCount() !== 0) _paymentConfirmedAt = 0;
    }, 500);
  }
  return;
}
```
Alternative: leave the immediate clear in place but add a UAT note to verify Magicline's actual post-sale cart-clear render sequence on the live deployment before relying on the fallback.

### WR-02: window.print override does not cover late `window.print` reassignment

**File:** `src/inject/inject.js:134-142`
**Issue:** The override runs once at IIFE execution time:
```js
var _originalPrint = window.print;
window.print = function () { ... };
```
inject.js is reinjected on `did-navigate-in-page`, but the early-return idempotency guard (line 36-41) skips the listener-setup block (which contains the print override) on every reinjection. If Magicline's React app, after our injection, ever does something like `window.print = nativePrint;` (e.g. a code path that captures and restores the original) or loads a script that does, the override is silently lost and the next sale opens Chrome's print preview. The cart-empty fallback would still trigger the post-sale overlay, but the print preview flash itself is exactly the failure mode the override exists to prevent.

**Fix:** Use `Object.defineProperty` with `configurable: false` and a getter, so subsequent assignments either throw (in strict mode) or silently fail without replacing our override:
```js
try {
  var _bskPrintOverride = function () {
    try { console.log('BSK_PRINT_INTERCEPTED'); } catch (e) {}
  };
  Object.defineProperty(window, 'print', {
    value: _bskPrintOverride,
    writable: false,
    configurable: false,
  });
} catch (e) { /* swallow — fallback observer covers */ }
```
Note: this only protects against assignment-based overwrites. A determined attacker (or framework) using `Object.defineProperty` themselves on `window.print` would still win — but there is no evidence Magicline does this, and the locked-down `configurable: false` raises the bar substantially.

## Info

### IN-01: `_originalPrint` retained in closure but never used

**File:** `src/inject/inject.js:135-141`
**Issue:** `var _originalPrint = window.print;` is captured but the comment explicitly says "NEVER invoke it from production code paths." Dead reference; trivial closure leak (one function pointer).
**Fix:** Drop the variable to make intent unambiguous, or replace with a no-op assignment (`window.print = function () { ... };` directly).

### IN-02: `try { void payload; } catch (_) {}` is a no-op pattern

**File:** `src/host/host.js:73-74`
**Issue:**
```js
function hideSplashFinal(payload) {
  try { void payload; } catch (_) {}
  hideSplash();
}
```
`void payload` cannot throw in JavaScript — `void` is a unary operator that always succeeds. The try/catch wrapper here adds no protection and makes intent unclear (looks like defensive code but is purely decorative). Pre-existing code, but Phase 10 added similarly defensive `try {} catch (_) {}` blocks in the new post-sale section that may follow this pattern.
**Fix:** Replace with a single comment to make intent explicit: `// payload reserved for future use; main writes audit log.`

### IN-03: Test reimplementation drift risk between `test/postSale.test.js` and `src/main/main.js`

**File:** `test/postSale.test.js:79-146`
**Issue:** The test file faithfully reimplements the three post-sale ipcMain handlers from `src/main/main.js` lines 438-504, but uses `const trigger` while the source uses `var trigger`. The test prologue claims "byte-equivalent (save for 'require' vs injected deps)" but is not — minor stylistic divergence. More important: there is no mechanical check (lint rule, snapshot test, or grep assertion) that future edits to `src/main/main.js` propagate to the test file. The PR-time human review check called out in the comment is the only safeguard.
**Fix:** Either (a) extract `startPostSaleFlow` and the three handler bodies into a small `src/main/postSaleHandlers.js` module that both `main.js` and `postSale.test.js` import (preferred — eliminates drift entirely), or (b) add a top-of-file CI check that grep-counts the handler function bodies in both files and fails if they diverge.

### IN-04: Multiple `try { ipcMain.removeAllListeners('post-sale:*'); } catch (_) {}` calls indicate handler-registration churn risk

**File:** `src/main/main.js:460, 479, 496`
**Issue:** Each of the three `ipcMain.on('post-sale:...')` registrations is preceded by a `removeAllListeners` of the same channel. This is defensive — guards against double-registration if the surrounding `app.whenReady()` callback ever fires twice. But it also means any other module that registered a listener on these channels (e.g. a future test harness) will be silently wiped on app boot. Low-risk today (no other files register on these channels — verified via grep), but worth a brief comment explaining the intent.
**Fix:** Add a one-line comment above the first `removeAllListeners`:
```js
// Defensive: removeAllListeners guards against accidental double-registration
// if app.whenReady ever re-fires. Keep in mind: no other module may register
// on post-sale:* channels — these calls would silently wipe them.
```

### IN-05: Inject.js `_postSaleFallbackTimer` re-entrancy guard subtly relies on observer callback ordering

**File:** `src/inject/inject.js:179-200`
**Issue:** The MutationObserver callback returns early if `_postSaleFallbackTimer` is non-null:
```js
if (_postSaleFallbackTimer) return; // debounce active
```
If a mutation fires while the 500ms debounce is in flight AND the cart is now non-empty, the gate is NOT cleared (the early-return skips the `count !== 0` branch). The deferred setTimeout will then re-check `_getCartItemCount() === 0 && _paymentConfirmedAt` and correctly skip emitting the sentinel because the cart is now non-empty. So the behavior is correct, but the reasoning is non-obvious from the code.
**Fix:** Add a comment explaining the guarantee: `// Note: debounce-active early-return is safe even if cart became non-empty during the window, because the deferred setTimeout re-reads _getCartItemCount() before emitting.`

---

_Reviewed: 2026-04-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
