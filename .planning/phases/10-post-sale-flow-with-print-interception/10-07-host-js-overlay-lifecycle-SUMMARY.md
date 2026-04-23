---
phase: 10-post-sale-flow-with-print-interception
plan: 07
subsystem: host-ui
tags: [host-js, overlay, countdown, race-guard, ipc-subscriber, phase-10, sale-01, d-08, d-09, d-19]

# Dependency graph
requires:
  - phase: 10-post-sale-flow-with-print-interception
    plan: 05
    provides: "main-side IPC handlers — post-sale:show/hide senders, post-sale:next-customer/auto-logout receivers — now have live host-side subscribers + notifiers"
  - phase: 10-post-sale-flow-with-print-interception
    plan: 06
    provides: "#post-sale-overlay + #post-sale-countdown-number + #post-sale-next-btn DOM nodes addressable from host.js"
  - phase: 04-nfc-input-idle-session-lifecycle (v1.0)
    provides: "idle overlay state machine template — showIdleOverlay/hideIdleOverlayDom lines 315-344 / 303-313 directly cloned for post-sale equivalents with D-08 race guard overlay"
provides:
  - "postSaleResolved + postSaleInterval module-scoped state declared alongside existing idleInterval (host.js line ~297)"
  - "showPostSaleOverlay() — first-wins race-guarded countdown renderer, decrement setInterval(1000), auto-expiry fires notifyPostSaleAutoLogout"
  - "hidePostSaleOverlay() — clears interval + hides overlay + sets aria-hidden='true' (mirrors hideIdleOverlayDom)"
  - "#post-sale-next-btn click handler inside wireStatic — guarded by postSaleResolved, calls hidePostSaleOverlay + notifyPostSaleNextCustomer"
  - "onShowPostSale / onHidePostSale IPC subscribers registered in the kiosk-IPC block (after Phase 09 onPosStateChanged subscriber)"
affects:
  - "phase-10 plan 08 (postSale state-machine test — now has a real host.js implementation to mirror / cross-reference assertions against)"
  - "phase-10 plan 09 (updateGate composition test — auto-logout branch reaches notifyPostSaleAutoLogout → main post-sale:auto-logout → hardReset sale-completed end-to-end)"
  - "phase-10 plan 03 + 04 (integration — once print interception + magiclineView relay land, the full show flow is live end-to-end)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First-wins race guard for dual-source dismiss — postSaleResolved boolean latched by whichever path (button click OR countdown expiry) fires first; second path is a silent no-op. Generalizes the Phase 07 welcomeTapPending pattern to a host-side dual-trigger dismiss."
    - "Cross-overlay show/hide function cloning — showPostSaleOverlay is a near-verbatim clone of showIdleOverlay with two deliberate substitutions (overlay ID pair + auto-expiry IPC channel), giving construction-level parity without shared mutable state."
    - "Guard-check placement AFTER clearInterval but BEFORE DOM/IPC — ensures stale interval always clears even when button path already fired, preventing a zombie timer."
    - "var + function declarations throughout (no const/let/arrow) — matches existing host.js style for the IIFE closure shared across all overlay state."

key-files:
  created: []
  modified:
    - src/host/host.js

key-decisions:
  - "D-08/D-09 executed verbatim — postSaleResolved is a module-scoped var (owned by host.js, not main.js) with dual check-and-set sites: countdown-expiry branch and button-click handler. Reset to false only on fresh showPostSaleOverlay() entry."
  - "D-01 button-only dismiss enforced — no pointerdown/touchstart/keydown listeners attached to #post-sale-overlay. The layer's pointer-events:auto (from Plan 06 CSS) exists solely to block pointer-throughs to the cash register beneath, not to fire dismiss."
  - "D-02 no Esc dismiss — no new keydown handler added. Existing admin-menu Esc handler (host.js lines ~1245-1265 post-insertion) short-circuits when admin menu is hidden, so it cannot accidentally fire on post-sale."
  - "First-wins guard check placed AFTER clearInterval — matches PATTERNS §host.js exactly. If the guard-check were placed FIRST the stale interval would never clear, leaving a zombie timer across overlay cycles."
  - "postSaleResolved latched to true BEFORE the IPC notify — defensive ordering against any reentrant click during synchronous event dispatch, mirroring idle-overlay style."
  - "Insertion points chosen to minimize diff footprint — state declarations immediately after idleInterval (line 291→297), function definitions immediately after dismissIdleOverlay (line 355→369), button handler immediately after idle pointerdown/touchstart/keydown block inside wireStatic, IPC subscribers immediately after Phase 09 onPosStateChanged block."

