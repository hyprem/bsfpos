---
phase: 10-post-sale-flow-with-print-interception
fixed_at: 2026-04-24T00:00:00Z
review_path: .planning/phases/10-post-sale-flow-with-print-interception/10-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-04-24
**Source review:** `.planning/phases/10-post-sale-flow-with-print-interception/10-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (fix_scope=critical_warning — Info items skipped by design)
- Fixed: 2
- Skipped: 0

**Test suite:** `node --test test/*.test.js` — **298/298 pass** (baseline preserved). Verified both before fixes (baseline) and after both fixes landed; no regressions.

## Fixed Issues

### WR-01: Cart-empty observer race — momentary cart re-render zeros the arming gate

**Files modified:** `src/inject/inject.js`
**Commit:** `1ae4ba3`
**Applied fix:** Replaced the immediate `_paymentConfirmedAt = 0` on any non-empty cart observation with a deferred 500ms debounce. When a non-empty cart is observed and the arming gate is still set, a `_postSaleFallbackTimer` is scheduled that re-reads `_getCartItemCount()` after 500ms — only clearing the gate if the cart is STILL non-empty at that point. A transient React re-render glitch (brief non-empty intermediate state between the "Jetzt verkaufen" click and the true empty state) therefore no longer silently disarms the fallback. The existing empty-side debounce path is unchanged. `_postSaleFallbackTimer` is still used as the single re-entrancy guard at the top of the observer callback, so only one deferred timer is in flight at a time.

### WR-02: window.print override does not cover late `window.print` reassignment

**Files modified:** `src/inject/inject.js`
**Commit:** `ac1eda5`
**Applied fix:** Replaced the plain `window.print = fn` assignment with `Object.defineProperty(window, 'print', { value: _bskPrintOverride, writable: false, configurable: false })`. Subsequent assignments (`window.print = nativePrint`) now silently fail in sloppy mode and throw in strict mode instead of replacing the interceptor, and `configurable: false` also blocks re-definition via `defineProperty`. The sentinel-emit behavior is byte-identical — the override still emits exactly `console.log('BSK_PRINT_INTERCEPTED')` inside a try/catch and never calls `_originalPrint`. The outer try/catch around the whole block is preserved so that if a future Magicline page has somehow already locked `window.print` itself, we still fall through to the cart-empty observer fallback rather than crashing the IIFE. The `__bskiosk_injected__` idempotency guard and PHASE07_SENTINEL_PREFIX logic are untouched.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-04-24_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
