# Phase 10: Post-Sale Flow with Print Interception — Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 13 new/modified files
**Analogs found:** 13 / 13

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/main/sessionReset.js` | utility | event-driven | `src/main/sessionReset.js` (self-extend) | exact |
| `src/main/magiclineView.js` | service | event-driven | `src/main/magiclineView.js` (self-extend) | exact |
| `src/main/main.js` | controller | event-driven | `src/main/main.js` (self-extend) | exact |
| `src/main/preload.js` | middleware | request-response | `src/main/preload.js` (self-extend) | exact |
| `src/host/host.html` | component | request-response | `src/host/host.html` `#idle-overlay` block | exact |
| `src/host/host.css` | config | request-response | `src/host/host.css` `.bsk-layer--idle` block | exact |
| `src/host/host.js` | component | event-driven | `src/host/host.js` `showIdleOverlay()` | exact |
| `src/inject/inject.js` | utility | event-driven | `src/inject/inject.js` `BSK_AUDIT_SALE_COMPLETED` block | exact |
| `src/inject/fragile-selectors.js` | config | transform | `src/inject/fragile-selectors.js` `STABLE_SELECTORS` entries | exact |
| `test/postSale.test.js` (new) | test | event-driven | `test/updateGate.test.js` hand-rolled mock pattern | role-match |
| `test/sessionReset.test.js` | test | event-driven | `test/sessionReset.test.js` (self-extend) | exact |
| `test/updateGate.test.js` | test | event-driven | `test/updateGate.test.js` (self-extend) | exact |
| `build/installer.nsh` | config | batch | `build/installer.nsh` `!macro customInstall` | exact |

---

## Pattern Assignments

### `src/main/sessionReset.js` — extend countable filter (D-17)

**Analog:** `src/main/sessionReset.js` lines 104-106

**Current filter predicate** (lines 104-106):
```javascript
const countable = resetTimestamps.filter(
  (e) => !(e.reason === 'idle-expired' && e.mode === 'welcome')
);
```

**Target after D-17 extension** — replace the single-condition negation with a two-condition OR:
```javascript
const countable = resetTimestamps.filter(
  (e) => !(
    (e.reason === 'idle-expired' && e.mode === 'welcome') ||
    e.reason === 'sale-completed'
  )
);
```

**Why this shape:** The existing pattern already uses `!(condition)`. D-17 adds a second exclusion via `||` inside the same negation. The `mode` check is intentionally omitted for `sale-completed` because `sale-completed` always arrives with `mode:'welcome'` — but the reason alone is the canonical discriminator (per CONTEXT.md D-17: "the filter can be `(reason === 'idle-expired' && mode === 'welcome') || reason === 'sale-completed'`").

**`onPostReset` still fires** (lines 249-256) — no change needed; `succeeded && postResetListener` already covers the sale-completed path because `mode:'welcome'` sets `succeeded = true` at line 187.

---

### `src/main/magiclineView.js` — add `BSK_PRINT_INTERCEPTED` + `BSK_POST_SALE_FALLBACK` sentinel branches

**Analog:** `src/main/magiclineView.js` lines 307-332 (existing `BSK_AUDIT_SALE_COMPLETED` + `BSK_REGISTER_SELECTED` branches)

**Existing sentinel relay pattern** (lines 307-332):
```javascript
if (message && message.indexOf('BSK_AUDIT_SALE_COMPLETED') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('audit-sale-completed');
  } catch (_) { /* swallow */ }
}

// DEGRADED must be checked first (else-if) — BSK_REGISTER_SELECTED is a
// substring of BSK_REGISTER_SELECTED_DEGRADED and would double-fire.
if (message && message.indexOf('BSK_REGISTER_SELECTED_DEGRADED') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('register-selected', null, { degraded: true });
  } catch (_) { /* swallow */ }
} else if (message && message.indexOf('BSK_REGISTER_SELECTED') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('register-selected', null, { degraded: false });
  } catch (_) { /* swallow */ }
}
```

**New branches to insert after the `BSK_REGISTER_SELECTED` block** (4-line pattern per sentinel, copy exactly):
```javascript
// Phase 10 D-10 (revised): window.print override primary trigger.
if (message && message.indexOf('BSK_PRINT_INTERCEPTED') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  } catch (_) { /* swallow */ }
}

// Phase 10 D-11: cart-empty-after-payment MutationObserver fallback.
if (message && message.indexOf('BSK_POST_SALE_FALLBACK') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
  } catch (_) { /* swallow */ }
}
```

