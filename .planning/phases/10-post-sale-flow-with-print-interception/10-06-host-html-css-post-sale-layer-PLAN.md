---
phase: 10-post-sale-flow-with-print-interception
plan: 06
type: execute
wave: 2
depends_on: [02]
files_modified:
  - src/host/host.html
  - src/host/host.css
autonomous: true
requirements: [SALE-01]
tags: [host-ui, overlay, z-index, css, phase-10]
must_haves:
  truths:
    - "#post-sale-overlay layer exists with z-index 180, opaque #1A1A1A background, display:none by default"
    - "#post-sale-countdown-number span exists with class .bsk-idle-number (text-only countdown)"
    - "#post-sale-next-btn button exists with class .bsk-btn.bsk-btn--primary.bsk-btn--idle-dismiss (reuse)"
    - "'Vielen Dank!' headline renders in branded yellow via new .bsk-post-sale-title class (48px / 700 / #F5C518)"
    - "Subtext 'Vielen Dank für Ihren Einkauf!' renders via reused .bsk-idle-subtext"
    - "Z-index ladder comment in host.html updated to include 180 slot"
  artifacts:
    - path: "src/host/host.html"
      provides: "#post-sale-overlay layer + updated z-index ladder comment"
      contains: "post-sale-overlay"
    - path: "src/host/host.css"
      provides: ".bsk-layer--post-sale + .bsk-post-sale-title CSS rules"
      contains: "bsk-layer--post-sale"
  key_links:
    - from: "src/host/host.html #post-sale-overlay"
      to: ".bsk-layer.bsk-layer--post-sale CSS"
      via: "class attribute binding"
      pattern: "bsk-layer bsk-layer--post-sale"
    - from: "src/host/host.html #post-sale-next-btn"
      to: ".bsk-btn.bsk-btn--primary.bsk-btn--idle-dismiss (reused — no new CSS)"
      via: "class attribute with three existing classes"
      pattern: "bsk-btn--idle-dismiss"
---

<objective>
Add the visual surface for the post-sale overlay per the APPROVED 10-UI-SPEC.md:

- `#post-sale-overlay` layer at z-index 180, opaque `#1A1A1A` background (mirrors `.bsk-layer--idle` exactly)
- "Vielen Dank!" headline in branded yellow (48px / 700 / `#F5C518`), new `.bsk-post-sale-title` class
- Countdown stack reusing `.bsk-idle-countdown` / `.bsk-idle-number` / `.bsk-idle-seconds-label` (zero new CSS)
- Subtext reusing `.bsk-idle-subtext`
- "Nächster Kunde" button reusing `.bsk-btn.bsk-btn--primary.bsk-btn--idle-dismiss`
- Updated z-index ladder comment documenting the new 180 slot

Purpose: Pure static DOM + CSS. No behavior — all show/hide/countdown logic lives in host.js (Plan 07). This plan makes the overlay renderable; Plan 07 makes it interactive.

Output: Single `<div id="post-sale-overlay">` block appended between `#idle-overlay` and `#magicline-error` + two new CSS blocks (`.bsk-layer--post-sale` + `.bsk-post-sale-title`). HTML-entity umlauts per host.html convention. All D-01..D-04 and UI-SPEC specs honored.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-UI-SPEC.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-02-SUMMARY.md
@./CLAUDE.md

<interfaces>
z-index ladder (host.html lines 12-28) — current state:
```
0   — #magicline-mount — Phase 2 BrowserView attach point
100 — #splash — Phase 1 branded splash cover
150 — #welcome-screen — Phase 6 welcome/resting layer (D-02)
200 — #idle-overlay — Phase 4 idle "Noch da?" overlay
300 — #magicline-error (Phase 2/3 variants + Phase 5 bad-release, update-failed)
300 — #updating-cover — Phase 5 mutually exclusive with #magicline-error
400 — #credentials-overlay + #pin-modal (Phase 3 + Phase 5 admin PIN lockout panel)
500 — #admin-menu + #update-config — Phase 5 (mutually exclusive)
```

