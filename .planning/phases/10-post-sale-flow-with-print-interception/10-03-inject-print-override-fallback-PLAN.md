---
phase: 10-post-sale-flow-with-print-interception
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - src/inject/inject.js
  - src/inject/fragile-selectors.js
autonomous: false
requirements: [SALE-01]
tags: [inject, print-interception, mutation-observer, sentinel, phase-10]
user_setup: []
must_haves:
  truths:
    - "window.print() called in Magicline's page emits `BSK_PRINT_INTERCEPTED` on console and does NOT open Chrome print preview"
    - "Cart item count transition from non-zero to zero AFTER a 'Jetzt verkaufen' click, within 120s, emits `BSK_POST_SALE_FALLBACK` on console (debounced 500ms)"
    - "_paymentConfirmedAt timestamp is armed by the existing 'Jetzt verkaufen' click listener"
    - "window.__bskiosk_injected__ idempotency guard still gates re-injection; override + observer install ONCE per page load"
  artifacts:
    - path: "src/inject/inject.js"
      provides: "window.print override + cart-empty MutationObserver + _paymentConfirmedAt arming"
      contains: "BSK_PRINT_INTERCEPTED"
    - path: "src/inject/fragile-selectors.js"
      provides: "Cart container selector entry for the fallback observer"
      contains: "post-sale observer"
  key_links:
    - from: "src/inject/inject.js window.print override"
      to: "console.log('BSK_PRINT_INTERCEPTED')"
      via: "direct write of window.print"
      pattern: "window\\.print = function"
    - from: "src/inject/inject.js cart-empty observer"
      to: "console.log('BSK_POST_SALE_FALLBACK')"
      via: "MutationObserver on cart root after paymentConfirmedAt gate + 500ms debounce"
      pattern: "BSK_POST_SALE_FALLBACK"
    - from: "src/inject/inject.js 'Jetzt verkaufen' click handler"
      to: "_paymentConfirmedAt = Date.now()"
      via: "inline assignment alongside existing BSK_AUDIT_SALE_COMPLETED emit"
      pattern: "_paymentConfirmedAt = Date.now"
---

<objective>
Implement BOTH post-sale detection triggers inside the Magicline main-world injection bundle:

