---
phase: 10-post-sale-flow-with-print-interception
plan: 07
type: execute
wave: 3
depends_on: [05, 06]
files_modified:
  - src/host/host.js
autonomous: true
requirements: [SALE-01]
tags: [host-js, overlay, countdown, race-guard, ipc-subscriber, phase-10]
must_haves:
  truths:
    - "window.kiosk.onShowPostSale(showPostSaleOverlay) subscribed during wireIpcListeners"
    - "window.kiosk.onHidePostSale(hidePostSaleOverlay) subscribed during wireIpcListeners"
    - "showPostSaleOverlay() resets postSaleResolved=false, sets countdown=10, displays overlay, starts 1s interval"
    - "On countdown reaching 0 with postSaleResolved=false: sets flag true, hides overlay, calls window.kiosk.notifyPostSaleAutoLogout()"
    - "Button click on #post-sale-next-btn with postSaleResolved=false: sets flag true, hides overlay, calls window.kiosk.notifyPostSaleNextCustomer()"
    - "postSaleResolved first-wins guard: second path (button after expiry OR expiry after button) is a silent no-op"
    - "Stale interval cleared on every show() to guard against double-show race"
  artifacts:
    - path: "src/host/host.js"
      provides: "postSaleResolved + postSaleInterval state, showPostSaleOverlay(), hidePostSaleOverlay(), button click handler, IPC subscribers"
      contains: "showPostSaleOverlay"
  key_links:
    - from: "src/host/host.js #post-sale-next-btn click handler"
      to: "window.kiosk.notifyPostSaleNextCustomer()"
      via: "addEventListener('click') with postSaleResolved guard"
      pattern: "notifyPostSaleNextCustomer"
    - from: "src/host/host.js setInterval countdown expiry"
      to: "window.kiosk.notifyPostSaleAutoLogout()"
      via: "countdown <= 0 branch with postSaleResolved guard"
      pattern: "notifyPostSaleAutoLogout"
---

<objective>
Implement the post-sale overlay lifecycle in `src/host/host.js`:

1. Module-scoped `postSaleResolved` + `postSaleInterval` state alongside existing `idleInterval` (line 291)
2. `showPostSaleOverlay()` function (near-verbatim clone of `showIdleOverlay()` at lines 315-344, substituting IDs and adding first-wins guard per D-08)
3. `hidePostSaleOverlay()` function (clones `hideIdleOverlayDom` lines 303-313)
4. Button click handler for `#post-sale-next-btn` inside the `wireIpcListeners()` block
5. IPC subscriber registrations for `onShowPostSale` / `onHidePostSale`

Purpose: This is the renderer-side bookend of Plan 05's main-process orchestration. host.js receives `post-sale:show` → shows overlay + countdown → on resolution (button OR auto-expiry) sends the corresponding IPC back. All show/hide/countdown logic lives here; main.js drives only via IPC.

RESEARCH REFERENCE: `postSaleResolved` is the D-08 first-wins race guard owned by host.js (D-09). It handles the "tap at second 9.95 while auto-dismiss is about to fire" race without timing-dependent UI changes.

Output: 5 additive changes in host.js. Existing functions (showIdleOverlay, dismissIdleOverlay, wireIpcListeners structure) are NOT modified.
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
@.planning/phases/10-post-sale-flow-with-print-interception/10-05-SUMMARY.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-06-SUMMARY.md
@./CLAUDE.md

<interfaces>
Existing state declarations (host.js lines 291-301):
```
var idleInterval = null;
var posOpenState = true;
var pinModalContext = 'admin';
var lockoutInterval = null;
var adminUpdateResultTimer = null;
var updateFailedTimer = null;
var updateFailedHandler = null;
```

Existing hideIdleOverlayDom (host.js lines 303-313 — template for hidePostSaleOverlay):
```
function hideIdleOverlayDom() {
  if (idleInterval) {
    clearInterval(idleInterval);
    idleInterval = null;
  }
  var overlay = document.getElementById('idle-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }
}
```

Existing showIdleOverlay (host.js lines 315-344 — direct template for showPostSaleOverlay):
```
function showIdleOverlay() {
  var overlay = document.getElementById('idle-overlay');
  var numEl = document.getElementById('idle-countdown-number');
  if (!overlay || !numEl) return;
  if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
  var countdown = 10;
  numEl.textContent = '10';
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  idleInterval = setInterval(function () {
    countdown -= 1;
    numEl.textContent = String(countdown);
    if (countdown <= 0) {
      clearInterval(idleInterval);
      idleInterval = null;
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      try {
        if (window.kiosk && window.kiosk.notifyIdleExpired) {
          window.kiosk.notifyIdleExpired();
        }
      } catch (e) { /* ignore */ }
    }
  }, 1000);
}
```