patterns-established:
  - "Dual-source dismiss with host-owned race flag — any future overlay needing both a user-tap dismiss AND an auto-expiry dismiss should follow showPostSaleOverlay's structure: reset-flag on show, clearInterval+guard-check+latch+DOM+IPC on expiry, guard-check+latch+DOM+IPC on user action."
  - "Cross-phase IPC subscriber ordering in wireIpcListeners — Phase 10 subscribers registered right after Phase 09, which was registered right after Phase 6, matching the chronological phase-ordering convention throughout the kiosk-IPC block."

requirements-completed: [SALE-01]  # Partially — SALE-01 also spans plans 01, 02, 03, 04, 05, 06, 08, 09, 10. Host-side overlay lifecycle closed here.

# Metrics
duration: ~2 min
completed: 2026-04-23
---

# Phase 10 Plan 07: Host.js Overlay Lifecycle Summary

**Post-sale overlay lifecycle in host.js — state (postSaleResolved + postSaleInterval), show/hide functions with D-08 first-wins race guard, button-click handler, and two IPC subscribers. 85 additive lines across four insertion points, zero existing code modified.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-23T08:41:18Z
- **Completed:** 2026-04-23T08:43:23Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Declared `postSaleResolved` + `postSaleInterval` module-scoped state immediately after the existing `idleInterval` declaration, with a 4-line comment cross-referencing D-08/D-09 and documenting the dual-trigger dismiss contract.
- Added `showPostSaleOverlay()` function — near-verbatim clone of `showIdleOverlay()` (lines 315–344) with three deliberate substitutions: overlay ID (`'post-sale-overlay'`), countdown number ID (`'post-sale-countdown-number'`), auto-expiry IPC (`notifyPostSaleAutoLogout`). Adds D-08 first-wins guard in the countdown-expiry branch.
- Added `hidePostSaleOverlay()` function — clones `hideIdleOverlayDom()` (lines 303–313) with the post-sale ID and its own interval state.
- Wired `#post-sale-next-btn` click handler inside `wireStatic()`, placed right after the existing idle overlay dismiss bindings. Handler checks `postSaleResolved` (D-08), latches to `true`, calls `hidePostSaleOverlay()`, then fires `notifyPostSaleNextCustomer()` in a try/catch.
- Registered `onShowPostSale(showPostSaleOverlay)` and `onHidePostSale(hidePostSaleOverlay)` IPC subscribers immediately after the Phase 09 `onPosStateChanged` block, matching the chronological phase-ordering convention of the kiosk-IPC subscriber section.
- No tap-anywhere listener added on `#post-sale-overlay` (D-01). No Esc keydown handler added (D-02). Existing admin-menu Esc handler already short-circuits when admin menu is hidden, so it cannot accidentally dismiss post-sale.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add postSaleResolved + postSaleInterval state, showPostSaleOverlay + hidePostSaleOverlay functions** — `f62ff96` (feat)
2. **Task 2: Wire #post-sale-next-btn click handler + IPC subscribers inside wireIpcListeners** — `1e8aa1b` (feat)

**Plan metadata:** (captured at final docs commit below)

## Files Created/Modified

- `src/host/host.js` — +85 lines, -0 lines. Four additive insertions:
  - **Insertion 1 (+7 lines after line 291):** `postSaleResolved`/`postSaleInterval` declarations with 4-line comment block.
  - **Insertion 2 (+57 lines after line 355):** banner comment + `showPostSaleOverlay()` function (37 lines) + `hidePostSaleOverlay()` function (10 lines).
  - **Insertion 3 (+18 lines inside `wireStatic()` after the idle overlay pointerdown/touchstart/keydown block):** `#post-sale-next-btn` click handler with D-08 guard.
  - **Insertion 4 (+3 lines inside the `if (window.kiosk) { ... }` block after the Phase 09 `onPosStateChanged` block):** `onShowPostSale` / `onHidePostSale` subscriber registrations.

## Exact Before/After Diff

### Insertion 1 — state declarations (after `var idleInterval = null;`)

**Before:**
```javascript
  // =================================================================
  // Phase 4 — Idle overlay (Layer 200, D-11 / 04-UI-SPEC countdown contract)
  // =================================================================
  var idleInterval = null;

  // --- Phase 9 state -------------------------------------------------------
```