1. **Primary trigger (D-10 REVISED per RESEARCH §1):** Override `window.print` to emit the `BSK_PRINT_INTERCEPTED` console sentinel and suppress Chrome's print preview dialog. The `-print` event does NOT exist in Electron 41's public API (electron/electron#22796 wontfix 2022) — this JS-level override is the approved pre-authorized replacement per CONTEXT.md §Known Fragility.
2. **Defense-in-depth fallback (D-11):** Cart-empty-after-payment MutationObserver that emits `BSK_POST_SALE_FALLBACK` when the cart transitions non-zero → zero within 120s of a "Jetzt verkaufen" click, debounced 500ms to absorb React re-render glitches.

Purpose: Both sentinels will be relayed by `magiclineView.js` (Plan 04) → `main.js` (Plan 05) to trigger the post-sale overlay. The override guarantees Chrome's print preview never renders; the observer is defense-in-depth if Magicline bypasses `window.print` via a frame/worker path (RISK-04).

Output: Additive changes to `inject.js` (override + observer + `_paymentConfirmedAt` arming) + placeholder cart selector entry in `fragile-selectors.js`.

This plan has a human checkpoint because the cart container `data-role` must be discovered via DevTools against a live Magicline session (RISK-02 in RESEARCH.md — cannot be researched offline).
</objective>

<scheduling_note>
Wave 2 plans (04, 05, 06) cannot begin until Plan 03's Task 3 human checkpoint resolves. Schedule Plan 03 execution when kiosk hardware is accessible for a DevTools session — the cart container `data-role` selector and the `BSK_PRINT_INTERCEPTED` sentinel confirmation both require a live Magicline page in dev mode, not just an offline code review.
</scheduling_note>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md
@./CLAUDE.md

<interfaces>
<!-- Idempotency guard + one-time setup block. ALL new listeners/observers/
     overrides go AFTER `window.__bskiosk_injected__ = true` and NOT inside
     the early-return block — re-injection on did-navigate-in-page would
     otherwise stack them N times. -->

From src/inject/inject.js (lines 36-42 — idempotency anchor):
```javascript
if (window.__bskiosk_injected__) {
  try { if (window.__bskiosk_hideDynamic) window.__bskiosk_hideDynamic(); } catch (e) {}
  try { if (window.__bskiosk_detectReady) window.__bskiosk_detectReady(); } catch (e) {}
  try { if (window.__bskiosk_detectLogin) window.__bskiosk_detectLogin(); } catch (e) {}
  return;
}
window.__bskiosk_injected__ = true;
```

From src/inject/inject.js (lines 91-108 — existing 'Jetzt verkaufen' click handler):
```javascript
document.addEventListener('click', function (e) {
  try {
    var btn = e.target && e.target.closest && e.target.closest('[data-role="button"]');
    if (!btn) return;
    if (btn.textContent && btn.textContent.trim() === JETZT_VERKAUFEN_TEXT) {
      try { console.log('BSK_AUDIT_SALE_COMPLETED'); } catch (e) { /* swallow */ }
      // NFC descope comment...
    }
  } catch (err) { /* swallow */ }
});
```

From src/inject/fragile-selectors.js (STABLE_SELECTORS entry shape):
```javascript
var STABLE_SELECTORS = [
  { category: 'stable', selector: '[data-role="topbar"]',         purpose: 'Topbar' },
  { category: 'stable', selector: '[data-role="product-search"] input', purpose: 'Product search input' },
  // ...
];
```

Sentinel relay convention (verified in magiclineView.js lines 307-332):
- Emit: `try { console.log('BSK_NAME'); } catch (e) {}`
- Received by magiclineView's `console-message` handler; forwarded to main via `ipcMain.emit`
- Plan 04 adds the two new branches in magiclineView.js
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add window.print override + cart-empty state vars + MutationObserver to inject.js</name>
  <read_first>
    - src/inject/inject.js (current — idempotency anchor at lines 36-42, Jetzt verkaufen listener at 91-108, rAF schedule() at 498-509, the IIFE close at line 534)
    - src/inject/fragile-selectors.js (STABLE_SELECTORS shape, JETZT_VERKAUFEN_TEXT constant)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md §1 (window.print override rationale — replaces D-10 -print event) and §4 (MutationObserver design + exact code)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §inject.js (exact code blocks: override, state vars, observer)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §Known Fragility (pre-authorization for the override replacement)
  </read_first>
  <files>src/inject/inject.js</files>
  <action>
Make THREE additive changes inside the IIFE (lines 28-534), all AFTER the idempotency anchor `window.__bskiosk_injected__ = true;` at line 42.

**Change A — insert state vars after the existing module-level vars (near lines 42-43, after `window.__bskiosk_events = window.__bskiosk_events || [];`):**

```javascript

  // --- Phase 10 D-11: cart-empty fallback state (one-time) -------------
  // Armed by the existing 'Jetzt verkaufen' click listener below; cleared
  // when cart goes non-zero OR when the 120s window expires. A 500ms debounce
  // absorbs React re-render glitches where the DOM momentarily removes items
  // before re-adding them.
  var _paymentConfirmedAt = 0;
  var _postSaleFallbackTimer = null;
  var PAYMENT_CONFIRM_WINDOW_MS = 120000;
```

**Change B — extend the existing 'Jetzt verkaufen' click handler at lines 91-108 to arm `_paymentConfirmedAt`:**

Inside the existing `if (btn.textContent && btn.textContent.trim() === JETZT_VERKAUFEN_TEXT) {` block, AFTER the existing `try { console.log('BSK_AUDIT_SALE_COMPLETED'); } catch (e) { /* swallow */ }` line, add:

```javascript
        // Phase 10 D-11: arm cart-empty fallback gate. The observer below
        // fires BSK_POST_SALE_FALLBACK only if the cart transitions to
        // zero within PAYMENT_CONFIRM_WINDOW_MS of THIS arming.
        _paymentConfirmedAt = Date.now();
```

Do NOT remove the existing NFC-descope comment block — it stays intact as documentation.

**Change C — add window.print override + cart-empty observer immediately AFTER the existing click listener's closing `});` at line 108, and BEFORE the `emit()` function declaration at line 113.**

```javascript

  // --- Phase 10 D-10 (REVISED per RESEARCH §1): window.print override ----
  // The `-print` webContents event does NOT exist in Electron 41 (wontfix
  // per electron/electron#22796). The approved replacement — pre-authorized
  // in CONTEXT.md §Known Fragility — is to override window.print at the JS
  // level inside Magicline's main world. Chrome's print preview NEVER opens
  // because the override never calls the original.
  //
  // Placement: ONE-TIME setup, below __bskiosk_injected__ anchor. Re-injection
  // on did-navigate-in-page early-returns above, so this only runs on a true
  // fresh page load (which is what we want — the override persists on window
  // across hash-route navigations).
  try {
    var _originalPrint = window.print;
    window.print = function () {
      try { console.log('BSK_PRINT_INTERCEPTED'); } catch (e) { /* swallow */ }
      // Do NOT call _originalPrint — Chrome's print preview must never open.
      // _originalPrint is retained in closure for potential future diagnostic
      // use; NEVER invoke it from production code paths.
    };
  } catch (e) { /* swallow — override failure is non-fatal; observer covers */ }

  // --- Phase 10 D-11: cart-empty-after-payment MutationObserver fallback --
  // Defense-in-depth: if Magicline's print path bypasses window.print (e.g.
  // via a Web Worker or iframe — RISK-04), observing the cart DOM clears
  // catches the sale completion independently.
  //
  // Selector: uses STABLE_SELECTORS-based attribute match. The exact cart
  // data-role MUST be discovered via DevTools against live Magicline (see
  // fragile-selectors.js entry + the Task-3 human checkpoint below). If the
  // cart root cannot be found, _attachCartEmptyObserver emits
  // observer-attach-failed and the fallback stays inoperative — the window.print
  // override alone still triggers the overlay.
  function _getCartItemCount() {
    try {
      // Count DOM nodes inside the cart root. Three strategies tried in
      // order; first non-null wins. If none match, returns -1 which the
      // observer treats as "cannot determine" (skip, do not fire sentinel).
      var countEl = document.querySelector('[data-role="cart-item-count"]');
      if (countEl && countEl.textContent) {
        var n = parseInt(countEl.textContent.trim(), 10);
        if (!isNaN(n)) return n;
      }
      var items = document.querySelectorAll('[data-role="cart"] [data-role="cart-item"]');
      if (items && items.length >= 0) return items.length;
      return -1;
    } catch (e) { return -1; }
  }

  function _attachCartEmptyObserver() {
    // Selector list must be kept in sync with fragile-selectors.js.
    var cartRoot = document.querySelector('[data-role="cart"]')
                || document.querySelector('[data-role="shopping-cart"]');
    if (!cartRoot) {
      emit('observer-attach-failed', { purpose: 'cart-empty-fallback' });
      return;
    }
    var obs = new MutationObserver(function () {
      if (_postSaleFallbackTimer) return; // debounce active
      var count = _getCartItemCount();
      if (count === -1) return; // could not determine — skip
      if (count !== 0) {
        _paymentConfirmedAt = 0; // non-empty resets gate (multi-purchase + abandoned)
        return;
      }
      if (!_paymentConfirmedAt) return; // no recent "Jetzt verkaufen" arming
      if (Date.now() - _paymentConfirmedAt > PAYMENT_CONFIRM_WINDOW_MS) {
        _paymentConfirmedAt = 0;
        return; // stale arming — treat as abandoned sale
      }
      // 500ms debounce — re-check after delay to absorb React re-render glitches
      _postSaleFallbackTimer = setTimeout(function () {
        _postSaleFallbackTimer = null;
        if (_getCartItemCount() === 0 && _paymentConfirmedAt) {
          _paymentConfirmedAt = 0;
          try { console.log('BSK_POST_SALE_FALLBACK'); } catch (e) { /* swallow */ }
        }
      }, 500);
    });
    try {
      obs.observe(cartRoot, { childList: true, subtree: true, attributes: true });
    } catch (e) {
      emit('observer-attach-failed', { purpose: 'cart-empty-fallback', message: String(e && e.message) });
    }
  }
  // Attach as a one-time setup. If cart root is not yet in the DOM at inject
  // time (e.g. we inject during Magicline's initial React hydration), the
  // attach fails silently and will be re-attempted by the schedule() rAF
  // debounced pass below on the next mutation — but only the FIRST successful
  // attach takes effect (observer re-use would double-fire).
  var _cartObserverAttached = false;
  function _ensureCartEmptyObserver() {
    if (_cartObserverAttached) return;
    var cartRoot = document.querySelector('[data-role="cart"]')
                || document.querySelector('[data-role="shopping-cart"]');
    if (!cartRoot) return; // try again on next mutation
    _cartObserverAttached = true;
    _attachCartEmptyObserver();
  }
```

**Change D — also hook `_ensureCartEmptyObserver()` into the existing rAF `schedule()` function.** Find the existing `function schedule() {` (near line 499) and the `window.requestAnimationFrame(function () { ... });` inside it. Add `_ensureCartEmptyObserver();` as a new line inside the rAF callback, alongside the existing `hideDynamicElements(); detectReady(); detectLogin(); detectAndSelectRegister();` calls.

Exact patch: in the rAF callback body (currently four lines: hideDynamicElements + detectReady + detectLogin + detectAndSelectRegister), APPEND:
```javascript
      _ensureCartEmptyObserver();
```

**Critical placement rules:**
- All new listeners / observers / overrides MUST be placed AFTER `window.__bskiosk_injected__ = true;` and OUTSIDE the early-return block at lines 36-41. Listeners placed in the early-return path would stack N× per `did-navigate-in-page`.
- The override MUST NOT call `_originalPrint()` — Chrome's print preview dialog must never open. This is non-negotiable per the member-facing UX goal.
- Do NOT use `ES6 class`, `const`, `let`, `arrow functions` — existing inject.js uses plain `function` + `var` exclusively for the Magicline main-world compatibility target (no Babel transform is applied).
- All three new `console.log` emits use the sentinel pattern `try { console.log('BSK_NAME'); } catch (e) {}` — matches PATTERNS §inject.js and the existing `BSK_AUDIT_SALE_COMPLETED` emit.

Do NOT touch any other function in the file. Do NOT modify the existing auto-select state machine, `hideDynamicElements`, `detectReady`, `detectLogin`, `emit`, or `setMuiValue`.
  </action>
  <verify>
    <automated>grep -q "BSK_PRINT_INTERCEPTED" src/inject/inject.js &amp;&amp; grep -q "BSK_POST_SALE_FALLBACK" src/inject/inject.js &amp;&amp; grep -q "_paymentConfirmedAt = Date.now" src/inject/inject.js &amp;&amp; grep -q "PAYMENT_CONFIRM_WINDOW_MS = 120000" src/inject/inject.js &amp;&amp; grep -q "_attachCartEmptyObserver" src/inject/inject.js &amp;&amp; grep -q "window.print = function" src/inject/inject.js &amp;&amp; node --check src/inject/inject.js</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `BSK_PRINT_INTERCEPTED`
    - File contains exact substring `BSK_POST_SALE_FALLBACK`
    - File contains exact substring `PAYMENT_CONFIRM_WINDOW_MS = 120000`
    - File contains exact substring `_paymentConfirmedAt = Date.now()`
    - File contains exact substring `window.print = function`
    - File contains exact substring `_attachCartEmptyObserver`
    - File contains exact substring `_ensureCartEmptyObserver`
    - File contains the `try { console.log('BSK_PRINT_INTERCEPTED'); } catch` pattern
    - The window.print override is positioned AFTER `window.__bskiosk_injected__ = true;` and BEFORE the `emit()` function — verify by line numbers: window.print override line > idempotency anchor line
    - The _originalPrint is STORED but NEVER invoked anywhere in the file: `grep -c "_originalPrint(" src/inject/inject.js` returns 0
    - `node --check src/inject/inject.js` exits 0 (syntactically valid)
    - The existing `BSK_AUDIT_SALE_COMPLETED` emit is preserved unchanged (still present, still inside the JETZT_VERKAUFEN_TEXT branch)
    - No usage of `const`, `let`, `=>` arrow functions, or `class` keyword in the new code (match existing var/function style)
  </acceptance_criteria>
  <done>
    window.print override installed, cart-empty observer installed with debounce, _paymentConfirmedAt armed by existing click handler. File syntactically valid. No existing function modified except the Jetzt-verkaufen click handler extension.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add placeholder cart container entry to fragile-selectors.js</name>
  <read_first>
    - src/inject/fragile-selectors.js (current — STABLE_SELECTORS array shape)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §fragile-selectors.js (exact entry shape)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md §Open Questions 2 (cart data-role unknown; must be discovered via DevTools)
  </read_first>
  <files>src/inject/fragile-selectors.js</files>
  <action>
Append ONE new entry to the `STABLE_SELECTORS` array in `src/inject/fragile-selectors.js`. The entry is a PLACEHOLDER — the actual selector value will be discovered via DevTools during Task 3's human checkpoint.

**Exact entry to append (inside `STABLE_SELECTORS`, as the LAST entry — after the login selectors, before the closing `];`):**

```javascript
  // Phase 10 D-11: cart container for cart-empty MutationObserver fallback.
  // PLACEHOLDER — actual data-role value discovered via DevTools during
  // Phase 10 execution (RISK-02 in 10-RESEARCH.md). If Magicline uses a
  // fragile MUI css-xxxxx hash for the cart container instead, move this
  // entry to FRAGILE_SELECTORS. cash-register page only; no page:'login'
  // gate because inject.js already skips the check on the login page via
  // onCashRegister detection. The inject.js observer also tries
  // [data-role="shopping-cart"] as a fallback — keep both here in sync.
  { category: 'stable', selector: '[data-role="cart"]',          purpose: 'Cart container (post-sale observer, D-11 primary)' },
  { category: 'stable', selector: '[data-role="shopping-cart"]', purpose: 'Cart container (post-sale observer, D-11 fallback)' }
```

**Critical:**
- The existing last entry currently ends with a closing `}` (no trailing comma). Add a comma after it and then the two new entries. The LAST of the two new entries does NOT have a trailing comma.
- Match the existing 2-space indent used in the array.
- Do NOT modify `FRAGILE_SELECTORS`, `JETZT_VERKAUFEN_TEXT`, or `LOCALE_STRINGS`.
- If DevTools later proves only one selector is valid, the UNUSED one stays in STABLE_SELECTORS as a harmless zero-match entry that will trigger a drift warning — that's the signal to prune it.
  </action>
  <verify>
    <automated>grep -q "post-sale observer" src/inject/fragile-selectors.js &amp;&amp; grep -q "data-role=\"cart\"" src/inject/fragile-selectors.js &amp;&amp; grep -q "data-role=\"shopping-cart\"" src/inject/fragile-selectors.js &amp;&amp; node --check src/inject/fragile-selectors.js</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `post-sale observer`
    - File contains exact substring `[data-role="cart"]`
    - File contains exact substring `[data-role="shopping-cart"]`
    - `node --check src/inject/fragile-selectors.js` exits 0
    - The two new entries are inside the `STABLE_SELECTORS` array (not FRAGILE_SELECTORS)
    - No modification to `JETZT_VERKAUFEN_TEXT` or `LOCALE_STRINGS`
    - The existing login-page entries still present (`data-role="username"`, `data-role="password"`, `data-role="login-button"`)
  </acceptance_criteria>
  <done>
    Two placeholder cart-container entries appended to STABLE_SELECTORS. File syntactically valid. Existing entries unchanged.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human checkpoint — verify cart selector + print override against live Magicline</name>
  <what-built>
    - window.print override in inject.js that suppresses Chrome print preview and emits BSK_PRINT_INTERCEPTED console sentinel
    - Cart-empty MutationObserver in inject.js that emits BSK_POST_SALE_FALLBACK after a 'Jetzt verkaufen' click + 500ms debounce when cart transitions to zero within 120s
    - Placeholder cart-container selectors in fragile-selectors.js (`[data-role="cart"]` + `[data-role="shopping-cart"]`)
  </what-built>
  <how-to-verify>
    **Why this checkpoint exists:** RESEARCH §1 RISK-04 and RISK-02 identified TWO items that cannot be verified without live Magicline:
    1. Does Magicline call top-level `window.print()` (or a frame/worker variant)?
    2. What is the exact `data-role` value for Magicline's cart container?

    **Step 1 — Enable dev mode + DevTools:**
    1. Launch the kiosk in dev mode: `npm start` with `NODE_ENV=development`
    2. Enter admin PIN via Ctrl+Shift+F12
    3. Toggle Dev-Modus ON (makes splash semi-transparent so you can see Magicline)
    4. Open DevTools on the Magicline webContents (Ctrl+Shift+I from the admin menu's "DevTools öffnen" button, or via main process `view.webContents.openDevTools()`)

    **Step 2 — Verify window.print override fires:**
    1. In the DevTools Console, type: `window.print`
    2. Expected: the output shows our override function `function () { try { console.log('BSK_PRINT_INTERCEPTED'); ... }`, NOT the native `function print() { [native code] }`
    3. Type: `window.print()`
    4. Expected: Console shows `BSK_PRINT_INTERCEPTED`. Chrome's print preview dialog does NOT appear.
    5. If the override function is NOT visible (DevTools shows native print), the placement is wrong — the override is above the early-return path. Check inject.js Task 1 change C placement.

    **Step 3 — Discover the real cart container selector:**
    1. Log in as a Bee Strong member / admin account that can reach the cash register page
    2. Add a product to the cart (any product, any quantity)
    3. In DevTools Elements inspector, click on the cart panel/area
    4. Inspect the panel ancestry: look for `data-role="..."` attributes on the enclosing div(s)
    5. Record the EXACT `data-role` value. Likely candidates:
       - `data-role="cart"` — already in the placeholder list
       - `data-role="shopping-cart"` — already in the placeholder list
       - `data-role="basket"`, `data-role="checkout-cart"`, `data-role="order-items"` — NEW value, must be added
       - If no `data-role` exists, flag as blocker and decide: move entry to FRAGILE_SELECTORS with the MUI `css-xxxxx` class, OR ship without the fallback (override-only mode)
    6. Inspect individual cart line items: look for `data-role="cart-item"` or similar. Record.
    7. Inspect any numeric cart-count badge: look for `data-role="cart-item-count"` or similar. Record.

    **Step 4 — Verify the observer fires (if selector is correct):**
    1. With DevTools console open and a product in the cart, type: `document.querySelectorAll('[data-role="cart"]').length`
    2. Expected: returns 1 (one cart root). If 0, the selector is wrong — use the discovered value instead.
    3. Click "Jetzt verkaufen" to start a sale (or simulate: `_paymentConfirmedAt = Date.now();` in the DevTools console to arm the gate)
    4. Complete the card-terminal payment flow (or force cart clear: remove items until empty)
    5. Expected: Console shows `BSK_POST_SALE_FALLBACK` within ~500-700ms of cart hitting zero
    6. If NOT shown, inspect `_getCartItemCount()` return value in DevTools — it may be returning -1 (no count element found) — in which case a third strategy may be needed.

    **Step 5 — Report findings:**
    Create or update `.planning/phases/10-post-sale-flow-with-print-interception/10-CART-SELECTOR-DISCOVERY.md` with:
    - Exact cart root `data-role` value observed (or MUI fallback if none)
    - Exact cart-item `data-role` value (or "none found")
    - Exact cart-item-count `data-role` value (or "none found")
    - Confirmation BSK_PRINT_INTERCEPTED fired when Magicline called window.print (or the call path if Magicline uses a frame/worker variant)
    - Confirmation BSK_POST_SALE_FALLBACK fired on a complete sale flow (or reason it did not)

    **Step 6 — If discovery reveals a different selector than the placeholder:**
    Update `src/inject/fragile-selectors.js` by ADDING the discovered entry alongside the placeholders (do not delete placeholders — they are free zero-match entries that surface as drift warnings if Magicline renames). Update the `document.querySelector(...)` fallback chain in inject.js `_attachCartEmptyObserver` and `_ensureCartEmptyObserver` and `_getCartItemCount` to include the discovered selector first.
  </how-to-verify>
  <resume-signal>
    Type "approved" when BSK_PRINT_INTERCEPTED fires on window.print() from DevTools AND cart selector is discovered (written to 10-CART-SELECTOR-DISCOVERY.md). If blockers exist (Magicline uses worker for print OR no stable cart selector), describe findings and we'll decide whether to ship in override-only mode or defer the fallback to a patch release.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Magicline main world → console | Magicline's untrusted JavaScript runs in the same world as inject.js. A malicious Magicline build could redefine window.print BACK to native after our override, or inject console.log spoof events to trigger false post-sale overlays. |
| console → magiclineView.js listener (Plan 04) | All sentinels relayed via console.log are replayable by any JS running in Magicline's main world. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-03-01 | Tampering | Magicline script overwrites `window.print` back to native after our override | accept | If Magicline overrides our override after injection, print preview could leak. Residual risk: LOW — Magicline does not load third-party ad code and the executeJavaScript injection re-runs on every did-navigate-in-page. If it becomes an issue, escalate to a proxy-based override using Object.defineProperty with writable:false (defers to future plan). |
| T-10-03-02 | Spoofing | Any Magicline script can emit `console.log('BSK_POST_SALE_FALLBACK')` to force the post-sale overlay | accept | Risk is UX confusion, not security (no credential exposure, no session state change — the worst case is a spurious thank-you overlay and a false hardReset to welcome). `postSaleShown` dedupe in main.js (Plan 05) limits impact to one spurious overlay per sale cycle. Magicline is first-party SaaS we trust by contract. |
| T-10-03-03 | Denial of Service | Payment-confirmed gate stays armed beyond 120s window and fires false BSK_POST_SALE_FALLBACK on any later cart clear | mitigate | PAYMENT_CONFIRM_WINDOW_MS = 120000 explicitly expires the arming. Observer callback clears `_paymentConfirmedAt` on both non-empty-cart and stale-window branches. |
| T-10-03-04 | Information disclosure | Console sentinels leak internal state to Magicline's own logging/telemetry | accept | The sentinels contain no credentials, PII, or sale data — only event names (`BSK_PRINT_INTERCEPTED`, `BSK_POST_SALE_FALLBACK`). Magicline's telemetry already sees everything in the page. Low risk. |
| T-10-03-05 | Repudiation | Print suppression prevents audit trail of what was printed | accept | Receipt PDF archiving is explicitly DEFERRED to v1.2 per CONTEXT.md domain non-goals. This phase's requirement is print SUPPRESSION, not print LOGGING. |

**Threat level:** LOW-MEDIUM. Primary residual risk is T-10-03-01 (Magicline overwriting our override). Acceptable because Magicline is first-party SaaS and re-injection re-installs on every navigation.
</threat_model>

<verification>
- `grep -c "BSK_PRINT_INTERCEPTED" src/inject/inject.js` returns 1
- `grep -c "BSK_POST_SALE_FALLBACK" src/inject/inject.js` returns 1 (inside the observer callback)
- `grep -c "_originalPrint(" src/inject/inject.js` returns 0 (we store it but never call it)
- `node --check src/inject/inject.js` exits 0
- `node --check src/inject/fragile-selectors.js` exits 0
- Human checkpoint passed: BSK_PRINT_INTERCEPTED fires on window.print() in DevTools AND cart selector documented in 10-CART-SELECTOR-DISCOVERY.md
</verification>

<success_criteria>
- window.print override installed, does NOT invoke original, emits BSK_PRINT_INTERCEPTED
- Cart-empty observer fires BSK_POST_SALE_FALLBACK only within 120s of a Jetzt-verkaufen click and after a 500ms debounce
- Placeholder cart selectors in fragile-selectors.js; discovered selector documented (and code-updated if different)
- No modification to existing inject.js functions except the single-line extension inside the Jetzt-verkaufen click branch
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-03-SUMMARY.md` documenting:
- Exact before/after of all three changes in inject.js (state vars, click handler extension, override + observer block)
- The new fragile-selectors.js entries
- Human checkpoint findings:
  - Whether BSK_PRINT_INTERCEPTED fires on live Magicline's receipt print
  - The discovered cart `data-role` value (or MUI fallback chosen)
  - Any selector/code deltas made as a result of DevTools discovery

Also create or update `.planning/phases/10-post-sale-flow-with-print-interception/10-CART-SELECTOR-DISCOVERY.md` as described in Task 3 Step 5.
</output>