**Important:** `BSK_POST_SALE_FALLBACK` is NOT a substring of `BSK_PRINT_INTERCEPTED` — no ordering guard needed (unlike `BSK_REGISTER_SELECTED_DEGRADED`). Both can use plain `if`, not `else if`.

---

### `src/main/main.js` — register post-sale IPC handlers + `postSaleShown` dedupe flag

**Analog A — module-scoped flag pattern** (lines 42, 465-467):
```javascript
// Pattern: module-scoped boolean flag, cleared in onPreReset
let welcomeTapPending = false;
// ...
sessionResetMod.onPreReset(() => {
  welcomeTapPending = false;   // clear stale flag on any hard reset
  // ...
});
```

**New flag to add** at the same scope level (alongside `welcomeTapPending`):
```javascript
// Phase 10 D-12: dedupe flag — prevents double-show when both print-event
// and cart-empty fallback fire within the same sale.
let postSaleShown = false;
```

Clear it in the existing `onPreReset` callback alongside `welcomeTapPending`:
```javascript
postSaleShown = false;  // add after welcomeTapPending = false
```

**Analog B — IPC handler registration pattern** (lines 378-408):
```javascript
try {
  ipcMain.removeAllListeners('audit-sale-completed');
} catch (_) {}
ipcMain.on('audit-sale-completed', () => {
  try { log.audit('sale.completed', {}); } catch (_) {}
});
```

**New IPC handlers to register** in the same block, using identical structure:
```javascript
// Phase 10 D-12: post-sale:trigger relay from magiclineView console-message.
try { ipcMain.removeAllListeners('post-sale:trigger'); } catch (_) {}
ipcMain.on('post-sale:trigger', (_ev, payload) => {
  try {
    if (postSaleShown) {
      log.info('phase10.post-sale:trigger.ignored reason=already-shown');
      return;
    }
    const trigger = (payload && payload.trigger) || 'unknown';
    startPostSaleFlow({ trigger: trigger });
  } catch (err) {
    log.error('phase10.post-sale:trigger failed: ' + (err && err.message));
  }
});

// Phase 10 D-06: next-customer — keep session alive, rearm idle timer.
try { ipcMain.removeAllListeners('post-sale:next-customer'); } catch (_) {}
ipcMain.on('post-sale:next-customer', () => {
  try {
    postSaleShown = false;
    require('./idleTimer').start();
    log.audit('post-sale.dismissed', { via: 'next-customer' });
  } catch (err) {
    log.error('phase10.post-sale:next-customer failed: ' + (err && err.message));
  }
});

// Phase 10 D-20: auto-logout — countdown expired, hard-reset to welcome.
try { ipcMain.removeAllListeners('post-sale:auto-logout'); } catch (_) {}
ipcMain.on('post-sale:auto-logout', () => {
  try {
    log.audit('post-sale.dismissed', { via: 'auto-logout' });
    require('./sessionReset').hardReset({ reason: 'sale-completed', mode: 'welcome' });
  } catch (err) {
    log.error('phase10.post-sale:auto-logout failed: ' + (err && err.message));
  }
});
```

**Analog C — `startLoginFlow` helper pattern** (lines 507-522):
```javascript
const startLoginFlow = () => {
  try {
    const view = createMagiclineView(mainWindow, store);
    // ...
  } catch (err) {
    log.error('phase6.startLoginFlow failed: ' + (err && err.message));
  }
};
```

**New `startPostSaleFlow` helper** modeled on the same encapsulation pattern:
```javascript
// Phase 10 D-05/D-12: helper encapsulates idle-timer stop + IPC send + flag set.
function startPostSaleFlow({ trigger }) {
  postSaleShown = true;
  try { require('./idleTimer').stop(); } catch (_) {}
  try {
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('post-sale:show');
    }
  } catch (e) {
    log.error('phase10.startPostSaleFlow.send failed: ' + (e && e.message));
  }
  try { log.audit('post-sale.shown', { trigger: trigger }); } catch (_) {}
}
```

