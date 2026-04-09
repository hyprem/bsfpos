// src/inject/inject.js
// -----------------------------------------------------------------------------
// Magicline main-world injection bundle.
//
// Consumed as a raw string by src/main/magiclineView.js, which prepends
// fragile-selectors.js (declaring FRAGILE_SELECTORS / STABLE_SELECTORS at
// global scope) and passes the combined string to webContents.executeJavaScript.
//
// Runs in MAGICLINE'S MAIN WORLD — no preload, no IPC renderer API, no Node APIs.
// Events are buffered on window.__bskiosk_events for main-process drain-poll
// consumption (Pattern 5 in 02-RESEARCH.md).
//
// Idempotent: re-execution on did-navigate-in-page re-runs the dynamic hide
// pass + self-check + ready-detect without re-attaching listeners/observers.
//
// SCOPE: Phase 2 only.
//   - Port of prototype hide + MUI setter helpers (BeeStrong_POS_Kiosk_Project.md lines 371-400)
//   - + boot-time self-check (EMBED-05)
//   - + drift event emission (D-06)
//   - + cash-register-ready detection (D-03)
//   - + scoped rAF-debounced MutationObserver (Pattern 3)
// OUT OF SCOPE (DO NOT ADD HERE — Phase 4):
//   - NFC badge capture (key-down handler with inter-character speed buffer)
//   - Post-sale setTimeout reset on the German "sell now" primary button click
//   - Idle timer (start-reset-timer / pointerdown listener)
// -----------------------------------------------------------------------------