**After:**
```javascript
  // =================================================================
  // Phase 4 — Idle overlay (Layer 200, D-11 / 04-UI-SPEC countdown contract)
  // =================================================================
  var idleInterval = null;

  // Phase 10 D-08/D-09: first-trigger-wins race guard (host-side). Both
  // dismiss paths (button tap, countdown expiry) check-and-set this flag;
  // the second-to-fire is a silent no-op. Reset on every showPostSaleOverlay()
  // call. postSaleInterval holds the 1s countdown setInterval id.
  var postSaleResolved = false;
  var postSaleInterval = null;

  // --- Phase 9 state -------------------------------------------------------
```

### Insertion 2 — show/hide functions (after `dismissIdleOverlay()`)

Inserted after the closing `}` of `dismissIdleOverlay` and before the `// Phase 3 — Credentials overlay` banner:

```javascript
  // =================================================================
  // Phase 10 — Post-sale overlay (Layer 180, UI-SPEC D-03/D-04/D-08)
  // =================================================================
  // Mirrors the idle overlay state machine: setInterval(1000), textContent
  // decrement, display toggle, aria-hidden toggle. Differences: (a) the
  // first-wins postSaleResolved guard prevents double-fire of the button
  // and auto-expiry paths, (b) auto-expiry sends notifyPostSaleAutoLogout
  // (main triggers hardReset) rather than notifyIdleExpired (main triggers
  // idle-mode reset with different semantics).

  function showPostSaleOverlay() {
    var overlay = document.getElementById('post-sale-overlay');
    var numEl = document.getElementById('post-sale-countdown-number');
    if (!overlay || !numEl) return;
    // Reset race flag on every fresh show — D-08/D-09.
    postSaleResolved = false;
    // Guard against stale interval from a previous show (double-show race).
    if (postSaleInterval) {
      clearInterval(postSaleInterval);
      postSaleInterval = null;
    }
    var countdown = 10;
    numEl.textContent = '10';
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    postSaleInterval = setInterval(function () {
      countdown -= 1;
      numEl.textContent = String(countdown);
      if (countdown <= 0) {
        clearInterval(postSaleInterval);
        postSaleInterval = null;
        // D-08 first-wins guard: if button already fired, silent no-op.
        if (postSaleResolved) return;
        postSaleResolved = true;
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        try {
          if (window.kiosk && window.kiosk.notifyPostSaleAutoLogout) {
            window.kiosk.notifyPostSaleAutoLogout();
          }
        } catch (e) { /* ignore */ }
      }
    }, 1000);
  }

  function hidePostSaleOverlay() {
    if (postSaleInterval) {
      clearInterval(postSaleInterval);
      postSaleInterval = null;
    }
    var overlay = document.getElementById('post-sale-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
  }
```

### Insertion 3 — button click handler (inside `wireStatic()`, after idle overlay bindings)

Inserted immediately after the idle overlay pointerdown/touchstart/keydown block and before the `// Keypad buttons` comment:

```javascript
    // Phase 10 D-01/D-06/D-08: N\u00E4chster Kunde button — keeps Magicline
    // session alive, rearms idle timer. First-wins guard prevents
    // double-fire with the countdown auto-expiry path. No tap-anywhere or
    // Esc dismiss — D-01/D-02 explicitly reject those paths.
    var postSaleNextBtn = document.getElementById('post-sale-next-btn');
    if (postSaleNextBtn) {
      postSaleNextBtn.addEventListener('click', function () {
        if (postSaleResolved) return;  // D-08 first-wins
        postSaleResolved = true;
        hidePostSaleOverlay();
        try {
          if (window.kiosk && window.kiosk.notifyPostSaleNextCustomer) {
            window.kiosk.notifyPostSaleNextCustomer();
          }
        } catch (e) { /* ignore */ }
      });
    }
```

### Insertion 4 — IPC subscribers (inside `if (window.kiosk) { ... }` after Phase 09 block)

Inserted after the closing `}` of the Phase 09 `onPosStateChanged` subscriber and before the `// Phase 08 — PIN change overlay IPC` comment:

```javascript
    // Phase 10 — Post-sale overlay IPC subscribers (D-19)
    if (window.kiosk.onShowPostSale) window.kiosk.onShowPostSale(showPostSaleOverlay);
    if (window.kiosk.onHidePostSale) window.kiosk.onHidePostSale(hidePostSaleOverlay);
```

## Line Count Delta