**Analog D — `pos.state-changed` audit pattern** (lines 879-888) — confirms the audit call shape `log.audit('post-sale.shown', { trigger: trigger })` is idiomatic.

---

### `src/main/preload.js` — expose post-sale IPC surface (D-19)

**Analog:** `src/main/preload.js` lines 40-47 (Phase 4 idle overlay pattern — exact template):
```javascript
// Phase 4 D-12 — idle overlay (main → renderer)
onShowIdleOverlay: (cb) => { ipcRenderer.on('show-idle-overlay', (_e) => cb()); },
onHideIdleOverlay: (cb) => { ipcRenderer.on('hide-idle-overlay', (_e) => cb()); },
// Phase 4 D-12 — idle overlay (renderer → main, fire-and-forget)
notifyIdleDismissed: () => { ipcRenderer.send('idle-dismissed'); },
notifyIdleExpired:   () => { ipcRenderer.send('idle-expired');   },
```

**New entries to append** inside the `kiosk` object (before the closing `}`), following the exact same style:
```javascript
// Phase 10 D-19 — post-sale overlay (main → renderer)
onShowPostSale: (cb) => { ipcRenderer.on('post-sale:show', (_e) => cb()); },
onHidePostSale: (cb) => { ipcRenderer.on('post-sale:hide', (_e) => cb()); },
// Phase 10 D-19 — post-sale overlay (renderer → main, fire-and-forget)
notifyPostSaleNextCustomer: () => { ipcRenderer.send('post-sale:next-customer'); },
notifyPostSaleAutoLogout:   () => { ipcRenderer.send('post-sale:auto-logout');   },
```

**Convention note:** Main → renderer subscribers use `ipcRenderer.on` with `(_e) => cb()`. Renderer → main fire-and-forget uses `ipcRenderer.send`. This is the established pattern across all phases — do not use `ipcRenderer.invoke` for these channels.

---

### `src/host/host.html` — add `#post-sale-overlay` layer at z-index 180

**Analog:** `src/host/host.html` lines 50-69 (`#idle-overlay` block — direct template):
```html
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

**New block to insert** between `#idle-overlay` (line 69) and `#magicline-error` (line 71), verbatim from UI-SPEC:
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

**Update the z-index ladder comment** (lines 12-28) by adding the new slot:
```
180 — #post-sale-overlay — Phase 10 branded "Vielen Dank" layer (D-04)
```
Insert between the `150` and `200` lines.

**Umlaut convention:** Use HTML entities in `.html` (`&auml;` = ä, `&uuml;` = ü) — the existing file uses entities consistently (lines 156, 157, 195, etc.).

---

### `src/host/host.css` — styles for post-sale overlay

**Analog:** `src/host/host.css` lines 362-417 (Phase 4 idle overlay CSS block) and lines 110-120 (`.bsk-welcome-title`):

```css
/* .bsk-layer--idle (lines 362-366): */
.bsk-layer--idle {
  z-index: 200;
  background: #1A1A1A;
  pointer-events: auto;
}

/* .bsk-welcome-title (lines 110-120): */
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

**New CSS to append** at end of file (after the Phase 09 block), verbatim from UI-SPEC:
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

**Reuse confirmation:** `.bsk-idle-countdown`, `.bsk-idle-number`, `.bsk-idle-seconds-label`, `.bsk-idle-subtext`, `.bsk-btn--idle-dismiss` are all reused unchanged by `#post-sale-overlay`. Zero additional CSS rules needed for those elements.

---

### `src/host/host.js` — overlay show/hide, countdown, `postSaleResolved` flag, button handler

**Analog A — module-scoped interval variable** (line 291):
```javascript
var idleInterval = null;
```

**New state vars to add** alongside `idleInterval` (and `posOpenState`, `pinModalContext`):
```javascript
// Phase 10 D-08/D-09: first-trigger-wins race guard (host-side)
var postSaleResolved = false;
var postSaleInterval = null;
```