Existing wireIpcListeners block with onShow*/onHide* registrations (host.js lines 1100-1177):
- Pattern: `if (window.kiosk.onShowIdleOverlay) window.kiosk.onShowIdleOverlay(showIdleOverlay);`
- Also contains button click handler wiring for other overlays

Phase 10 kiosk IPC surface (from Plan 02):
- window.kiosk.onShowPostSale(cb) — subscribe to 'post-sale:show'
- window.kiosk.onHidePostSale(cb) — subscribe to 'post-sale:hide'
- window.kiosk.notifyPostSaleNextCustomer() — send 'post-sale:next-customer'
- window.kiosk.notifyPostSaleAutoLogout() — send 'post-sale:auto-logout'

UMLAUT HANDLING: host.js strings use \u escape sequences (NOT raw Unicode), per UI-SPEC §Copywriting:
- 'N\u00E4chster Kunde' (not used in this plan — label is in HTML, not JS)
- Any JS-side German strings in this plan: use \u escapes (this plan has no JS-side German strings; the label is in HTML)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add postSaleResolved + postSaleInterval state, showPostSaleOverlay + hidePostSaleOverlay functions</name>
  <read_first>
    - src/host/host.js (current — lines 280-360 region: state declarations + idle overlay functions)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §host.js (exact function bodies for show/hide/button-handler)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-UI-SPEC.md §Interaction Contract (countdown tick, dismiss, race guard semantics)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-08/D-09 (first-wins flag location + ownership)
  </read_first>
  <files>src/host/host.js</files>
  <action>
Make TWO additive changes in `src/host/host.js` in the overlay state/functions region (lines 280-360).

**Change A — add postSaleResolved + postSaleInterval state declarations.**

Find the existing `var idleInterval = null;` declaration (line 291). Insert immediately AFTER:

```
  // Phase 10 D-08/D-09: first-trigger-wins race guard (host-side). Both
  // dismiss paths (button tap, countdown expiry) check-and-set this flag;
  // the second-to-fire is a silent no-op. Reset on every showPostSaleOverlay()
  // call. postSaleInterval holds the 1s countdown setInterval id.
  var postSaleResolved = false;
  var postSaleInterval = null;
```

**Change B — add showPostSaleOverlay + hidePostSaleOverlay functions.**

Find the existing `function dismissIdleOverlay() {` (around line 346 — this is the END of the idle-overlay function group). Insert IMMEDIATELY AFTER its closing `}` (which is at line 355, followed by a blank line and the `// ===` Phase 3 Credentials comment banner around line 357).

Insert:
```

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

**Critical:**
- Use `var` (not `const/let`) and `function` declarations — matches existing host.js style throughout.
- The first-wins guard check `if (postSaleResolved) return;` MUST be placed AFTER `clearInterval` but BEFORE any DOM mutation or IPC call — this mirrors PATTERNS §host.js exactly. If the guard check were placed FIRST, the stale interval would never clear.
- `postSaleResolved = true` is set BEFORE the IPC notify — this prevents a reentrant click during the IPC send from triggering a second path (host.js event dispatch is synchronous; this is defensive but matches the idle-overlay style).
- Do NOT add any tap-anywhere dismiss listener on the overlay itself — D-01 explicitly rejects tap-anywhere. The overlay's `pointer-events: auto` from host.css is SOLELY to block pointer-throughs to the cash register beneath, NOT to fire dismiss.
- Do NOT modify `hideIdleOverlayDom`, `showIdleOverlay`, or `dismissIdleOverlay` — those are separate overlays with different dismiss semantics.
- Do NOT add an Esc keydown handler — D-02 explicitly rejects Esc as a dismiss path. The existing admin-menu Esc handler at lines 1181-1202 does NOT apply to post-sale (it checks `adminMenu.style.display === 'none'` and returns early; no conflict).
  </action>
  <verify>
    <automated>grep -q "var postSaleResolved = false" src/host/host.js &amp;&amp; grep -q "var postSaleInterval = null" src/host/host.js &amp;&amp; grep -q "function showPostSaleOverlay" src/host/host.js &amp;&amp; grep -q "function hidePostSaleOverlay" src/host/host.js &amp;&amp; grep -q "notifyPostSaleAutoLogout" src/host/host.js &amp;&amp; grep -q "'post-sale-overlay'" src/host/host.js &amp;&amp; grep -q "'post-sale-countdown-number'" src/host/host.js &amp;&amp; node --check src/host/host.js</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `var postSaleResolved = false;`
    - File contains exact substring `var postSaleInterval = null;`
    - File contains exact substring `function showPostSaleOverlay()`
    - File contains exact substring `function hidePostSaleOverlay()`
    - File contains exact substring `document.getElementById('post-sale-overlay')` (appears in both show and hide functions)
    - File contains exact substring `document.getElementById('post-sale-countdown-number')`
    - File contains exact substring `window.kiosk.notifyPostSaleAutoLogout()`
    - File contains exact substring `if (postSaleResolved) return;` inside showPostSaleOverlay
    - File contains exact substring `postSaleResolved = true;` inside showPostSaleOverlay
    - `grep -c "postSaleInterval" src/host/host.js` returns >= 4 (declaration + clear-on-entry + assign + clear-on-expiry + clear-on-hide)
    - `node --check src/host/host.js` exits 0
    - Existing showIdleOverlay is unchanged
    - Existing hideIdleOverlayDom is unchanged
    - Existing dismissIdleOverlay is unchanged
    - No `const`, `let`, or arrow function introduced in new code
  </acceptance_criteria>
  <done>
    postSaleResolved + postSaleInterval declared. showPostSaleOverlay + hidePostSaleOverlay functions defined with first-wins race guard. File syntactically valid. Idle overlay code unchanged.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire #post-sale-next-btn click handler + IPC subscribers inside wireIpcListeners</name>
  <read_first>
    - src/host/host.js (current — wireIpcListeners region near lines 1095-1180, specifically the block around lines 1127-1145 where Phase 4/6/9 subscribers live)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §host.js Analog D (IPC subscriber registration pattern)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-06/D-08 (button semantics, first-wins)
  </read_first>
  <files>src/host/host.js</files>
  <action>
Make TWO additive changes inside `wireIpcListeners()` (host.js lines ~1090-1180).

**Change A — add button click handler for `#post-sale-next-btn`.**