Existing #idle-overlay block (host.html lines 50-69) — direct template:
```
<!-- LAYER 200: Idle overlay (Phase 4) -->
<div id="idle-overlay"
     class="bsk-layer bsk-layer--idle"
     style="display:none;"
     aria-hidden="true"
     role="dialog"
     aria-label="Möchten Sie fortfahren?">
  <img src="assets/logo-dark.png" class="bsk-logo" alt="Bee Strong Fitness" width="160">
  <h1 class="bsk-heading bsk-idle-title">Noch da?</h1>
  <div class="bsk-idle-countdown" aria-live="polite">
    <span id="idle-countdown-number" class="bsk-idle-number">10</span>
    <span class="bsk-idle-seconds-label">SEKUNDEN</span>
  </div>
  <p class="bsk-idle-subtext">Tippe irgendwo, um fortzufahren.</p>
  <button type="button"
          id="idle-dismiss-btn"
          class="bsk-btn bsk-btn--primary bsk-btn--idle-dismiss">
    Weiter
  </button>
</div>
```

Existing .bsk-layer--idle CSS (host.css lines 362-366):
```
.bsk-layer--idle {
  z-index: 200;
  background: #1A1A1A;
  pointer-events: auto;
}
```

Existing .bsk-welcome-title CSS (host.css lines 110-120) — size/weight template for .bsk-post-sale-title:
```
.bsk-welcome-title {
  font-size: 48px;
  font-weight: 700;
  color: #F5C518;
  text-align: center;
  margin: 32px 0 0 0;
  letter-spacing: 0.02em;
  text-transform: none;
  max-width: 80vw;
  line-height: 1.2;
}
```