**Analog B — `showIdleOverlay()` countdown function** (lines 315-344 — direct template):
```javascript
function showIdleOverlay() {
  var overlay = document.getElementById('idle-overlay');
  var numEl = document.getElementById('idle-countdown-number');
  if (!overlay || !numEl) return;
  // Guard against a double-show race: a stale interval from a previous
  // show would keep ticking and double-decrement the new counter.
  if (idleInterval) {
    clearInterval(idleInterval);
    idleInterval = null;
  }
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

**New `showPostSaleOverlay()` function** — copy `showIdleOverlay()` exactly, substituting IDs and adding the `postSaleResolved` guard:
```javascript
function showPostSaleOverlay() {
  var overlay = document.getElementById('post-sale-overlay');
  var numEl = document.getElementById('post-sale-countdown-number');
  if (!overlay || !numEl) return;
  // Reset race flag on every fresh show.
  postSaleResolved = false;
  // Guard against stale interval from a previous show.
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
      // D-08: first-wins guard — only auto-logout if button hasn't already fired.
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

**Analog C — button click handler pattern** (lines 346-355 `dismissIdleOverlay`):
```javascript
function dismissIdleOverlay() {
  hideIdleOverlayDom();
  try {
    if (window.kiosk && window.kiosk.notifyIdleDismissed) {
      window.kiosk.notifyIdleDismissed();
    }
  } catch (e) { /* ignore */ }
}
```

**New button handler for `#post-sale-next-btn`** — wire in the `wireIpcListeners()` block (alongside the `#idle-dismiss-btn` wiring):
```javascript
var nextBtn = document.getElementById('post-sale-next-btn');
if (nextBtn) {
  nextBtn.addEventListener('click', function () {
    // D-08: first-wins guard
    if (postSaleResolved) return;
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

**Analog D — IPC subscriber registration pattern** (lines 1127-1128):
```javascript
if (window.kiosk.onShowIdleOverlay)  window.kiosk.onShowIdleOverlay(showIdleOverlay);
if (window.kiosk.onHideIdleOverlay)  window.kiosk.onHideIdleOverlay(hideIdleOverlayDom);
```

**New registrations to add** in `wireIpcListeners()` after the Phase 09 block:
```javascript
// Phase 10 — post-sale overlay
if (window.kiosk.onShowPostSale) window.kiosk.onShowPostSale(showPostSaleOverlay);
if (window.kiosk.onHidePostSale) window.kiosk.onHidePostSale(hidePostSaleOverlay);
```

---

### `src/inject/inject.js` — `window.print` override + cart-empty MutationObserver

**Analog A — idempotency anchor placement** (lines 36-42 + 91-108):
```javascript
// Idempotency guard at top — returns early on re-injection.
if (window.__bskiosk_injected__) {
  // re-run dynamic helpers only
  return;
}
window.__bskiosk_injected__ = true;
// ...
// One-time listener setup BELOW the anchor (lines 91-108):
document.addEventListener('click', function (e) {
  try {
    var btn = e.target && e.target.closest && e.target.closest('[data-role="button"]');
    if (!btn) return;
    if (btn.textContent && btn.textContent.trim() === JETZT_VERKAUFEN_TEXT) {
      try { console.log('BSK_AUDIT_SALE_COMPLETED'); } catch (e) { /* swallow */ }
    }
  } catch (err) { /* swallow */ }
});
```

**New `window.print` override to add** immediately after line 108 (still in the one-time setup block, below `__bskiosk_injected__ = true`):
```javascript
// Phase 10 D-10 (revised): intercept window.print() before Chrome print preview
// renders. The override replaces window.print with a sentinel emitter — the
// original is stored but NEVER called (Chrome print dialog must stay hidden).
// Placed in the one-time setup block so it installs once per page load.
// Re-injection (did-navigate-in-page early-return) does NOT re-install; the
// override persists on window across hash-route navigations.
var _originalPrint = window.print;
window.print = function () {
  try { console.log('BSK_PRINT_INTERCEPTED'); } catch (e) {}
  // Do NOT call _originalPrint — Chrome's print preview must never open.
};
```

**Analog B — `BSK_AUDIT_SALE_COMPLETED` sentinel pattern** (lines 99-100):
```javascript
try { console.log('BSK_AUDIT_SALE_COMPLETED'); } catch (e) { /* swallow */ }
```

**Pattern to copy for `BSK_POST_SALE_FALLBACK`** inside the MutationObserver callback:
```javascript
try { console.log('BSK_POST_SALE_FALLBACK'); } catch(e) {}
```

**Analog C — activity listener rAF pattern** (lines 75-86) — the `_paymentConfirmedAt` timestamp write piggybacks on the existing `click` listener at lines 91-108. Add `_paymentConfirmedAt = Date.now();` inside the `JETZT_VERKAUFEN_TEXT` branch:
```javascript
// Inside the existing click handler, after BSK_AUDIT_SALE_COMPLETED:
if (btn.textContent && btn.textContent.trim() === JETZT_VERKAUFEN_TEXT) {
  try { console.log('BSK_AUDIT_SALE_COMPLETED'); } catch (e) { /* swallow */ }
  _paymentConfirmedAt = Date.now();  // Phase 10 D-11: arm cart-empty gate
}
```

**New cart-empty observer variables** (add near top of one-time setup block):
```javascript
// Phase 10 D-11: cart-empty fallback state
var _paymentConfirmedAt = 0;
var _postSaleFallbackTimer = null;
var PAYMENT_CONFIRM_WINDOW_MS = 120000;
```

**MutationObserver function** (full pattern from RESEARCH.md §4 — copy verbatim, substituting the discovered `data-role` from DevTools inspection):
```javascript
function _attachCartEmptyObserver() {
  // Selector must be discovered via DevTools during Phase 10 execution.
  // Add confirmed selector to fragile-selectors.js STABLE_SELECTORS.
  var cartRoot = document.querySelector('[data-role="cart"]')
              || document.querySelector('[data-role="shopping-cart"]');
  if (!cartRoot) {
    emit('observer-attach-failed', { purpose: 'cart-empty-fallback' });
    return;
  }
  var obs = new MutationObserver(function () {
    if (_postSaleFallbackTimer) return; // debounce active
    var count = _getCartItemCount();
    if (count !== 0) {
      _paymentConfirmedAt = 0; // non-empty resets gate
      return;
    }
    if (!_paymentConfirmedAt) return;
    if (Date.now() - _paymentConfirmedAt > PAYMENT_CONFIRM_WINDOW_MS) {
      _paymentConfirmedAt = 0;
      return; // stale
    }
    _postSaleFallbackTimer = setTimeout(function () {
      _postSaleFallbackTimer = null;
      if (_getCartItemCount() === 0 && _paymentConfirmedAt) {
        _paymentConfirmedAt = 0;
        try { console.log('BSK_POST_SALE_FALLBACK'); } catch(e) {}
      }
    }, 500);
  });
  obs.observe(cartRoot, { childList: true, subtree: true, attributes: true });
}
```

Call `_attachCartEmptyObserver()` after the page is in a known-ready state — the safest hook is after `window.__bskiosk_injected__ = true`, at the same level as the other one-time listener setups.

---

### `src/inject/fragile-selectors.js` — add cart-empty observer selector

**Analog:** `src/inject/fragile-selectors.js` lines 72-87 (`STABLE_SELECTORS` entries):
```javascript
var STABLE_SELECTORS = [
  { category: 'stable', selector: '[data-role="topbar"]',         purpose: 'Topbar' },
  { category: 'stable', selector: '[data-role="product-search"] input', purpose: 'Product search input' },
  // ...
];
```

**New entry to append** inside `STABLE_SELECTORS` once the cart `data-role` is discovered via DevTools during Phase 10 execution:
```javascript
// Phase 10 D-11: cart container for cart-empty MutationObserver fallback.
// Discovered via DevTools during Phase 10 execution (RISK-02 in RESEARCH.md).
{ category: 'stable', selector: '[data-role="DISCOVERED-VALUE"]', purpose: 'Cart container (post-sale observer)' },
```

**Note:** The selector value is `'DISCOVERED-VALUE'` as a placeholder — the implementer fills this in during the first DevTools session against live Magicline. If Magicline uses a fragile MUI hash for the cart container, use `category: 'fragile'` instead and add to `FRAGILE_SELECTORS`.

---

### `test/postSale.test.js` (new) — main.js IPC state machine tests

**Analog:** `test/updateGate.test.js` lines 1-28 (hand-rolled mock pattern — the closest test-harness template):

```javascript
const test = require('node:test');
const assert = require('node:assert');

// Pure-module tests — no electron coupling required for updateGate.
const gate = require('../src/main/updateGate');

function makeLog() {
  const calls = [];
  return {
    calls,
    audit: (event, fields) => calls.push({ event, fields }),
    error: (msg) => calls.push({ event: 'error', msg }),
  };
}

function makeSessionReset() {
  let listener = null;
  return {
    onPostReset: (cb) => { listener = cb; },
    _fire: () => { if (listener) listener(); },
    _getListener: () => listener,
  };
}
```

**New mock factories to declare** in `test/postSale.test.js`:
```javascript
const test = require('node:test');
const assert = require('node:assert');

// Hand-rolled fakes (no sinon — project convention from test/updateGate.test.js)
function makeIpcMain() {
  const handlers = {};
  const calls = [];
  return {
    calls,
    on: (channel, cb) => { handlers[channel] = cb; },
    removeAllListeners: (channel) => { delete handlers[channel]; },
    emit: (channel, ...args) => {
      calls.push([channel, ...args]);
      if (handlers[channel]) handlers[channel](...args);
    },
    _getHandler: (channel) => handlers[channel],
  };
}

function makeIdleTimer() {
  const calls = [];
  return {
    calls,
    stop:  () => calls.push('stop'),
    start: () => calls.push('start'),
    bump:  () => calls.push('bump'),
  };
}

function makeSessionReset() {
  const calls = [];
  return {
    calls,
    hardReset: (opts) => { calls.push(['hardReset', opts]); return Promise.resolve(); },
    onPostReset: (cb) => {},
    onPreReset:  (cb) => {},
  };
}

function makeMainWindow() {
  const sent = [];
  return {
    sent,
    webContents: {
      isDestroyed: () => false,
      send: (ch, payload) => sent.push([ch, payload]),
    },
  };
}
```

**Electron mock injection pattern** (from `test/sessionReset.test.js` lines 50-60 — required for any test that imports a module with `require('electron')`):
```javascript
// Inject electron mock BEFORE requiring the module under test.
require.cache.electron = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: { ipcMain: fakeIpcMain, session: fakeSession },
};
try {
  const electronResolved = require.resolve('electron');
  require.cache[electronResolved] = require.cache.electron;
} catch (_e) {}
```

**Test coverage targets** for `test/postSale.test.js`:
1. `post-sale:trigger` with `postSaleShown=false` → calls `idleTimer.stop()` + sends `post-sale:show` + audits `post-sale.shown`
2. `post-sale:trigger` with `postSaleShown=true` → no-op (dedupe gate D-12)
3. `post-sale:next-customer` → resets `postSaleShown`, calls `idleTimer.start()`, audits `post-sale.dismissed via=next-customer`
4. `post-sale:auto-logout` → calls `hardReset({reason:'sale-completed', mode:'welcome'})`, audits `post-sale.dismissed via=auto-logout`
5. Double-trigger race: `post-sale:trigger` fires twice → only one `post-sale:show` sent

---

### `test/sessionReset.test.js` — extend for D-17 (sale-completed excluded from loop counter)

**Analog:** `test/sessionReset.test.js` lines 152-183 (the existing "11 steps in exact order" test — use as structural template):
```javascript
test('1st hardReset({reason:"idle-expired"}) runs all 11 D-15 steps in exact order', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: { get: () => {} } });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  // ...assertions
});
```

**New test to append** at end of `test/sessionReset.test.js`:
```javascript
test('D-17: 3x hardReset({reason:"sale-completed"}) within 60s does NOT trip loop guard', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  // store.get needed for welcome-mode IPC (pos-state-changed)
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  // Fire 3 sale-completed resets — should not latch loopActive
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, false, 'sale-completed resets must not trip loop guard');
  // All 3 must have emitted audit events (not suppressed)
  const auditLines = fakeLog._lines.audit.filter(e => e.event === 'idle.reset');
  assert.strictEqual(auditLines.length, 3, 'all 3 resets must emit idle.reset audit');
});