(function () {
  'use strict';

  // --- Idempotency guard (Pattern 3) ---------------------------------------
  // On re-injection via did-navigate-in-page, skip listener/observer setup
  // and just re-run the dynamic hide pass + ready detection. selfCheck is
  // NOT called here — it runs from inside detectReady() after ready emits,
  // so all drift checks happen on a proven-hydrated page. See UAT gap G-04.
  if (window.__bskiosk_injected__) {
    try { if (window.__bskiosk_hideDynamic) window.__bskiosk_hideDynamic(); } catch (e) {}
    try { if (window.__bskiosk_detectReady) window.__bskiosk_detectReady(); } catch (e) {}
    return;
  }
  window.__bskiosk_injected__ = true;
  window.__bskiosk_events = window.__bskiosk_events || [];

  // --- Drain-queue event emitter (Pattern 5) -------------------------------
  // Main process polls `(() => { const q = window.__bskiosk_events || [];
  // window.__bskiosk_events = []; return q; })()` every 250ms.
  function emit(type, payload) {
    try {
      window.__bskiosk_events.push({
        type: String(type),
        payload: payload || {},
        t: Date.now()
      });
    } catch (e) { /* swallow — never let emit crash inject.js */ }
  }

  // --- setMuiValue (ported from prototype lines 371-378) -------------------
  // MUST run in main world so it hits React's patched HTMLInputElement.
  // Phase 3 auto-login and Phase 4 NFC injection BOTH reuse this helper.
  // Exposed on window for those phases to import.
  function setMuiValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.__bskiosk_setMuiValue = setMuiValue;

  // --- hideDynamicElements (ported from prototype lines 380-400) -----------
  // Rabatt button group (by text) + discount icon (by SVG path prefix).
  // These use structural/text matching so they survive MUI css-xxxxx rename.
  function hideDynamicElements() {
    try {
      document.querySelectorAll('[data-role="button"]').forEach(function (btn) {
        if (btn.textContent && btn.textContent.trim() === 'Rabatt') {
          var group = btn.closest('.MuiButtonGroup-root');
          if (group) group.style.setProperty('display', 'none', 'important');
        }
      });
    } catch (e) { /* swallow — querySelector syntax error should not break the kiosk */ }

    try {
      document.querySelectorAll('path').forEach(function (p) {
        var d = p.getAttribute('d');
        if (d && d.indexOf('m21.41 11.41') === 0) {
          var svg = p.closest('svg');
          if (svg) {
            var btn = svg.closest('button');
            if (btn) btn.style.setProperty('display', 'none', 'important');
            else    svg.style.setProperty('display', 'none', 'important');
          }
        }
      });
    } catch (e) { /* swallow */ }
  }
  window.__bskiosk_hideDynamic = hideDynamicElements;

  // --- Boot-time selector self-check (EMBED-05, D-05) ----------------------
  // Iterates the combined STABLE + FRAGILE list declared by fragile-selectors.js
  // (concatenated before this file). Any zero-match selector emits a 'drift'
  // event that the main process translates to a log.warn + show-magicline-error
  // IPC send to the host overlay.
  var driftReportedFor = {};  // dedupe inside a single page load
  function selfCheck() {
    var stable  = (typeof STABLE_SELECTORS  !== 'undefined') ? STABLE_SELECTORS  : [];
    var fragile = (typeof FRAGILE_SELECTORS !== 'undefined') ? FRAGILE_SELECTORS : [];
    var all = stable.concat(fragile);
    for (var i = 0; i < all.length; i++) {
      var entry = all[i];
      if (!entry || !entry.selector) continue;
      var count = -1;
      try { count = document.querySelectorAll(entry.selector).length; } catch (e) { count = -1; }
      if (count === 0 && !driftReportedFor[entry.selector]) {
        driftReportedFor[entry.selector] = true;
        emit('drift', {
          selector: entry.selector,
          category: entry.category || 'unknown',
          purpose:  entry.purpose  || ''
        });
      }
    }
  }
  window.__bskiosk_selfCheck = selfCheck;

  // --- Cash-register-ready detection (D-03, D-04) --------------------------
  // Fires 'cash-register-ready' exactly once per page load, AND only when:
  //   (a) location.hash matches /#/cash-register, AND
  //   (b) [data-role="product-search"] input is live in the DOM.
  // The hash check guards against false positives on login page dom-ready.
  // The element check guards against React hydration gaps.
  //
  // RATIONALE for the selector:
  //   product-search is cash-register-page-only. customer-search is also
  //   present on the cash register page but its container is display:none
  //   (inject.css EMBED-06 rule) — the inner <input> IS still in the DOM and
  //   querySelector works through display:none, but product-search is a
  //   cleaner positive signal because it's visibly present on the page.
  var readyEmitted = false;
  function detectReady() {
    if (readyEmitted) return;
    try {
      // Case-insensitive + anchored: real Magicline hash is '#/cash-Register'
      // (capital R) on this deployment, so the old /#\/cash-register/ regex
      // silently failed the ready-gate. Anchoring (^) + end-of-path clause
      // prevents false positives on '#/cash-register-settings' etc. Covers
      // code-review IN-01 and UAT gap G-03.
      if (!location.hash || !/^#\/cash-register(\/|$|\?)/i.test(location.hash)) return;
      var el = document.querySelector('[data-role="product-search"] input');
      if (!el) return;
      readyEmitted = true;
      emit('cash-register-ready', { url: location.hash });
      // Run self-check NOW (not at boot) — product-search input proves the
      // cash register page has hydrated enough for all other selectors to
      // exist. Running selfCheck at dom-ready causes false-positive drift
      // events because React hasn't rendered yet. See UAT gap G-04.
      selfCheck();
    } catch (e) { /* swallow */ }
  }
  window.__bskiosk_detectReady = detectReady;

  // --- Scoped, rAF-debounced MutationObserver (Pattern 3) ------------------
  // Scope to the closest stable parent of cart area — prefer <main>, fall back
  // to document.body. rAF coalesces storms of React re-renders into one
  // hide-pass per frame. Observer config is childList + subtree only (no
  // attributes/characterData — those explode on every MUI focus/hover change).
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () {
      pending = false;
      hideDynamicElements();
      detectReady();
    });
  }

  var observeTarget = null;
  try { observeTarget = document.querySelector('main'); } catch (e) {}
  if (!observeTarget) {
    observeTarget = document.body;
    emit('observer-scope-fallback', { target: 'document.body', reason: 'no <main> found' });
  }

  try {
    new MutationObserver(schedule).observe(observeTarget, {
      childList: true,
      subtree:   true
    });
  } catch (e) {
    emit('observer-attach-failed', { message: String(e && e.message) });
  }

  // --- Initial pass --------------------------------------------------------
  // selfCheck() is NOT called here — it runs inside detectReady() after the
  // cash-register-ready signal fires, by which time React has hydrated the
  // page and selector matches are trustworthy. See UAT gap G-04.
  hideDynamicElements();
  detectReady();
})();
