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

  // --- Phase 10 D-11: cart-empty fallback state (one-time) -------------
  // Armed by the existing 'Jetzt verkaufen' click listener below; cleared
  // when cart goes non-zero OR when the 120s window expires. A 500ms debounce
  // absorbs React re-render glitches where the DOM momentarily removes items
  // before re-adding them.
  var _paymentConfirmedAt = 0;
  var _postSaleFallbackTimer = null;
  var PAYMENT_CONFIRM_WINDOW_MS = 120000;

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
        // Phase 10 D-11: arm cart-empty fallback gate. The observer below
        // fires BSK_POST_SALE_FALLBACK only if the cart transitions to
        // zero within PAYMENT_CONFIRM_WINDOW_MS of THIS arming.
        _paymentConfirmedAt = Date.now();
        // NFC descope (2026-04-14, quick 260414-eu9): previously cleared the
        // customer-search input 3s after sale to wipe the last badge ID.
        // Member identification is no longer done at the kiosk, so there is
        // nothing to clear. The customer-search container remains hidden via
        // inject.css so members never see the field.
      }
    } catch (err) { /* swallow */ }
  });

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
    // WR-02 fix: lock the override with Object.defineProperty so that any
    // subsequent `window.print = nativePrint` assignment by Magicline (or a
    // script it loads) silently fails (non-strict) or throws (strict) rather
    // than silently replacing our interceptor. `writable: false` + `configurable: false`
    // also blocks re-definition via defineProperty. This only defends against
    // assignment-based overwrites — a determined caller using their own
    // defineProperty would be rejected by `configurable: false` as well.
    // _originalPrint retained below purely for potential future diagnostic
    // use; NEVER invoke it from production code paths.
    var _originalPrint = window.print;
    var _bskPrintOverride = function () {
      try { console.log('BSK_PRINT_INTERCEPTED'); } catch (e) { /* swallow */ }
      // Do NOT call _originalPrint — Chrome's print preview must never open.
    };
    Object.defineProperty(window, 'print', {
      value: _bskPrintOverride,
      writable: false,
      configurable: false,
    });
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
        // WR-01 fix: defer the gate clear to the same 500ms debounce window
        // used for empty observations. React MUI re-renders can briefly emit
        // an interim non-empty state between the "Jetzt verkaufen" click and
        // the empty state; an immediate `_paymentConfirmedAt = 0` here would
        // silently disarm the fallback before the true empty render lands.
        // Only zero the gate after a sustained non-empty period.
        if (_paymentConfirmedAt && !_postSaleFallbackTimer) {
          _postSaleFallbackTimer = setTimeout(function () {
            _postSaleFallbackTimer = null;
            if (_getCartItemCount() !== 0) _paymentConfirmedAt = 0;
          }, 500);
        }
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

  // --- Register auto-selection (Phase 07 SPLASH-01 / LOCALE-01) ------------
  // State machine replaces the pre-Phase-07 nested setTimeout chain. Each step
  // has a 1200 ms DOM-appearance budget; total worst-case wall time 4 steps ×
  // 1200 ms = 4800 ms, which stays under the 5500 ms host-side safety timeout
  // owned by Plan 05 (07-RESEARCH.md §7, §9 item 6). Every terminal state
  // routes through markRegisterReady() + emitAutoSelectResult() so the splash
  // gate in Plan 05 always clears.
  var CHAIN_IDLE = 'idle';
  var CHAIN_STEP1 = 'step1-kasse';
  var CHAIN_STEP2 = 'step2-popup';
  var CHAIN_STEP3 = 'step3-self-checkout';
  var CHAIN_STEP4 = 'step4-speichern';
  var CHAIN_DONE = 'done';

  var chainState = CHAIN_IDLE;
  var chainStepStartedAt = 0;
  var CHAIN_STEP_TIMEOUT_MS = 1200;
  var chainFallbackTimer = null;
  var alreadyOnRegisterEmitted = false;

  function chainFinish(result, step, degraded) {
    if (chainState === CHAIN_DONE) return;
    chainState = CHAIN_DONE;
    try { emitAutoSelectResult(result, step); } catch (_) {}
    try { markRegisterReady({ degraded: !!degraded }); } catch (_) {}
    if (chainFallbackTimer) {
      try { clearInterval(chainFallbackTimer); } catch (_) {}
      chainFallbackTimer = null;
    }
  }

  function findKasseBtn() {
    var buttons = document.querySelectorAll('[data-role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].textContent && buttons[i].textContent.trim() === LOCALE_STRINGS.de.KASSE_AUSWAEHLEN) {
        return buttons[i];
      }
    }
    return null;
  }

  function findPopupIndicator() {
    // MUI Autocomplete exposes a popup indicator button. Stable class across
    // MUI versions used by Magicline to date; if this drifts the Step 2
    // timeout will fire and the chain will degrade gracefully.
    return document.querySelector('.MuiAutocomplete-popupIndicator');
  }

  function findSelfCheckoutOption() {
    var options = document.querySelectorAll('[role="option"]');
    for (var j = 0; j < options.length; j++) {
      if (options[j].textContent && options[j].textContent.trim() === LOCALE_STRINGS.de.SELF_CHECKOUT_OPTION) {
        return options[j];
      }
    }
    return null;
  }

  function findSpeichernBtn() {
    var submitBtns = document.querySelectorAll('[type="submit"][data-role="button"]');
    for (var k = 0; k < submitBtns.length; k++) {
      if (submitBtns[k].textContent && submitBtns[k].textContent.trim() === LOCALE_STRINGS.de.SPEICHERN) {
        return submitBtns[k];
      }
    }
    return null;
  }

  function chainAdvanceTo(nextState) {
    chainState = nextState;
    chainStepStartedAt = 0; // reset per-step timer on transition
  }

  function chainTick() {
    if (chainState === CHAIN_DONE) return;
    var now = Date.now();
    if (chainStepStartedAt === 0) chainStepStartedAt = now;

    if (chainState === CHAIN_IDLE) {
      // Only enter the chain when the Kasse auswählen page is actually
      // rendered. If we're on #/cash-register with the product search input
      // present (i.e. detectReady has fired) but no Kasse button, we are on
      // the already-on-register branch — emit once and exit.
      var kasse = findKasseBtn();
      if (kasse) {
        try { kasse.click(); } catch (_) {}
        try { console.log('[BSK] register-select: step1 clicked'); } catch (_) {}
        chainAdvanceTo(CHAIN_STEP2);
        return;
      }
      // Already-on-register branch — only fire once per page, and only after
      // detectReady has confirmed we are on the cash-register hash with the
      // product search input present (see §6 and §9 item 4 of research).
      if (!alreadyOnRegisterEmitted && readyEmitted) {
        alreadyOnRegisterEmitted = true;
        chainFinish('ok', 'already-on-register', false);
      }
      return;
    }

    if (chainState === CHAIN_STEP2) {
      var popup = findPopupIndicator();
      if (popup) {
        try { popup.click(); } catch (_) {}
        try { console.log('[BSK] register-select: step2 clicked'); } catch (_) {}
        chainAdvanceTo(CHAIN_STEP3);
        return;
      }
    } else if (chainState === CHAIN_STEP3) {
      var opt = findSelfCheckoutOption();
      if (opt) {
        try { opt.click(); } catch (_) {}
        try { console.log('[BSK] register-select: step3 clicked'); } catch (_) {}
        chainAdvanceTo(CHAIN_STEP4);
        return;
      }
    } else if (chainState === CHAIN_STEP4) {
      var save = findSpeichernBtn();
      if (save) {
        try { save.click(); } catch (_) {}
        try { console.log('[BSK] register-select: step4 clicked — success'); } catch (_) {}
        chainFinish('ok', 'done', false);
        return;
      }
    }

    // Step did not advance — check per-step timeout
    if (now - chainStepStartedAt > CHAIN_STEP_TIMEOUT_MS) {
      try { console.log('[BSK] register-select: step timeout at ' + chainState); } catch (_) {}
      chainFinish('fail', chainState, true);
    }
  }

  function detectAndSelectRegister() {
    // Tick from the rAF-debounced schedule(). Also ensure the fallback
    // setInterval is running so we keep progressing when the Magicline DOM
    // is quiet between synthetic clicks.
    if (chainState !== CHAIN_DONE && !chainFallbackTimer) {
      try {
        chainFallbackTimer = setInterval(function () {
          try { chainTick(); } catch (_) {}
          if (chainState === CHAIN_DONE && chainFallbackTimer) {
            try { clearInterval(chainFallbackTimer); } catch (_) {}
            chainFallbackTimer = null;
          }
        }, 100);
      } catch (_) {}
    }
    try { chainTick(); } catch (_) {}
  }

  // --- Phase 07 SPLASH-01 / LOCALE-01: sentinel bridge helpers -----------
  // Clone of readyEmitted (§209-229) and BSK_AUDIT_SALE_COMPLETED (§91-108)
  // patterns. The console.log sentinel is caught in src/main/magiclineView.js
  // console-message listener and relayed via ipcMain.
  //
  // Call sites (wired in Plan 04):
  //   (a) Successful chain end — after Speichern click resolves.
  //   (b) "Already on cash register, no selection needed" branch.
  //   (c) Bounded-retry exhaustion — with degraded:true.
  //
  // Across welcome cycles: the Magicline view is destroyed and recreated on
  // hardReset, which re-runs the IIFE from scratch, so registerReadyEmitted
  // is naturally reset to false per page load. No manual reset needed.
  var registerReadyEmitted = false;
  function markRegisterReady(opts) {
    if (registerReadyEmitted) return;
    registerReadyEmitted = true;
    var degraded = !!(opts && opts.degraded);
    try {
      console.log(degraded ? 'BSK_REGISTER_SELECTED_DEGRADED' : 'BSK_REGISTER_SELECTED');
    } catch (e) { /* swallow */ }
  }

  // Structured auto-select result emitter. Format:
  //   BSK_AUTO_SELECT_RESULT:<result>:<step>
  // Allowed result ∈ {ok, fail, timeout}.
  // Allowed step   ∈ {idle, step1-kasse, step2-popup, step3-self-checkout,
  //                   step4-speichern, done, already-on-register, unknown}.
  // The magiclineView.js catch-side parser re-validates against the allowlist
  // and falls back to 'unknown' on any other value — do not rely on this
  // side for security, inject.js runs in the untrusted Magicline main world.
  function emitAutoSelectResult(result, step) {
    try {
      console.log('BSK_AUTO_SELECT_RESULT:' + String(result || 'unknown') + ':' + String(step || 'unknown'));
    } catch (e) { /* swallow */ }
  }

  // Dev-mode handles so kiosk-visit testers can force states from DevTools.
  try {
    window.__bskiosk_markRegisterReady = markRegisterReady;
    window.__bskiosk_emitAutoSelectResult = emitAutoSelectResult;
  } catch (e) { /* swallow */ }

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
      _ensureCartEmptyObserver();
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