| Section | Before | After | Delta |
|---------|--------|-------|-------|
| host.js total | 1210 | 1295 | +85 |
| State declarations (post-idle) | 0 | 7 | +7 |
| show/hide functions + banner | 0 | 57 | +57 |
| Button click handler in wireStatic | 0 | 18 | +18 |
| IPC subscribers block | 0 | 3 | +3 |

## Insertion Point Map

| # | Region | Pre-edit anchor | Post-edit line | Purpose |
|---|--------|-----------------|----------------|---------|
| 1 | state declarations | After `var idleInterval = null;` (L291) | L297-L298 | `postSaleResolved`/`postSaleInterval` |
| 2 | show/hide functions | After `dismissIdleOverlay()` close brace (L355) | L374 (show) + L409 (hide) | Core lifecycle functions |
| 3 | button handler | Inside `wireStatic()` after idle-overlay keydown binding (L1075 pre-edit) | L1145-L1155 post-edit | `#post-sale-next-btn` click |
| 4 | IPC subscribers | After Phase 09 `onPosStateChanged` close brace (L1153 pre-edit) | L1237-L1238 post-edit | `onShowPostSale` / `onHidePostSale` |

## Race Guard Scenario Verification (UI-SPEC §Race Guard)

Walk-through of the four scenarios enumerated in 10-UI-SPEC §Interaction Contract > Race Guard, matched against the implemented code:

| Scenario | First fire | Second fire | Code-level outcome |
|----------|-----------|-------------|--------------------|
| **A. Button tap at t=2s** | Button handler at L1145 — `postSaleResolved` is `false`, so passes guard → latches to `true` → `hidePostSaleOverlay()` → `notifyPostSaleNextCustomer()`. | n/a (interval never fires expiry) | Idle timer rearms (main D-06); cart stays; overlay hidden. Countdown interval still ticking silently — but every future tick's `countdown <= 0` branch would now hit `if (postSaleResolved) return;` and no-op. The interval is cleared explicitly on the next `showPostSaleOverlay()` entry or on `hidePostSaleOverlay()` (which runs before the IPC in the button handler). |
| **B. Button tap at t=9.95s, countdown fires at t=10.00s** | Button handler — latches `postSaleResolved=true`, calls `hidePostSaleOverlay()` which clears `postSaleInterval` → interval cannot fire. | n/a (interval was cleared before the t=10 tick) | Same as A. Auto-logout IPC never dispatched. |
| **C. Member never taps, countdown fires at t=10.00s** | Countdown expiry in `setInterval` callback — clears interval, `postSaleResolved` is `false`, passes guard → latches to `true` → `notifyPostSaleAutoLogout()`. | n/a (button never tapped) | `sessionReset.hardReset({reason:'sale-completed',mode:'welcome'})` via main handler. |
| **D. Countdown fires at t=10.00s, member taps at t=10.01s** | Countdown expiry — latches `postSaleResolved=true` → `notifyPostSaleAutoLogout()`. | Button handler at t=10.01 — sees `postSaleResolved===true` → silent no-op return. | Auto-logout path wins; tap is swallowed. Note: button tap at t=10.01 is only possible if `hidePostSaleOverlay()` has not yet hidden the overlay display; the countdown-expiry branch sets `display:none` + `aria-hidden=true` before the IPC, so realistically the button is offscreen by then. The guard is defense-in-depth. |

All four scenarios match the first-wins semantics documented in UI-SPEC.

## Confirmation — No Existing Code Modified

Verified by `git diff HEAD~2 -- src/host/host.js` — all four insertions are pure additive diffs (`+` lines only, no `-` lines). Specific unchanged regions:

| Function / region | Lines (post-edit) | Status |
|-------------------|-------------------|--------|
| `hideIdleOverlayDom` | 303-313 | **Unchanged** |
| `showIdleOverlay` | 315-344 | **Unchanged** |
| `dismissIdleOverlay` | 346-355 | **Unchanged** |
| `wireStatic` outer shell (admin/creds/kbd/err wiring) | 1078-1144 | **Unchanged** |
| Idle overlay button + pointerdown/touchstart/keydown bindings | 1127-1139 | **Unchanged** |
| Keypad buttons wiring | 1158-1166 | **Unchanged** |
| Welcome layer tap handler | 1167-1176 | **Unchanged** |
| `onShowIdleOverlay` / `onHideIdleOverlay` subscribers | 1191-1192 | **Unchanged** |
| Phase 09 `onPosStateChanged` subscriber | 1211-1217 | **Unchanged** |
| Phase 08 `onShowPinChangeOverlay` / `onHidePinChangeOverlay` subscribers | 1240-1246 | **Unchanged** |
| Admin menu Esc keydown handler | 1263-1284 | **Unchanged** |