Umlaut convention (verified in host.html): HTML entities for ä (&auml;), ü (&uuml;), ß (&szlig;).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add #post-sale-overlay block + update z-index ladder comment in host.html</name>
  <read_first>
    - src/host/host.html (current — z-index ladder comment at lines 12-28, #idle-overlay block at 50-69, #magicline-error block at 71-79)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-UI-SPEC.md §Component Inventory 1 (exact HTML block) and §Z-Index Map
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §host.html (analog reference)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-01..D-04 (dismiss UX, countdown)
  </read_first>
  <files>src/host/host.html</files>
  <action>
Make TWO additive changes in `src/host/host.html`.

**Change A — update the z-index ladder comment (lines 12-28).**

Find the existing comment block that lists z-index slots. Insert a new bullet line between the `200 — #idle-overlay` line and the `300 — #magicline-error` line. Also update the preamble to reference UI-SPEC 10.

Find the existing comment:
```
    Z-index ladder (per 01-UI-SPEC.md + 05-UI-SPEC.md):
      0   — #magicline-mount — Phase 2 BrowserView attach point
      100 — #splash — Phase 1 branded splash cover
      150 — #welcome-screen — Phase 6 welcome/resting layer (D-02)
      200 — #idle-overlay — Phase 4 idle "Noch da?" overlay
```

Replace with:
```
    Z-index ladder (per 01-UI-SPEC.md + 05-UI-SPEC.md + 10-UI-SPEC.md):
      0   — #magicline-mount — Phase 2 BrowserView attach point
      100 — #splash — Phase 1 branded splash cover
      150 — #welcome-screen — Phase 6 welcome/resting layer (D-02)
      180 — #post-sale-overlay — Phase 10 branded "Vielen Dank" layer (D-04)
      200 — #idle-overlay — Phase 4 idle "Noch da?" overlay
```

Do NOT modify the rest of the ladder comment (rules section, 300/400/500 entries).

**Change B — insert the #post-sale-overlay DIV between #idle-overlay (ends with `</div>` at line 69) and `#magicline-error` (starts at line 71).**

Find this exact line sequence (line 69 closing the idle-overlay div, line 70 empty, line 71 starting magicline-error):
```
  </div>

  <div id="magicline-error" class="bsk-layer bsk-layer--magicline-error" ...
```

Insert BEFORE the `<div id="magicline-error" ...>` line:

```

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

**Critical:**
- Use HTML entities for umlauts: `best&auml;tigt` (aria-label), `f&uuml;r` (subtext), `N&auml;chster` (button label). Matches the existing convention used in host.html (lines 56, 73, and throughout).
- `display:none;` in the `style` attribute — same as all other overlays. host.js (Plan 07) toggles via `style.display = 'flex'`.
- `aria-hidden="true"` at initial state — host.js toggles to `"false"` on show.
- The countdown number starts at `"10"` in the HTML; host.js resets to `"10"` on every show (race-safety) — the value in HTML is the default before the first show.
- Reuse `.bsk-idle-countdown`, `.bsk-idle-number`, `.bsk-idle-seconds-label`, `.bsk-idle-subtext`, `.bsk-btn--idle-dismiss` verbatim — no new classes beyond `.bsk-layer--post-sale` and `.bsk-post-sale-title`.
- The button has THREE classes: `bsk-btn`, `bsk-btn--primary`, `bsk-btn--idle-dismiss`. Do NOT add any Phase 10-specific button modifier.
- The `<h1>` uses TWO classes: `bsk-heading` and `bsk-post-sale-title` — matches the `bsk-heading bsk-idle-title` pattern on the idle overlay.
  </action>
  <verify>
    <automated>grep -q "post-sale-overlay" src/host/host.html &amp;&amp; grep -q "post-sale-countdown-number" src/host/host.html &amp;&amp; grep -q "post-sale-next-btn" src/host/host.html &amp;&amp; grep -q "bsk-layer--post-sale" src/host/host.html &amp;&amp; grep -q "bsk-post-sale-title" src/host/host.html &amp;&amp; grep -q "Vielen Dank!" src/host/host.html &amp;&amp; grep -q "180 — #post-sale-overlay" src/host/host.html &amp;&amp; grep -q "N&auml;chster Kunde" src/host/host.html</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `id="post-sale-overlay"`
    - File contains exact substring `id="post-sale-countdown-number"`
    - File contains exact substring `id="post-sale-next-btn"`
    - File contains exact substring `class="bsk-layer bsk-layer--post-sale"`
    - File contains exact substring `class="bsk-heading bsk-post-sale-title"`
    - File contains exact substring `class="bsk-btn bsk-btn--primary bsk-btn--idle-dismiss"` (inside the post-sale-next-btn button)
    - File contains exact substring `Vielen Dank!`
    - File contains exact substring `Vielen Dank f&uuml;r Ihren Einkauf!`
    - File contains exact substring `N&auml;chster Kunde`
    - File contains exact substring `Einkauf best&auml;tigt` (aria-label)
    - File contains exact substring `180 — #post-sale-overlay`
    - File contains exact substring `aria-live="polite"` on the post-sale countdown wrapper
    - File contains exact substring `style="display:none;"` on the new overlay
    - `grep -c "id=\"post-sale" src/host/host.html` returns >= 3 (overlay + countdown-number + next-btn)
    - The existing `#idle-overlay` block is unchanged
    - The existing `#magicline-error` block is unchanged
    - The existing `#welcome-screen` block is unchanged
    - No raw Unicode umlaut characters in the new HTML block (only HTML entities)
  </acceptance_criteria>
  <done>
    Post-sale overlay DIV inserted between idle and error layers with correct id, classes, role, aria-label, aria-hidden, display:none, and HTML-entity umlauts. Z-index ladder comment updated. No other block modified.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add .bsk-layer--post-sale + .bsk-post-sale-title CSS rules to host.css</name>
  <read_first>
    - src/host/host.css (current — .bsk-layer--idle at lines 362-366, .bsk-welcome-title at 110-120, end-of-file)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-UI-SPEC.md §Component Inventory 1 (exact CSS block) and §Color
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §host.css
  </read_first>
  <files>src/host/host.css</files>
  <action>
Append TWO new CSS blocks at the END of `src/host/host.css`. Do NOT modify any existing rule.

**Exact CSS to append (copy verbatim from 10-UI-SPEC.md):**

```
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

**Critical:**
- Append at the TRUE end of the file (after any trailing newline). Do NOT inject in the middle.
- `.bsk-layer--post-sale` mirrors `.bsk-layer--idle` EXCEPT for z-index (180 vs 200). Background and pointer-events are identical.
- `.bsk-post-sale-title` mirrors `.bsk-welcome-title` size/weight/color, but with `margin: 16px 0 16px 0` (matches `.bsk-idle-title` margin, not `.bsk-welcome-title` 32px top margin) — this gives the headline proper vertical rhythm inside the flex column stack.
- Use the exact hex colors: `#1A1A1A` (dominant background), `#F5C518` (brand yellow) — do NOT use near-shades or CSS variables (project doesn't define any yet).
- Do NOT add any @media query, animation, or transition — the countdown is text-only per D-03 (no animation).
- Do NOT modify `.bsk-layer--idle`, `.bsk-welcome-title`, `.bsk-idle-title`, `.bsk-idle-number`, `.bsk-idle-seconds-label`, `.bsk-idle-subtext`, `.bsk-btn--idle-dismiss`, or any other existing rule.
  </action>
  <verify>
    <automated>grep -q ".bsk-layer--post-sale" src/host/host.css &amp;&amp; grep -q ".bsk-post-sale-title" src/host/host.css &amp;&amp; grep -q "z-index: 180" src/host/host.css &amp;&amp; grep -q "color: #F5C518" src/host/host.css &amp;&amp; grep -q "background: #1A1A1A" src/host/host.css</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `.bsk-layer--post-sale {`
    - File contains exact substring `.bsk-post-sale-title {`
    - File contains exact substring `z-index: 180;` (inside .bsk-layer--post-sale block)
    - File contains exact substring `font-size: 48px;` inside .bsk-post-sale-title
    - File contains exact substring `color: #F5C518;` inside .bsk-post-sale-title
    - File contains exact substring `background: #1A1A1A;` inside .bsk-layer--post-sale
    - `grep -c ".bsk-layer--post-sale" src/host/host.css` returns exactly 1
    - `grep -c ".bsk-post-sale-title" src/host/host.css` returns exactly 1
    - `grep -c ".bsk-layer--idle " src/host/host.css` returns at least 1 (existing rule still present)
    - `grep -c ".bsk-idle-number" src/host/host.css` returns at least 1 (existing rule reused)
    - No new @media, @keyframes, animation, or transition rule introduced
    - New rules appended at END of file (after the last existing Phase 09 rule)
  </acceptance_criteria>
  <done>
    Two new CSS blocks at end of host.css. z-index 180, background #1A1A1A, pointer-events auto. Headline rule with brand yellow 48px bold. All other CSS unchanged.
  </done>
</task>

</tasks>

<verification>
- `grep "post-sale-overlay" src/host/host.html` — matches the new DIV
- `grep "180 — #post-sale-overlay" src/host/host.html` — ladder comment updated
- `grep "bsk-layer--post-sale" src/host/host.css` — CSS rule present
- `grep "bsk-post-sale-title" src/host/host.css` — CSS rule present
- Open host.html in a browser (or dev mode) and set `display:flex` on #post-sale-overlay via DevTools: the overlay should render full-viewport with dark background, yellow "Vielen Dank!" headline, "10 SEKUNDEN" countdown, German subtext, and a yellow "Nächster Kunde" button — matching UI-SPEC §Wireframe
</verification>

<success_criteria>
- #post-sale-overlay DIV exists in host.html with correct ids, classes, role, aria-label
- Two new CSS rules in host.css (.bsk-layer--post-sale at z-180, .bsk-post-sale-title in brand yellow)
- Zero new visual primitives beyond these two CSS rules — all other styling reuses existing classes
- HTML-entity umlauts throughout new markup
- Z-index ladder comment updated to document the 180 slot
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-06-SUMMARY.md` documenting:
- The exact HTML block inserted + the ladder-comment diff
- The exact CSS block appended
- Visual verification screenshot notes (if captured via DevTools display:flex trick)
- Confirmation zero existing CSS rule modified
- Confirmation no raw Unicode umlauts in new markup (all HTML entities)
</output>