test('D-18: sale-completed reset still fires onPostReset', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  let postResetCount = 0;
  sessionReset.onPostReset(() => { postResetCount++; });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  assert.strictEqual(postResetCount, 1, 'onPostReset must fire for sale-completed');
});
```

---

### `test/updateGate.test.js` — extend for D-18 (sale-completed → onPostReset → install path)

**Analog:** `test/updateGate.test.js` lines 56-76 (existing `post-reset trigger fires installFn exactly once` test — structural template):
```javascript
test('onUpdateDownloaded: post-reset trigger fires installFn exactly once', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  let installed = 0;
  gate.onUpdateDownloaded({
    installFn: () => installed++,
    log,
    sessionResetModule: sr,
    getHour: () => 12, // not maintenance window
  });
  sr._fire();  // post-reset fires
  assert.strictEqual(installed, 1);
  // ...
  gate._resetForTests();
});
```

**New test to append** (D-18 end-to-end coverage — no updateGate.js code changes, just new coverage):
```javascript
test('D-18: sale-completed hardReset fires onPostReset which triggers updateGate install', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  let installed = 0;
  gate.onUpdateDownloaded({
    installFn: () => installed++,
    log,
    sessionResetModule: sr,
    getHour: () => 12, // outside maintenance window — post-reset trigger path
  });
  // Simulate: a sale-completed hardReset completes → onPostReset fires.
  // updateGate's postResetListener was registered via sr.onPostReset.
  // sr._fire() simulates the sessionReset.postResetListener() call.
  sr._fire();
  assert.strictEqual(installed, 1, 'updateGate must install after sale-completed onPostReset');
  const installAudit = log.calls.find(c => c.event === 'update.install');
  assert.ok(installAudit, 'update.install audit must be emitted');
  assert.strictEqual(installAudit.fields.trigger, 'post-reset');
  // Second fire must be no-op (first-trigger-wins per Phase 09 D-08)
  sr._fire();
  assert.strictEqual(installed, 1, 'second post-reset must not re-install');
  gate._resetForTests();
});
```

---

### `build/installer.nsh` — NSIS post-install PowerShell for default printer (D-14)

**Analog:** `build/installer.nsh` lines 12-16 (existing `!macro customInstall` block — direct extension point):
```nsis
!macro customInstall
  SetShellVarContext current
  CreateShortCut "$SMSTARTUP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0
  DetailPrint "Startup shortcut created: $SMSTARTUP\${PRODUCT_NAME}.lnk"