## No Tap-Anywhere / No Esc Confirmation (D-01 / D-02)

- `grep -n "post-sale-overlay" src/host/host.js` returns 2 matches: `document.getElementById('post-sale-overlay')` inside `showPostSaleOverlay` (L375) and inside `hidePostSaleOverlay` (L414). No `addEventListener` on `#post-sale-overlay`. **D-01 button-only dismiss enforced.**
- No new `document.addEventListener('keydown', ...)` added. The existing admin-menu Esc handler (lines 1263-1284 post-edit) checks `if (!adminMenu || adminMenu.style.display === 'none') return;` which short-circuits when admin menu is hidden — post-sale cannot accidentally fire it. **D-02 no Esc dismiss enforced.**

## Acceptance Criteria Verification

### Task 1

| Criterion | Status |
|-----------|--------|
| Contains `var postSaleResolved = false;` | PASSED (L297) |
| Contains `var postSaleInterval = null;` | PASSED (L298) |
| Contains `function showPostSaleOverlay()` | PASSED (L374) |
| Contains `function hidePostSaleOverlay()` | PASSED (L409) |
| Contains `document.getElementById('post-sale-overlay')` (×2) | PASSED (L375 + L414) |
| Contains `document.getElementById('post-sale-countdown-number')` | PASSED (L376) |
| Contains `window.kiosk.notifyPostSaleAutoLogout()` | PASSED (L402) |
| Contains `if (postSaleResolved) return;` inside showPostSaleOverlay | PASSED (L396) |
| Contains `postSaleResolved = true;` inside showPostSaleOverlay | PASSED (L397) |
| `grep -c "postSaleInterval" src/host/host.js` >= 4 | PASSED (11 matches) |
| `node --check src/host/host.js` exits 0 | PASSED |
| Existing `showIdleOverlay` unchanged | PASSED |
| Existing `hideIdleOverlayDom` unchanged | PASSED |
| Existing `dismissIdleOverlay` unchanged | PASSED |
| No `const`, `let`, or arrow function in new code | PASSED (all `var` + `function` declarations; only anonymous `function()` callbacks) |

### Task 2

| Criterion | Status |
|-----------|--------|
| Contains `document.getElementById('post-sale-next-btn')` | PASSED (L1145) |
| Contains `window.kiosk.notifyPostSaleNextCustomer()` | PASSED (L1153) |
| Contains `window.kiosk.onShowPostSale(showPostSaleOverlay)` | PASSED (L1237) |
| Contains `window.kiosk.onHidePostSale(hidePostSaleOverlay)` | PASSED (L1238) |
| Contains `if (postSaleResolved) return;` inside button click handler | PASSED (L1148) |
| `grep -c "postSaleResolved = true"` returns exactly 2 | PASSED (2: L397 countdown expiry + L1149 button click) |
| `grep -c "postSaleResolved"` returns >= 5 | PASSED (7 matches: declaration + reset + 2× latch + 2× guard + comment-mention) |
| `node --check src/host/host.js` exits 0 | PASSED |
| Existing `#idle-dismiss-btn` click handler unchanged | PASSED |
| Existing `onShowIdleOverlay` / `onHideIdleOverlay` subscribers unchanged | PASSED |
| Existing `onPosStateChanged` subscriber unchanged | PASSED |
| Existing admin-menu Esc handler unchanged | PASSED |
| No tap-anywhere pointerdown listener on `#post-sale-overlay` | PASSED (zero matches) |

## Regression Test

`node --test test/sessionReset.test.js`:

```
ℹ tests 32
ℹ pass 32
ℹ fail 0
```

Phase 10 Plan 01 D-17/D-18 assertions still green (sale-completed reason excluded from loop counter + onPostReset still fires for it). No regressions introduced.

## Decisions Made

None beyond what the plan specified. All decisions referenced in `<key-decisions>` above map one-to-one to the plan's D-references (D-01, D-02, D-06, D-08, D-09, D-19) and the plan's explicit action spec (insertion points, variable naming, `var`/`function` style, guard-check placement, defensive IPC ordering).

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed in a single pass; all grep assertions and count assertions passed on first run; `node --check src/host/host.js` green after each insertion.