Locate the existing wireIpcListeners function body. The function contains a block that wires static button handlers (e.g. `#idle-dismiss-btn`). Find the most appropriate insertion point — SEARCH for where the idle dismiss button is wired (likely inside wireStatic or wireIpcListeners). If the existing idle button wiring uses `addEventListener('click', dismissIdleOverlay)` in a `wireStatic` block (called alongside wireIpcListeners), match the same location. Check the file structure; if `wireStatic` is the place where `addEventListener` calls live, add there; otherwise add inside wireIpcListeners alongside the IPC subscribers.

Insert this block (pick the correct sibling location based on where `#idle-dismiss-btn` is wired):

```
    // Phase 10 D-01/D-06/D-08: Nächster Kunde button — keeps Magicline
    // session alive, rearms idle timer. First-wins guard prevents
    // double-fire with the countdown auto-expiry path.
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

**Change B — add IPC subscriber registrations immediately AFTER the existing Phase 9 `onPosStateChanged` block.**

Find the existing block in wireIpcListeners:
```
    // Phase 09 — POS state changed subscriber
    if (window.kiosk.onPosStateChanged) {
      window.kiosk.onPosStateChanged(function (payload) { ... });
    }
```

Insert IMMEDIATELY AFTER its closing `}`:

```
    // Phase 10 — Post-sale overlay IPC subscribers (D-19)
    if (window.kiosk.onShowPostSale) window.kiosk.onShowPostSale(showPostSaleOverlay);
    if (window.kiosk.onHidePostSale) window.kiosk.onHidePostSale(hidePostSaleOverlay);
