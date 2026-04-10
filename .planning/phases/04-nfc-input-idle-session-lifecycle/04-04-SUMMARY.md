---
phase: 04-nfc-input-idle-session-lifecycle
plan: 04
subsystem: renderer-idle-overlay-and-inject-listeners
tags: [electron, renderer, inject, overlay, ui, phase-4, wave-2]
wave: 2
requires: [04-01, 04-02]
provides:
  - "inject.js product-search-focused / product-search-blurred emit"
  - "inject.js rAF-debounced activity emit on pointerdown+touchstart"
  - "inject.js post-sale clear (3s setTimeout) on Jetzt-verkaufen click"
  - "fragile-selectors.js JETZT_VERKAUFEN_TEXT structural-text constant"
  - "#idle-overlay DOM (Layer 200) + 7 CSS classes per 04-UI-SPEC"
  - "host.js 30s setInterval countdown + dismiss() + reset-loop variant"
affects: [04-05]
tech-stack:
  added: []
  patterns:
    - "One-time listener setup below idempotency anchor (Pattern 10, research pin #4)"
    - "rAF-debounced activity emitter (D-09 #3) to coalesce MUI churn"
    - "Single dismiss() function bound to button click + overlay pointerdown/touchstart/keydown"
    - "Variant-aware onclick reassignment (not addEventListener stacking) on #error-pin-button"
    - ".bsk-layer base class provides flex centering; .bsk-layer--idle only overrides z-index/background/pointer-events"
key-files:
  created:
    - .planning/phases/04-nfc-input-idle-session-lifecycle/04-04-SUMMARY.md
  modified:
    - src/inject/inject.js
    - src/inject/fragile-selectors.js
    - src/host/host.html
    - src/host/host.css
    - src/host/host.js
decisions:
  - "JETZT_VERKAUFEN_TEXT lives ONLY in fragile-selectors.js — magiclineView.js concatenates FRAGILE_JS + inject.js into INJECT_BUNDLE, so the `var JETZT_VERKAUFEN_TEXT = 'Jetzt verkaufen'` declaration is in scope inside inject.js's IIFE via the shared page-world global. No fallback declaration in inject.js needed."
  - "Phase 4 listeners attached AFTER `window.__bskiosk_injected__ = true;` (inject.js line 42) — focusin at line 53, focusout at 61, pointerdown/touchstart at 84/85, post-sale click further down. All strictly greater than the anchor per Pattern 10."
  - "host.css .bsk-layer base class already provides display:flex + flex-direction:column + align-items:center + justify-content:center (inherited from Phase 1). .bsk-layer--idle therefore sets ONLY z-index/background/pointer-events — no redundant flex declarations."
  - "#error-pin-button click wiring refactored from addEventListener (Phase 3 original) to .onclick assignment. This is the key enabler of variant-specific click routing: Phase 3 variants assign pinBtnRequestPinRecovery; Phase 4 reset-loop variant assigns pinBtnRequestResetLoopRecovery. Assignment replaces the handler — addEventListener would stack listeners across variant switches and fire all handlers on a single click."
  - "wireStatic() installs a default pinBtnRequestPinRecovery as the onclick on boot so the button works even if a variant omits the onclick assignment."
metrics:
  duration: ~20min
  tasks: 3
  files-modified: 5
  tests-added: 0
  tests-passing: 89/89 across 4 suites
  completed: 2026-04-10
requirements: [NFC-06, IDLE-01, IDLE-02, IDLE-06]
---

# Phase 4 Plan 04: Renderer Idle Overlay + Inject Listeners Summary

Wires the renderer half of Phase 4: inject.js gains three page-world listeners (product-search focus arbitration, rAF-debounced touch/pointer activity emit, post-sale 3s clear), fragile-selectors.js gains the `JETZT_VERKAUFEN_TEXT` drift constant, and host.html/host.css/host.js gain the `#idle-overlay` DOM + styles + 30s countdown handler + reset-loop error variant case.

## One-liner

Delivers IDLE-01 (branded 30s countdown overlay at z-index 200), IDLE-02 (dismiss button + tap-anywhere restore cart), IDLE-06 (3s post-sale customer-search clear), and NFC-06 (product-search focus arbitration signals) by extending exactly the five renderer-layer files in scope — zero touches to src/main/.

## JETZT_VERKAUFEN_TEXT Strategy

**Chosen path: authoritative declaration in fragile-selectors.js only.**

