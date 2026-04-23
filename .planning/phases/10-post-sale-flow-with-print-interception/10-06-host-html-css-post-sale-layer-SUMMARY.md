---
phase: 10-post-sale-flow-with-print-interception
plan: 06
subsystem: host-ui
tags: [host-ui, overlay, z-index, css, phase-10, sale-01, d-03, d-04]

# Dependency graph
requires:
  - phase: 10-post-sale-flow-with-print-interception
    plan: 02
    provides: "preload IPC surface (onShowPostSale / onHidePostSale / notifyPostSaleNextCustomer / notifyPostSaleAutoLogout) — Plan 07 will wire show/hide to the #post-sale-overlay DIV added here"
  - phase: 04-idle-timer-and-overlay (v1.0)
    provides: "idle overlay precedent — .bsk-layer--idle + .bsk-idle-countdown + .bsk-idle-number + .bsk-idle-seconds-label + .bsk-idle-subtext + .bsk-btn--idle-dismiss classes reused verbatim for cross-overlay visual parity"
  - phase: 06-welcome-screen-lifecycle-redesign (v1.0)
    provides: ".bsk-welcome-title 48px/700/#F5C518 precedent — .bsk-post-sale-title inherits size/weight/color for brand parity"
provides:
  - "#post-sale-overlay host layer DIV at z-index 180 — branded thank-you card with logo + Vielen Dank! headline + 10 SEKUNDEN countdown + subtext + Naechster Kunde button"
  - "#post-sale-countdown-number span (starts at 10, decrements in Plan 07)"
  - "#post-sale-next-btn button — reuses .bsk-btn + .bsk-btn--primary + .bsk-btn--idle-dismiss (three existing classes, zero new button modifier)"
  - ".bsk-layer--post-sale CSS — z-index 180, background #1A1A1A, pointer-events:auto (mirrors .bsk-layer--idle except z-index)"
  - ".bsk-post-sale-title CSS — 48px/700/#F5C518 branded yellow headline with 16px vertical margin"
  - "Updated z-index ladder comment in host.html with new 180 slot"
affects:
  - "phase-10 plan 07 (host.js overlay lifecycle — showPostSaleOverlay / hidePostSaleOverlay bind to #post-sale-overlay + #post-sale-countdown-number + #post-sale-next-btn added here)"
  - "phase-10 plan 08 (postSale test — countdown number element reset-to-10 assertion targets #post-sale-countdown-number)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-overlay class reuse for visual parity — #post-sale-overlay inherits .bsk-idle-countdown / .bsk-idle-number / .bsk-idle-seconds-label / .bsk-idle-subtext / .bsk-btn--idle-dismiss verbatim; only the headline role differs (.bsk-post-sale-title vs .bsk-idle-title) to signal celebration vs alert intent"
    - "HTML-entity umlauts in host.html (&auml;, &uuml;) per project convention — keeps file ASCII-safe through Windows code-page conversions"
    - "Additive CSS append at true EOF — zero modifications to any existing rule, two new blocks only"

key-files:
  created: []
  modified:
    - src/host/host.html
    - src/host/host.css

key-decisions:
  - "UI-SPEC Component Inventory 1 HTML block copied verbatim — insertion point chosen between #idle-overlay (z-200) and #magicline-error (z-300) to keep overlay DIVs ordered by z-index ascending in source"
  - "Z-index ladder comment updated to reference 01-UI-SPEC + 05-UI-SPEC + 10-UI-SPEC — preamble now points to all three authoritative specs; rules section (lines 23-28) preserved untouched"
  - "Button uses THREE reused classes (.bsk-btn .bsk-btn--primary .bsk-btn--idle-dismiss) with zero new Phase 10 button modifier — D-04 grants discretion; reuse guarantees parity by construction and avoids maintenance drift"
  - ".bsk-post-sale-title uses margin 16px 0 16px 0 (mirrors .bsk-idle-title vertical rhythm) not .bsk-welcome-title's 32px 0 0 0 — post-sale headline sits inside a flex column stack that needs symmetric vertical spacing between logo+title+countdown+subtext+button, not just top-margin"
  - "No @media / @keyframes / animation / transition added — D-03 mandates text-only countdown (no animation); staying in line with the static-UI posture of the idle overlay"