```

**Critical:**
- Place the BUTTON click handler in the same code location as the existing `#idle-dismiss-btn` handler (inspect the file to find the exact location — could be inside `wireStatic`, inside `wireIpcListeners`, or a separate `wireEvents` block). Whatever pattern exists for idle, match it for post-sale.
- The IPC SUBSCRIBERS go inside `wireIpcListeners` alongside the other `if (window.kiosk.onShow*)` calls — placement right after Phase 09 per the existing ordering convention.
- Both `if` guards (`if (window.kiosk.onShowPostSale)`) are defensive — matches the existing idempotent-fallback pattern used throughout wireIpcListeners.
- The button handler uses `postSaleResolved` directly (not `window.postSaleResolved`) because it's in the same IIFE closure as the state declaration from Task 1.
- Do NOT modify existing Phase 4 idle-overlay IPC subscribers, existing Phase 6 welcome subscribers, existing Phase 08 PIN change subscribers, or existing Phase 09 POS state subscriber.
- Do NOT add a tap-anywhere listener on `#post-sale-overlay` itself — button-only dismiss per D-01.
- Do NOT add an Esc key handler for post-sale — D-02. The existing admin-menu Esc handler at lines 1181-1202 explicitly returns when `adminMenu.style.display === 'none'`, so it does NOT fire for post-sale regardless.
  </action>
  <verify>
    <automated>grep -q "post-sale-next-btn" src/host/host.js &amp;&amp; grep -q "notifyPostSaleNextCustomer" src/host/host.js &amp;&amp; grep -q "onShowPostSale(showPostSaleOverlay)" src/host/host.js &amp;&amp; grep -q "onHidePostSale(hidePostSaleOverlay)" src/host/host.js &amp;&amp; node --check src/host/host.js</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `document.getElementById('post-sale-next-btn')`
    - File contains exact substring `window.kiosk.notifyPostSaleNextCustomer()`
    - File contains exact substring `window.kiosk.onShowPostSale(showPostSaleOverlay)`
    - File contains exact substring `window.kiosk.onHidePostSale(hidePostSaleOverlay)`
    - File contains exact substring `if (postSaleResolved) return;` inside the button click handler (not just inside showPostSaleOverlay)
    - `grep -c "postSaleResolved = true" src/host/host.js` returns exactly 2 (once in showPostSaleOverlay countdown-expiry, once in button click handler)
    - `grep -c "postSaleResolved" src/host/host.js` returns >= 5 (declaration + reset + 2× true-set + 2× guard check)
    - `node --check src/host/host.js` exits 0
    - Existing `#idle-dismiss-btn` click handler is unchanged
    - Existing `onShowIdleOverlay` / `onHideIdleOverlay` subscribers are unchanged
    - Existing `onPosStateChanged` subscriber is unchanged
    - Existing admin-menu Esc handler (lines 1181-1202) is unchanged
    - No tap-anywhere pointerdown listener added on `#post-sale-overlay` (search for any addEventListener on post-sale-overlay returns zero matches)
  </acceptance_criteria>
  <done>
    Button click handler wired with first-wins guard and fires notifyPostSaleNextCustomer. Two new IPC subscribers registered. No existing wiring modified. File syntactically valid.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user touch input → button click handler | Touch event arrives as a trusted DOM click. |
| main → renderer IPC (window.kiosk.onShowPostSale) | Main process is trusted (same app boundary). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-07-01 | DoS | Rapid-fire button taps within the same tick before postSaleResolved latches | mitigate | The click event in host.js is synchronous; postSaleResolved is set BEFORE the IPC send. Even at 100 Hz tap rate, only the first click passes the guard. |
| T-10-07-02 | Race | Countdown interval fires at same millisecond as button click (T-10.00) | mitigate | postSaleResolved is the single atomic gate. Whichever path reaches `if (postSaleResolved) return;` second is a silent no-op. UI-SPEC §Race Guard enumerates all 4 race scenarios. |
| T-10-07-03 | Stale interval | A previous show's setInterval keeps ticking into a new show | mitigate | showPostSaleOverlay clears `postSaleInterval` on entry before assigning a new one, matching the existing idle-overlay pattern. |
| T-10-07-04 | Tap-anywhere dismissal | An accidental brush dismisses the thank-you before the member reads it | N/A | D-01 rejects tap-anywhere; acceptance criteria verify no pointerdown listener is attached to #post-sale-overlay. |

**Threat level:** LOW. All known races are covered by the first-wins flag + stale-interval clear.
</threat_model>

<verification>
- All 5 greps from Task 1 and Task 2 verify blocks match
- `node --check src/host/host.js` exits 0
- Manual DevTools test: with the overlay forced visible (via `document.getElementById('post-sale-overlay').style.display='flex'`), clicking the button fires notifyPostSaleNextCustomer; waiting 10s fires notifyPostSaleAutoLogout (if show was called through the proper path).
- Manual DevTools test: tap button at t=9 → interval cleared, IPC sent, aria-hidden=true. Wait past t=10. No second IPC. Expected.
</verification>

<success_criteria>
- Full post-sale lifecycle in host.js: state, show, hide, button handler, IPC subscribers
- First-wins race guard prevents double-fire across button and countdown paths
- IPC channel names match Plan 02 preload surface exactly
- No existing function, state, or subscriber modified
- No tap-anywhere or Esc dismiss path per D-01/D-02
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-07-SUMMARY.md` documenting:
- The exact insertion points used for all 4 additions (state, functions, button handler, IPC subscribers)
- Confirmation no existing function/state/wiring touched
- Manual DevTools test results for the 4 race scenarios in UI-SPEC §Race Guard
- Confirmation no tap-anywhere/Esc dismiss paths present
</output>