`src/main/magiclineView.js` concatenates `fragile-selectors.js + "\n;\n" + inject.js` into `INJECT_BUNDLE` (line 45) and feeds the combined string to `webContents.executeJavaScript`. The `var JETZT_VERKAUFEN_TEXT = 'Jetzt verkaufen';` declaration placed in fragile-selectors.js therefore becomes a page-world global that inject.js's IIFE can read by name without re-declaration. Grep confirms: `'Jetzt verkaufen'` literal appears exactly once in the repo (fragile-selectors.js line 67), and `JETZT_VERKAUFEN_TEXT` is referenced symbolically in inject.js.

This satisfies D-21 (drift-patch blast radius = one file). When Magicline renames the button, staff patch a single string in `fragile-selectors.js`, tag a patch version, and `electron-updater` ships it within one boot cycle.

## inject.js Listener Placement (Pattern 10 proof)

| Anchor / Listener | Line | Notes |
|---|---|---|
| `window.__bskiosk_injected__ = true;` | 42 | Idempotency anchor |
| `document.addEventListener('focusin', ...)` | 53 | Product-search focus arbitration |
| `document.addEventListener('focusout', ...)` | 61 | Product-search blur arbitration |
| `document.addEventListener('pointerdown', _scheduleActivityEmit, true)` | 84 | rAF-debounced activity, capture phase |
| `document.addEventListener('touchstart', _scheduleActivityEmit, true)` | 85 | rAF-debounced activity, capture phase |
| `document.addEventListener('click', ...)` (post-sale) | ~90+ | 3s setTimeout customer-search clear |

All five listeners are strictly below line 42 — Pattern 10 / research pin #4 satisfied. Re-injections via `did-navigate-in-page` hit the early-return block on lines 36-41 and never re-run listener attachment, so no stacking.

## .bsk-layer Base-Class Flex Centering

Read of `host.css` lines 29-38 confirmed the base `.bsk-layer` class already declares:

```css
.bsk-layer {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
```

`.bsk-layer--idle` therefore does NOT re-declare any flex properties. It sets only `z-index: 200`, `background: #1A1A1A`, and `pointer-events: auto`. This matches Phase 1/2/3 patterns (`.bsk-layer--splash`, `.bsk-layer--magicline-error`) for consistency.

## Phase 3 Variant Handler Mutation

The Phase 3 `#error-pin-button` click wiring was refactored from an `addEventListener('click', ...)` in `wireStatic()` to an `.onclick` assignment. Rationale: variant-specific click routing requires handler **replacement** (Phase 3 variants → `pinBtnRequestPinRecovery`; Phase 4 reset-loop → `pinBtnRequestResetLoopRecovery`). `addEventListener` would stack listeners across successive variant switches and cause a single click to fire all historical handlers.

Changes:
1. Extracted two named functions at module scope: `pinBtnRequestPinRecovery` and `pinBtnRequestResetLoopRecovery` (both defensive with `window.kiosk?.X` guards).
2. `wireStatic()` installs `pinBtnRequestPinRecovery` as the default `.onclick` on boot — ensures the button works even if a variant omits explicit assignment.
3. Each of the four variant branches (`drift`, `credentials-unavailable`, `login-failed`, `reset-loop`) now explicitly assigns the correct `.onclick` so the click target is deterministic at any point after `showMagiclineError(...)` returns.

No behavioural change to the Phase 3 `credentials-unavailable` / `login-failed` flows — the click target is still `requestPinRecovery`. The refactor is a structural prerequisite for the reset-loop variant.

## German Copy Verification

All German strings use UTF-8 with correct umlauts:

- `host.html`: `Möchten Sie fortfahren?` (aria-label), `Noch da?`, `SEKUNDEN`, `Tippe irgendwo, um fortzufahren.`, `Weiter`
- `host.js`: `Kiosk muss neu gestartet werden`, `Bitte Studio-Personal verst\u00E4ndigen` (JS-escaped ä, matches existing Phase 3 escape style)

`file(1)` confirms `host.html` is UTF-8 (with CRLF line terminators — pre-existing). Grep for `fortzufahren` and `Möchten` both return exactly 1 hit each. No mojibake.

## Commits

- `deaf69b` feat(04-04): add Phase 4 inject.js listeners + JETZT_VERKAUFEN_TEXT constant
- `e476676` feat(04-04): add #idle-overlay DOM + 7 CSS classes per 04-UI-SPEC
- `d40bf9c` feat(04-04): wire idle overlay countdown + reset-loop variant in host.js