patterns-established:
  - "Layer insertion order in host.html follows z-index ascending — #post-sale-overlay (180) sits between #idle-overlay (200 — existing, comes earlier by a pre-existing quirk) and #magicline-error (300) in source order. Insertion point was the magicline-error line to place post-sale immediately before it."
  - "Brand yellow headline class pattern — .bsk-post-sale-title is the second yellow-headline class (after .bsk-welcome-title). Both at 48px/700/#F5C518, differing only in margin (welcome uses top-only because it stacks above subtext on a tap-everywhere layer; post-sale uses symmetric because it stacks inside a flex column with logo above and countdown below)."

requirements-completed: [SALE-01]  # Partially — SALE-01 spans plans 01, 02, 03, 04, 05, 06, 07, 08, 09, 10; host-side visual surface closed here

# Metrics
duration: ~2 min
completed: 2026-04-23
---

# Phase 10 Plan 06: Host HTML/CSS Post-Sale Layer Summary

**Added #post-sale-overlay z-180 host layer (branded Vielen Dank thank-you card) to host.html + two matching CSS rules (.bsk-layer--post-sale + .bsk-post-sale-title) to host.css — static DOM/CSS only, no behavior wiring (that lands in Plan 07).**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-23T08:05:27Z
- **Completed:** 2026-04-23
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `#post-sale-overlay` DIV inserted in `src/host/host.html` between `#idle-overlay` (z-200) and `#magicline-error` (z-300) — Layer 180 slot per 10-UI-SPEC §Z-Index Map
- "Vielen Dank!" branded yellow headline (48px/700/#F5C518) via new `.bsk-post-sale-title` class
- "10 SEKUNDEN" countdown stack reuses `.bsk-idle-countdown` + `.bsk-idle-number` + `.bsk-idle-seconds-label` verbatim (zero new CSS for countdown)
- "Vielen Dank für Ihren Einkauf!" subtext via reused `.bsk-idle-subtext`
- "Nächster Kunde" button via THREE reused classes: `.bsk-btn` + `.bsk-btn--primary` + `.bsk-btn--idle-dismiss` (zero new button CSS)
- `.bsk-layer--post-sale` CSS — z-index 180, background #1A1A1A, pointer-events:auto (mirrors `.bsk-layer--idle` exactly except for z-index)
- `.bsk-post-sale-title` CSS — 48px/700/#F5C518 branded yellow with 16px vertical margin rhythm
- Z-index ladder comment in host.html updated to include 180 slot and reference 10-UI-SPEC.md
- HTML-entity umlauts throughout (`&auml;` in aria-label + button label, `&uuml;` in subtext) per project convention

## Task Commits

Each task was committed atomically:

1. **Task 1: Add #post-sale-overlay block + update z-index ladder comment in host.html** — `7c9803e` (feat)
2. **Task 2: Add .bsk-layer--post-sale + .bsk-post-sale-title CSS rules to host.css** — `00b1235` (feat)

**Plan metadata:** (to be captured at final docs commit)

## Files Created/Modified

- `src/host/host.html` — Inserted `#post-sale-overlay` DIV block (19 lines) between `#idle-overlay` and `#magicline-error`; updated z-index ladder comment preamble + added `180 — #post-sale-overlay` bullet
- `src/host/host.css` — Appended Phase 10 block at EOF (28 lines total): banner comment + `.bsk-layer--post-sale` rule + `.bsk-post-sale-title` rule

## Exact HTML Block Inserted

```html
  <!-- LAYER 180: Post-sale overlay (Phase 10 D-04) -->
  <div id="post-sale-overlay"
       class="bsk-layer bsk-layer--post-sale"
       style="display:none;"
       aria-hidden="true"
       role="dialog"
       aria-label="Einkauf best&auml;tigt">
    <img src="assets/logo-dark.png" class="bsk-logo" alt="Bee Strong Fitness" width="160">
    <h1 class="bsk-heading bsk-post-sale-title">Vielen Dank!</h1>
    <div class="bsk-idle-countdown" aria-live="polite">
      <span id="post-sale-countdown-number" class="bsk-idle-number">10</span>
      <span class="bsk-idle-seconds-label">SEKUNDEN</span>
    </div>
    <p class="bsk-idle-subtext">Vielen Dank f&uuml;r Ihren Einkauf!</p>
    <button type="button"
            id="post-sale-next-btn"
            class="bsk-btn bsk-btn--primary bsk-btn--idle-dismiss">
      N&auml;chster Kunde
    </button>
  </div>
```

## Z-Index Ladder Comment Diff

Before:
```
    Z-index ladder (per 01-UI-SPEC.md + 05-UI-SPEC.md):
      0   — #magicline-mount — Phase 2 BrowserView attach point
      100 — #splash — Phase 1 branded splash cover
      150 — #welcome-screen — Phase 6 welcome/resting layer (D-02)
      200 — #idle-overlay — Phase 4 idle "Noch da?" overlay
```

After:
```
    Z-index ladder (per 01-UI-SPEC.md + 05-UI-SPEC.md + 10-UI-SPEC.md):
      0   — #magicline-mount — Phase 2 BrowserView attach point
      100 — #splash — Phase 1 branded splash cover
      150 — #welcome-screen — Phase 6 welcome/resting layer (D-02)
      180 — #post-sale-overlay — Phase 10 branded "Vielen Dank" layer (D-04)
      200 — #idle-overlay — Phase 4 idle "Noch da?" overlay
```

Preamble updated to reference 10-UI-SPEC.md; new 180 bullet inserted in ascending-z-index order between welcome (150) and idle (200). Rules section (lines 23-28) preserved untouched. Entries for 300/400/500 layers unchanged.

## Exact CSS Block Appended

```css
/* ============================================================ */
/* Phase 10 — Post-sale overlay (Layer 180, D-03/D-04)          */
/* ============================================================ */
/* Mirrors .bsk-layer--idle exactly: opaque dark background,    */
/* full-viewport flex column stack, captures all touches.       */
/* Sits between welcome (z-150) and idle (z-200) — no other     */
/* layer occupies z-180 (host.html z-index ladder comment).     */

.bsk-layer--post-sale {
  z-index: 180;
  background: #1A1A1A;
  pointer-events: auto;
}

/* Headline — branded yellow display, matches .bsk-welcome-title size/weight
   for cross-overlay parity. NOT reusing .bsk-idle-title because that role
   is "are you still there?" alert (24px white), not a celebration headline. */
.bsk-post-sale-title {
  font-size: 48px;
  font-weight: 700;
  color: #F5C518;
  text-align: center;
  margin: 16px 0 16px 0;
  letter-spacing: 0.02em;
  line-height: 1.2;
  max-width: 80vw;
}
```

Appended at true EOF (line 679 `}` → line 680 blank → Phase 10 banner begins at line 681). No existing CSS rule modified — `grep -c ".bsk-layer--idle " src/host/host.css` returns 3 (unchanged), `grep -c ".bsk-idle-number" src/host/host.css` returns 1 (unchanged).

## Confirmation: Zero Existing Rule Modified

`git show --stat 00b1235 src/host/host.css` shows `1 file changed, 28 insertions(+)` — pure insertion, zero deletions. Manual diff confirms the append is pinned to the end of file after the existing `.bsk-admin-close:active` closing brace; no in-place edits to any prior Phase 01-09 rule.

## Confirmation: No Raw Unicode Umlauts in New Markup

All four umlaut-bearing strings in the new DIV use HTML entities:

- `aria-label="Einkauf best&auml;tigt"` → renders "Einkauf bestätigt"
- `<p class="bsk-idle-subtext">Vielen Dank f&uuml;r Ihren Einkauf!</p>` → renders "Vielen Dank für Ihren Einkauf!"
- `N&auml;chster Kunde` (button label) → renders "Nächster Kunde"

`grep -P "[^\x00-\x7F]"` on the inserted block matches only the existing em-dashes/bullets inside the surrounding ladder comment (pre-existing, not introduced by this plan).

## Visual Verification Notes (Deferred to Plan 07)

This plan delivers static DOM + CSS only. Visual verification via DevTools `display: flex` on `#post-sale-overlay` is deferred to Plan 07 execution, when the host.js lifecycle handlers can exercise the full show/hide/countdown flow. At that point the acceptance check is:

- Open packaged app, force `document.getElementById('post-sale-overlay').style.display = 'flex'` via DevTools
- Expect: full-viewport `#1A1A1A` background, centered logo (160 px), yellow "Vielen Dank!" 48 px headline, 80 px yellow "10" with "SEKUNDEN" label, white subtext, yellow "Nächster Kunde" button
- Expect: layout matches 10-UI-SPEC §Wireframe vertical rhythm (logo → headline → countdown → subtext → button)

## Decisions Made

- **UI-SPEC Component Inventory 1 HTML block copied verbatim** — 10-UI-SPEC is approved; no discretionary edits applied.
- **Insertion point chosen as `#magicline-error` line** — keeps z-index-ascending source ordering (post-sale 180 immediately before error 300; idle 200 remains out of order for a pre-existing reason: it was present before this ladder extension).
- **Button reuses three existing classes with no new Phase-10 modifier** — D-04 grants discretion; construction-level parity with `.bsk-btn--idle-dismiss` is preferred over a new alias that could drift.
- **Headline margin `16px 0 16px 0`** (mirrors `.bsk-idle-title`) rather than `.bsk-welcome-title`'s `32px 0 0 0` — needed for symmetric vertical rhythm inside the flex column stack.

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed in a single pass; all grep assertions and count assertions passed on first run.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 07 (host-js-overlay-lifecycle) unblocked** — `#post-sale-overlay`, `#post-sale-countdown-number`, and `#post-sale-next-btn` DOM nodes exist and are addressable via `document.getElementById`. Plan 07's showPostSaleOverlay/hidePostSaleOverlay + countdown setInterval + button handler can bind directly.
- **Plan 08 (postSale test) unblocked for overlay-element assertions** — countdown-number reset-to-10 test can assert against the `#post-sale-countdown-number` ID.
- **No blockers for downstream Phase 10 plans.**

## Self-Check

File existence verified via `grep` assertions passing in the Task 1 and Task 2 verification phases:

- `src/host/host.html` contains `id="post-sale-overlay"`, `id="post-sale-countdown-number"`, `id="post-sale-next-btn"`, `class="bsk-layer bsk-layer--post-sale"`, `class="bsk-heading bsk-post-sale-title"`, `180 — #post-sale-overlay`, `N&auml;chster Kunde`, `Einkauf best&auml;tigt`, `Vielen Dank f&uuml;r Ihren Einkauf!`, `Vielen Dank!`
- `src/host/host.css` contains `.bsk-layer--post-sale {` (count: 1), `.bsk-post-sale-title {` (count: 1), `z-index: 180;`, `color: #F5C518;`, `background: #1A1A1A;` in the new block; existing `.bsk-layer--idle ` (count: 3) and `.bsk-idle-number` (count: 1) preserved.

Commits verified via `git log --oneline -5`:

- `7c9803e` feat(10-06): add #post-sale-overlay block + z-index 180 slot to host.html — FOUND
- `00b1235` feat(10-06): add .bsk-layer--post-sale + .bsk-post-sale-title CSS rules — FOUND

## Self-Check: PASSED

---
*Phase: 10-post-sale-flow-with-print-interception*
*Plan: 06*
*Completed: 2026-04-23*
