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
    try { if (window.__bskiosk_detectLogin) window.__bskiosk_detectLogin(); } catch (e) {}  // Phase 3
    return;
  }
  window.__bskiosk_injected__ = true;
  window.__bskiosk_events = window.__bskiosk_events || [];

  // --- Phase 4 one-time setup listeners (research pin #4, Pattern 10) ------
  // CRITICAL: all three listeners below are attached BELOW the idempotency
  // anchor (`window.__bskiosk_injected__ = true`) and NOT inside the early-
  // return block above. Listeners inside the re-injection path would stack
  // N× per did-navigate-in-page tick and fire N× per event (Pitfall 4).

  // 1) Product-search focus arbitration (D-05, NFC-06). focusin/focusout
  //    bubble; focus/blur do NOT and would silently miss the signal.
  document.addEventListener('focusin', function (e) {
    try {
      var container = document.querySelector('[data-role="product-search"]');
      if (container && e.target && container.contains(e.target)) {
        emit('product-search-focused', {});
      }
    } catch (err) { /* swallow */ }
  });
  document.addEventListener('focusout', function (e) {
    try {
      var container = document.querySelector('[data-role="product-search"]');
      if (container && e.target && container.contains(e.target)) {
        emit('product-search-blurred', {});
      }
    } catch (err) { /* swallow */ }
  });

  // 2) rAF-debounced activity emitter (D-09 #3, IDLE-01 bump source).
  //    MUI churn produces dozens of pointer events per second; rAF coalesces
  //    them to a single emit per frame (upper bound ~60/sec, cheap for the
  //    main-process idleTimer.bump reset-timer). Capture phase ensures the
  //    emit fires even if Magicline stopPropagation()'s the event deeper.
  var _activityPending = false;
  function _scheduleActivityEmit() {
    if (_activityPending) return;
    _activityPending = true;
    window.requestAnimationFrame(function () {
      _activityPending = false;
      emit('activity', {});
    });
  }
  document.addEventListener('pointerdown', _scheduleActivityEmit, true);
  document.addEventListener('touchstart',  _scheduleActivityEmit, true);

  // 3) Post-sale clear (D-21, IDLE-06). Verbatim port of the prototype
  //    click listener (BeeStrong_POS_Kiosk_Project.md ~lines 441-446). The
  //    'Jetzt verkaufen' literal lives in fragile-selectors.js as
  //    JETZT_VERKAUFEN_TEXT so Magicline copy drift is a single-file patch.
  document.addEventListener('click', function (e) {
    try {
      var btn = e.target && e.target.closest && e.target.closest('[data-role="button"]');
      if (!btn) return;
      if (btn.textContent && btn.textContent.trim() === JETZT_VERKAUFEN_TEXT) {
        // Phase 5 Plan 06 D-27: sale-completed audit sentinel. inject.js runs
        // in the Magicline main world without preload/IPC, so we use a
        // console.log sentinel that magiclineView.js matches on the
        // console-message listener and relays as `audit-sale-completed`.
        try { console.log('BSK_AUDIT_SALE_COMPLETED'); } catch (e) { /* swallow */ }
        // NFC descope (2026-04-14, quick 260414-eu9): previously cleared the
        // customer-search input 3s after sale to wipe the last badge ID.
        // Member identification is no longer done at the kiosk, so there is
        // nothing to clear. The customer-search container remains hidden via
        // inject.css so members never see the field.
      }
    } catch (err) { /* swallow */ }
  });

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
    var onCashRegister = /^#\/cash-register(\/|$|\?)/i.test(location.hash);
    for (var i = 0; i < all.length; i++) {
      var entry = all[i];
      if (!entry || !entry.selector) continue;
      // Skip login-page-only selectors when on the cash register page
      if (entry.page === 'login' && onCashRegister) continue;
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

  // --- Login page detection (Phase 3, D-04) -------------------------------
  // Emit 'login-detected' when [data-role="username"] is live in the DOM.
  //
  // NOTE: the original plan used location.hash as a negative gate (bail if
  // hash matches #/cash-register). UAT Test 1 proved that Magicline keeps
  // the URL at #/cash-register even when rendering the login form for an
  // unauthenticated session, so the URL gate silently blocked all detection.
  // DOM presence is the only trustworthy signal — product-search
  // (detectReady) and username (detectLogin) are mutually exclusive in
  // practice since Magicline never shows both simultaneously.
  //
  // Dedupe by time (1s window) instead of hash so that the rerun-boot
  // side-effect path (CREDENTIALS_UNAVAILABLE → PIN → NEEDS_CREDENTIALS
  // → BOOTING → rerun-boot) gets a fresh login-detected even when the URL
  // hash is unchanged.
  var lastLoginEmitAt = 0;
  var LOGIN_DEDUP_MS = 1000;
  function detectLogin() {
    try {
      var u = document.querySelector('[data-role="username"]');
      if (!u) return;
      var now = Date.now();
      if (now - lastLoginEmitAt < LOGIN_DEDUP_MS) return;
      lastLoginEmitAt = now;
      emit('login-detected', { url: location.hash });
    } catch (e) { /* swallow */ }
  }
  window.__bskiosk_detectLogin = detectLogin;

  // --- Register auto-selection ---------------------------------------------
  // After login, Magicline may show "Verkauf nicht möglich. Bitte Kasse
  // auswählen." instead of going directly to #/cash-register. This happens
  // after every session reset because clearStorageData wipes the register
  // cookie. Auto-select "Self-Checkout" to complete the post-login flow.
  var registerSelectInProgress = false;
  function detectAndSelectRegister() {
    if (registerSelectInProgress) return;
    try {
      var buttons = document.querySelectorAll('[data-role="button"]');
      var kasseBtn = null;
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent.trim() === 'Kasse auswählen') {
          kasseBtn = buttons[i];
          break;
        }
      }
      if (!kasseBtn) return;
      registerSelectInProgress = true;
      console.log('[BSK] register-select: found Kasse auswählen, clicking');

      // Step 1: click "Kasse auswählen"
      kasseBtn.click();

      // Step 2: click the autocomplete input to open the dropdown
      setTimeout(function () {
        try {
          // MUI Autocomplete opens on the popup-indicator (arrow) button click,
          // or on input focus + ArrowDown. Try the popup indicator first,
          // fall back to focus + ArrowDown on the input.
          var popupBtn = document.querySelector('.MuiAutocomplete-popupIndicator');
          if (popupBtn) {
            console.log('[BSK] register-select: clicking popup indicator');
            popupBtn.click();
          } else {
            var autoInput = document.querySelector('.MuiAutocomplete-root input');
            if (autoInput) {
              console.log('[BSK] register-select: focusing input + ArrowDown');
              autoInput.focus();
              autoInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            } else {
              console.log('[BSK] register-select: no popup indicator or input found');
            }
          }
        } catch (e) { console.log('[BSK] register-select step 2 error: ' + e); }

        // Step 3: wait for options to render, select "Self-Checkout"
        setTimeout(function () {
          try {
            var options = document.querySelectorAll('[role="option"]');
            console.log('[BSK] register-select: found ' + options.length + ' options');
            var target = null;
            for (var j = 0; j < options.length; j++) {
              if (options[j].textContent.trim() === 'Self-Checkout') {
                target = options[j];
                break;
              }
            }
            if (target) {
              console.log('[BSK] register-select: clicking Self-Checkout');
              target.click();
              // Step 4: wait for selection to settle, click "Speichern"
              setTimeout(function () {
                try {
                  var submitBtns = document.querySelectorAll('[type="submit"][data-role="button"]');
                  for (var k = 0; k < submitBtns.length; k++) {
                    if (submitBtns[k].textContent.trim() === 'Speichern') {
                      submitBtns[k].click();
                      break;
                    }
                  }
                } catch (e) { /* swallow */ }
                registerSelectInProgress = false;
              }, 500);
            } else {
              registerSelectInProgress = false;
            }
          } catch (e) {
            registerSelectInProgress = false;
          }
        }, 500);
      }, 500);
    } catch (e) {
      registerSelectInProgress = false;
    }
  }

  // --- Main-process-invoked login submit (Phase 3, D-04) ------------------
  // Called by authFlow.js via executeJavaScript with credentials
  // interpolated through JSON.stringify. Credentials are NEVER persisted
  // in page-world scope — they arrive as arguments and are used once.
  //
  // Flow: query 3 selectors → setMuiValue user → setMuiValue pass → rAF
  //     → click login button → emit 'login-submitted'.
  // Research §Login Click Semantics explains why plain .click() is enough
  // (React synthetic event delegation catches it).
  window.__bskiosk_fillAndSubmitLogin = function (user, pass) {
    try {
      var u = document.querySelector('[data-role="username"]');
      var p = document.querySelector('[data-role="password"]');
      var b = document.querySelector('[data-role="login-button"]');
      if (!u || !p || !b) {
        return false;
      }
      window.__bskiosk_setMuiValue(u, user);
      window.__bskiosk_setMuiValue(p, pass);
      // setTimeout (not rAF) lets MUI's controlled-input state settle before
      // the click. rAF is throttled to near-zero in hidden/zero-bounds
      // browsing contexts — irrelevant now that the Magicline view ships
      // with non-zero off-screen bounds, but kept as belt-and-suspenders.
      setTimeout(function () {
        try {
          b.click();
          // Reset the login-emit dedupe so a failed login (which re-renders
          // the form at the same hash) CAN fire a second login-detected.
          lastLoginEmitAt = 0;
          emit('login-submitted', { url: location.hash });
        } catch (e) { /* watchdog will catch */ }
      }, 16);
      return true;
    } catch (e) {
      return false;
    }
  };

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
      detectLogin();
      detectAndSelectRegister();
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
  detectLogin();  // Phase 3: fire login-detected immediately if the page is already at /#/login
})();