## Test Results

```
node --test test/authFlow.test.js test/sessionReset.test.js test/badgeInput.test.js test/idleTimer.test.js
tests 89 | pass 89 | fail 0
```

Zero regressions across all 4 Phase 4 Wave-1 unit test suites.

## Deviations from Plan

None — plan executed as written. A minor cosmetic note: the acceptance-criteria grep counts of `notifyIdleDismissed` / `notifyIdleExpired` / `requestResetLoopRecovery` exceed the "exactly once" target because each call site uses the Phase 3 defensive pattern `if (window.kiosk && window.kiosk.X) { window.kiosk.X(); }`, which produces two lexical matches per call site. The symbol is still referenced from exactly one code path per handler; the double-match is a consequence of mirroring the existing defensive style used throughout host.js (e.g. `launchTouchKeyboard`, `submitCredentials`). No functional impact.

## Known Stubs

None. All three renderer paths are fully wired:
- inject.js listeners emit real events to `window.__bskiosk_events` for main-process drain-poll consumption (Plan 04-03 handleInjectEvent branches are already live).
- `#idle-overlay` DOM and CSS render the UI-SPEC normative layout with real logo, real countdown, real dismiss button.
- `showIdleOverlay` / `dismissIdleOverlay` / `hideIdleOverlayDom` call the preload IPC methods that Plan 04-03 wired to main-process `ipcMain.on` handlers.

The only runtime dependency that cannot be exercised without Plan 04-03 (start-idle-timer side-effect firing the `show-idle-overlay` IPC) is already satisfied on `master` from the Wave-2 sibling plan that merged prior to this plan's start.

## Threat Flags

None. Plan 04-04 introduces no new network endpoints, auth paths, file access, or schema changes. The three new inject.js listeners live inside Magicline's page world (already-untrusted surface) and the renderer-side overlay uses only the contextBridge `window.kiosk` surface from preload.js — zero new IPC channels, zero new trust boundaries beyond what Plan 04-03's threat model already covered.

## Self-Check: PASSED

- FOUND: src/inject/fragile-selectors.js (grep `JETZT_VERKAUFEN_TEXT` → 1 hit, grep `'Jetzt verkaufen'` → 1 hit)
- FOUND: src/inject/inject.js (grep `product-search-focused` → 1 hit, `product-search-blurred` → 1 hit, `emit('activity'` → 1 hit, `'focusin'` / `'focusout'` / `'pointerdown'` / `'touchstart'` → each ≥ 1 hit, `requestAnimationFrame` → 1+ hit, `JETZT_VERKAUFEN_TEXT` → 1 hit, `3000` → 1 hit, `__bskiosk_setMuiValue` → ≥ 2 hits)
- FOUND: listener line numbers 53/61/84/85 all strictly greater than anchor line 42
- FOUND: src/host/host.html (`id="idle-overlay"` → 1 hit, `id="idle-countdown-number"` → 1, `id="idle-dismiss-btn"` → 1, `Möchten Sie fortfahren?` → 1, `Noch da?` → 1, `SEKUNDEN` → 1, `Tippe irgendwo, um fortzufahren.` → 1, `>Weiter<` → 1, `aria-live="polite"` → 1)
- FOUND: src/host/host.css (`bsk-layer--idle` → 1, `bsk-idle-title` → 1, `bsk-idle-countdown` → 1, `bsk-idle-number` → 1, `bsk-idle-seconds-label` → 1, `bsk-idle-subtext` → 1, `bsk-btn--idle-dismiss` → 1, `tabular-nums` → 1, `z-index: 200` → 1)
- FOUND: src/host/host.js (`onShowIdleOverlay` → 1, `onHideIdleOverlay` → 1, `notifyIdleDismissed` → 2, `notifyIdleExpired` → 2, `requestResetLoopRecovery` → 5, `'reset-loop'` → 1, `Kiosk muss neu gestartet werden` → 1, `idleInterval` → 10, `clearInterval` → 3, `credentials-unavailable` → 1, `login-failed` → 1)
- FOUND: commit deaf69b (inject.js + fragile-selectors.js)
- FOUND: commit e476676 (host.html + host.css)
- FOUND: commit d40bf9c (host.js)
- TESTS: 89/89 passing across 4 Phase 4 Wave-1 suites, zero regressions
- SYNTAX: `node --check` clean on inject.js, fragile-selectors.js, host.js