---

**Total deviations:** 0
**Impact on plan:** None — plan executed exactly as written. +85 lines matches the rough estimate of "5 additive changes"; no existing function, state, or subscriber modified.

## Issues Encountered

None. Two tasks executed linearly; syntax check green after every edit; regression test green on first run.

Note: Read-before-edit advisory reminders fired on each `Edit` invocation of host.js. These were advisory only — the runtime accepted every edit because host.js had been Read at session start and re-Read at intermediate offsets before each change block.

## User Setup Required

None — no external service configuration required. The preload IPC surface (Plan 02) and main-side handlers (Plan 05) expose the four channels (`post-sale:show`, `post-sale:hide`, `post-sale:next-customer`, `post-sale:auto-logout`) that this plan's host.js binds against; no environment variable, build config, or dashboard setup is needed.

## Next Phase Readiness

- **Plan 10-04 (magiclineView sentinel relay)** — READY. Once the `post-sale:trigger` relay is wired in magiclineView.js, the full print-intercept-to-welcome flow is live end-to-end:
  `BSK_PRINT_INTERCEPTED` → `post-sale:trigger` (Plan 04) → `startPostSaleFlow` (Plan 05) → `post-sale:show` → `showPostSaleOverlay` (this plan) → either button tap → `notifyPostSaleNextCustomer` (this plan) → idle rearm (Plan 05), OR countdown expiry → `notifyPostSaleAutoLogout` (this plan) → `hardReset({sale-completed, welcome})` (Plan 05) → welcome layer (Phase 06).
- **Plan 10-08 (postSale state-machine test)** — READY. The test can now mirror the host.js implementation precisely: fake DOM + fake `window.kiosk`, exercise show → tick → dismiss paths, assert on `postSaleResolved` state transitions and IPC call counts.
- **Plan 10-09 (updateGate composition test)** — READY. The auto-logout branch reaches `hardReset({reason:'sale-completed',mode:'welcome'})` which fires `onPostReset` per Plan 01 D-18 verification; the full post-sale → reset → updateGate install path now has a working end-to-end code path.
- **No blockers for downstream Phase 10 plans.** Host-side overlay lifecycle is the final renderer-side piece.

## Threat Flags

None — plan 10-07 operates entirely within the trust boundaries enumerated in the plan's threat register (T-10-07-01 through T-10-07-04). All four threats (DoS, race, stale interval, tap-anywhere) are mitigated by the first-wins `postSaleResolved` flag + stale-interval clear on every show. No new security-relevant surface introduced beyond the already-declared IPC channels (which were added in Plans 02 + 05); this plan only consumes them.

## Self-Check: PASSED

**Created files:** None (plan only modifies existing `src/host/host.js`).

**Modified files:**
- `src/host/host.js` — FOUND, contains all required substrings across both tasks:
  - `var postSaleResolved = false;` (L297)
  - `var postSaleInterval = null;` (L298)
  - `function showPostSaleOverlay()` (L374)
  - `function hidePostSaleOverlay()` (L409)
  - `document.getElementById('post-sale-overlay')` (L375, L414)
  - `document.getElementById('post-sale-countdown-number')` (L376)
  - `document.getElementById('post-sale-next-btn')` (L1145)
  - `window.kiosk.notifyPostSaleAutoLogout()` (L402)
  - `window.kiosk.notifyPostSaleNextCustomer()` (L1153)
  - `window.kiosk.onShowPostSale(showPostSaleOverlay)` (L1237)
  - `window.kiosk.onHidePostSale(hidePostSaleOverlay)` (L1238)
  - `if (postSaleResolved) return;` (L396 countdown + L1148 button)
  - `postSaleResolved = true;` (L397 countdown + L1149 button)

**Commits:**
- `f62ff96` — FOUND in `git log --oneline` (feat(10-07): add postSale state, showPostSaleOverlay, hidePostSaleOverlay)
- `1e8aa1b` — FOUND in `git log --oneline` (feat(10-07): wire #post-sale-next-btn click handler + post-sale IPC subscribers)

**Syntax check:**
- `node --check src/host/host.js` — SYNTAX OK

**Regression check:**
- `node --test test/sessionReset.test.js` — 32 pass, 0 fail (Plan 01 D-17/D-18 tests still green)

---
*Phase: 10-post-sale-flow-with-print-interception*
*Plan: 07 — host-js-overlay-lifecycle*
*Completed: 2026-04-23*