!macroend
```

**Append inside `!macro customInstall`** after the `DetailPrint` line:
```nsis
  ; Phase 10 D-14: Set Microsoft Print to PDF as default printer for bsfkiosk.
  ; Writes a temp PS1 to $TEMP to avoid inline-escaping complexity (RISK-05).
  ; perMachine:false ensures HKCU writes target the installing user (bsfkiosk).
  DetailPrint "Phase 10: Setting Microsoft Print to PDF as default printer..."
  WriteFile "$TEMP\bsk-set-printer.ps1" \
    "Set-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows' 'LegacyDefaultPrinterMode' 1; $p = Get-CimInstance -Class Win32_Printer -Filter 'Name=''Microsoft Print to PDF'''; if ($p) { Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter }"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$TEMP\bsk-set-printer.ps1"' $0
  Delete "$TEMP\bsk-set-printer.ps1"
  DetailPrint "Printer setup exit code: $0"
```

**Context note:** `SetShellVarContext current` (already on line 13) is the required prerequisite — it ensures HKCU writes land in the `bsfkiosk` user's hive when the installer runs as that user. No additional NSIS configuration needed; `build.nsis.include = "build/installer.nsh"` is already wired in `package.json`.

---

## Shared Patterns

### Sentinel relay (console.log → console-message → ipcMain.emit)
**Source:** `src/main/magiclineView.js` lines 294-339, `src/inject/inject.js` lines 99-100
**Apply to:** `src/inject/inject.js` (new sentinels), `src/main/magiclineView.js` (new branches)

The complete relay chain:
1. `inject.js` (Magicline main world): `try { console.log('BSK_SENTINEL_NAME'); } catch (e) {}`
2. `magiclineView.js` (console-message listener): `if (message && message.indexOf('BSK_SENTINEL_NAME') !== -1) { ipcMain.emit('ipc-channel', null, payload); }`
3. `main.js` (ipcMain.on): registers handler, calls business logic

### IPC naming convention (colon-separated)
**Source:** `src/main/preload.js` lines 40-47, `src/main/main.js` lines 566-581
**Apply to:** All new `post-sale:*` channels

Pattern: `domain:verb` format. Main → renderer channels: `post-sale:show`, `post-sale:hide`. Renderer → main channels: `post-sale:next-customer`, `post-sale:auto-logout`. Preload exposes `on*` for subscriptions and `notify*` for sends.

### Module-scoped flag pattern
**Source:** `src/main/main.js` lines 42, 465-467
**Apply to:** `postSaleShown` in `main.js`, `postSaleResolved` in `host.js`

Both flags follow the same lifecycle: initialized `false`, set to `true` when flow starts/resolves, cleared in the corresponding reset/cleanup path. The main-process flag (`postSaleShown`) clears on `onPreReset` and on `post-sale:next-customer`. The renderer flag (`postSaleResolved`) clears on every `showPostSaleOverlay()` call.

### Audit log call signature
**Source:** `src/main/logger.js` lines 103-112 (verified in RESEARCH.md §5)
**Apply to:** All new `log.audit()` calls in `main.js`

```javascript
// Exact call signatures for Phase 10:
log.audit('post-sale.shown',    { trigger: 'print-intercept' });
log.audit('post-sale.shown',    { trigger: 'cart-empty-fallback' });
log.audit('post-sale.dismissed', { via: 'next-customer' });
log.audit('post-sale.dismissed', { via: 'auto-logout' });
```

### Error handling / swallow pattern
**Source:** Throughout `magiclineView.js` console-message branches (lines 307-338)
**Apply to:** All new sentinel branches and IPC handlers

Pattern: wrap in `try { ... } catch (_) { /* swallow */ }`. Use `log.error(...)` only in main-process IPC handlers where logging infrastructure is available. Sentinels in `inject.js` use bare `try { ... } catch (e) {}` with no logging (no log API in Magicline's main world).

### Test module isolation pattern
**Source:** `test/sessionReset.test.js` lines 50-60 (require.cache injection)
**Apply to:** `test/postSale.test.js` (if it imports main.js or any electron-coupled module)

```javascript
// Inject before any require() of the module under test:
require.cache.electron = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { ipcMain: fakeIpcMain },
};
try {
  const electronResolved = require.resolve('electron');
  require.cache[electronResolved] = require.cache.electron;
} catch (_e) {}
```

---

## No Analog Found

All files have close analogs in the codebase. No files require fallback to RESEARCH.md patterns only.

| File | Note |
|------|------|
| `src/inject/fragile-selectors.js` cart entry | Placeholder until DevTools discovers the cart `data-role` value — the selector entry pattern itself is fully analogized. |
| `test/postSale.test.js` (new file) | No exact counterpart, but `test/updateGate.test.js` mock factories + `test/sessionReset.test.js` require.cache pattern together fully cover the needed structure. |

---

## Metadata

**Analog search scope:** `src/main/`, `src/host/`, `src/inject/`, `test/`, `build/`
**Files read:** 14 source files
**Pattern extraction date:** 2026-04-23

---

## PATTERN MAPPING COMPLETE

**Phase:** 10 — Post-Sale Flow with Print Interception
**Files classified:** 13
**Analogs found:** 13 / 13

### Coverage
- Files with exact analog: 11
- Files with role-match analog: 1 (`test/postSale.test.js`)
- Files with no analog: 0

### Key Patterns Identified
- All sentinel relay chains use `console.log('BSK_*')` → `console-message` listener → `ipcMain.emit()` — Phase 10 adds two new sentinels (`BSK_PRINT_INTERCEPTED`, `BSK_POST_SALE_FALLBACK`) to the existing relay without structural change
- `showPostSaleOverlay()` is a near-verbatim copy of `showIdleOverlay()` (host.js lines 315-344), substituting element IDs and adding `postSaleResolved` guard at the countdown-expiry branch
- `postSaleShown` (main.js) mirrors `welcomeTapPending` (main.js line 42) — module-scoped boolean, cleared in `onPreReset` callback, set on flow start
- `sessionReset.js` countable filter extends from one exclusion to two via `||` inside the existing negation (single-predicate change, lines 104-106)
- All test files use `node:test` + `node:assert` + `require.cache` injection — no sinon, no fake timers
- NSIS `!macro customInstall` is the established hook point; Phase 10 appends a temp-file PowerShell approach to avoid inline escaping fragility

### File Created
`C:\Users\Nico\vscode\bsfpos\.planning\phases\10-post-sale-flow-with-print-interception\10-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files.
