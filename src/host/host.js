// src/host/host.js — renderer glue.
// Consumes window.kiosk exposed by preload.js.
// Phase 1: splash.
// Phase 2: magicline-error with variant awareness.
// Phase 3: credentials overlay, PIN modal (custom 3x4 keypad), Tastatur buttons.
//
// Strict CSP: no inline scripts, no inline handlers. All wiring is attached
// here via addEventListener.

(function () {
  'use strict';

  if (window.kiosk && window.kiosk.isDev) {
    document.body.setAttribute('data-dev', 'true');
  }

  // =================================================================
  // Phase 1 — Splash
  // =================================================================
  function hideSplash() {
    var el = document.getElementById('splash');
    if (el) el.style.display = 'none';
  }
  function showSplash() {
    var el = document.getElementById('splash');
    if (el) el.style.display = 'flex';
  }

  // =================================================================
  // Phase 2/3/4 — Magicline error (variant-aware)
  // =================================================================
  // Variant click-target handlers. Phase 3 variants route the PIN button to
  // requestPinRecovery; Phase 4 reset-loop variant routes to
  // requestResetLoopRecovery. We assign .onclick per variant (instead of
  // stacking addEventListener calls) so the handler is replaced, not
  // accumulated across variant switches.
  function pinBtnRequestPinRecovery() {
    try {
      if (window.kiosk && window.kiosk.requestPinRecovery) {
        window.kiosk.requestPinRecovery();
      }
    } catch (e) { /* ignore */ }
  }
  function pinBtnRequestResetLoopRecovery() {
    try {
      if (window.kiosk && window.kiosk.requestResetLoopRecovery) {
        window.kiosk.requestResetLoopRecovery();
      }
    } catch (e) { /* ignore */ }
  }

  function showMagiclineError(payload) {
    var el = document.getElementById('magicline-error');
    if (!el) return;
    var variant = (payload && payload.variant) || 'drift';
    var title = el.querySelector('.bsk-error-title');
    var sub = el.querySelector('.bsk-error-subtext');
    var pinBtn = document.getElementById('error-pin-button');

    // Variant copy table (D-09, D-08 German messages)
    if (variant === 'drift') {
      if (title) title.textContent = 'Kasse vor\u00FCbergehend nicht verf\u00FCgbar';
      if (sub)   sub.textContent   = (payload && payload.message) || 'Bitte wenden Sie sich an das Studio-Personal';
      if (pinBtn) {
        pinBtn.style.display = 'none';
        pinBtn.onclick = pinBtnRequestPinRecovery;
      }
    } else if (variant === 'credentials-unavailable') {
      if (title) title.textContent = 'Anmeldedaten nicht verf\u00FCgbar';
      if (sub)   sub.textContent   = 'Administrator erforderlich \u2014 Bitte Studio-Personal verst\u00E4ndigen';
      if (pinBtn) {
        pinBtn.style.display = 'inline-block';
        pinBtn.textContent = 'PIN eingeben';
        pinBtn.onclick = pinBtnRequestPinRecovery;
      }
    } else if (variant === 'login-failed') {
      if (title) title.textContent = 'Anmeldung fehlgeschlagen';
      if (sub)   sub.textContent   = 'Bitte Studio-Personal verst\u00E4ndigen';
      if (pinBtn) {
        pinBtn.style.display = 'inline-block';
        pinBtn.textContent = 'PIN eingeben';
        pinBtn.onclick = pinBtnRequestPinRecovery;
      }
    } else if (variant === 'reset-loop') {
      // Phase 4 D-19 — unrecoverable reset-storm. Staff must enter PIN to
      // relaunch. Click target is requestResetLoopRecovery, NOT
      // requestPinRecovery (variant-specific routing per 04-UI-SPEC).
      if (title) title.textContent = 'Kiosk muss neu gestartet werden';
      if (sub)   sub.textContent   = 'Bitte Studio-Personal verst\u00E4ndigen';
      if (pinBtn) {
        pinBtn.style.display = 'inline-block';
        pinBtn.textContent = 'PIN eingeben';
        pinBtn.onclick = pinBtnRequestResetLoopRecovery;
      }
    }

    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
  }
  function hideMagiclineError() {
    var el = document.getElementById('magicline-error');
    if (!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }

  // =================================================================
  // Phase 4 — Idle overlay (Layer 200, D-11 / 04-UI-SPEC countdown contract)
  // =================================================================
  var idleInterval = null;

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
    var countdown = 30;
    numEl.textContent = '30';
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

  function dismissIdleOverlay() {
    // Single dismiss path for button click AND overlay
    // pointerdown/touchstart/keydown (UI-SPEC §Component Inventory).
    hideIdleOverlayDom();
    try {
      if (window.kiosk && window.kiosk.notifyIdleDismissed) {
        window.kiosk.notifyIdleDismissed();
      }
    } catch (e) { /* ignore */ }
  }

  // =================================================================
  // Phase 3 — Credentials overlay
  // =================================================================
  var credsFirstRun = false;

  function showCredentialsOverlay(payload) {
    credsFirstRun = !!(payload && payload.firstRun);
    var overlay = document.getElementById('credentials-overlay');
    var firstRunFields = document.getElementById('creds-firstrun-fields');
    if (firstRunFields) firstRunFields.style.display = credsFirstRun ? 'block' : 'none';
    // Clear any previous values and errors
    ['creds-user', 'creds-pass', 'creds-pin', 'creds-pin2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    setCredsError('');
    setPinFieldError(false);
    updateSubmitEnabled();
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  function hideCredentialsOverlay() {
    var overlay = document.getElementById('credentials-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function setCredsError(msg) {
    var el = document.getElementById('creds-inline-error');
    if (!el) return;
    if (msg && msg.length > 0) {
      el.textContent = msg;
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function setPinFieldError(show) {
    var el = document.getElementById('creds-pin-error');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  function updateSubmitEnabled() {
    var user = (document.getElementById('creds-user') || {}).value || '';
    var pass = (document.getElementById('creds-pass') || {}).value || '';
    var submit = document.getElementById('creds-submit');
    var valid = user.trim().length > 0 && pass.length > 0;
    if (credsFirstRun) {
      var pin1 = (document.getElementById('creds-pin') || {}).value || '';
      var pin2 = (document.getElementById('creds-pin2') || {}).value || '';
      valid = valid && /^[0-9]{4,6}$/.test(pin1) && pin1 === pin2;
    }
    if (submit) submit.disabled = !valid;
  }

  function togglePasswordVisibility() {
    var inp = document.getElementById('creds-pass');
    var btn = document.getElementById('creds-pass-toggle');
    if (!inp || !btn) return;
    if (inp.type === 'password') {
      inp.type = 'text';
      btn.textContent = 'Verbergen';
    } else {
      inp.type = 'password';
      btn.textContent = 'Zeigen';
    }
  }

  async function submitCredentials() {
    var user = (document.getElementById('creds-user') || {}).value || '';
    var pass = (document.getElementById('creds-pass') || {}).value || '';
    var pin1 = (document.getElementById('creds-pin') || {}).value || '';
    var pin2 = (document.getElementById('creds-pin2') || {}).value || '';

    if (credsFirstRun) {
      if (!/^[0-9]{4,6}$/.test(pin1)) {
        setPinFieldError(true);
        return;
      }
      if (pin1 !== pin2) {
        setPinFieldError(true);
        return;
      }
      setPinFieldError(false);
    }

    var submit = document.getElementById('creds-submit');
    if (submit) submit.disabled = true;
    setCredsError('');

    var payload = {
      firstRun: credsFirstRun,
      user: user.trim(),
      pass: pass,
    };
    if (credsFirstRun) payload.pin = pin1;

    try {
      var result = await window.kiosk.submitCredentials(payload);
      if (!result || !result.ok) {
        setCredsError('Speichern fehlgeschlagen: ' + ((result && result.error) || 'unbekannt'));
        if (submit) submit.disabled = false;
      }
      // On success main will hide the overlay via 'hide-credentials-overlay' IPC.
    } catch (e) {
      setCredsError('IPC-Fehler: ' + (e && e.message));
      if (submit) submit.disabled = false;
    }
  }

  // =================================================================
  // Phase 3 — PIN modal (custom 3x4 numeric keypad)
  // =================================================================
  var pinBuffer = '';
  var PIN_MAX = 6;

  function showPinModal() {
    pinBuffer = '';
    updatePinDisplay();
    setPinModalError(false);
    var modal = document.getElementById('pin-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function hidePinModal() {
    var modal = document.getElementById('pin-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    pinBuffer = '';
    updatePinDisplay();
  }

  function updatePinDisplay() {
    var el = document.getElementById('pin-display');
    if (!el) return;
    // Show • for each digit; 4 slots minimum to hint expected length
    var dots = '';
    for (var i = 0; i < Math.max(4, pinBuffer.length); i++) {
      dots += (i < pinBuffer.length) ? '\u2022' : '\u00B7';
    }
    el.textContent = dots;
  }

  function setPinModalError(show) {
    var el = document.getElementById('pin-modal-error');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  async function handleKeypadKey(key) {
    setPinModalError(false);
    if (key === 'back') {
      if (pinBuffer.length > 0) pinBuffer = pinBuffer.slice(0, -1);
      updatePinDisplay();
      return;
    }
    if (key === 'ok') {
      if (pinBuffer.length < 4) {
        setPinModalError(true);
        return;
      }
      var submitted = pinBuffer;
      pinBuffer = '';
      updatePinDisplay();
      try {
        var res = await window.kiosk.verifyPin(submitted);
        if (!res || !res.ok) {
          setPinModalError(true);
        }
        // On success main will hide the PIN modal and show credentials overlay.
      } catch (e) {
        setPinModalError(true);
      }
      return;
    }
    // digit key
    if (/^[0-9]$/.test(key) && pinBuffer.length < PIN_MAX) {
      pinBuffer += key;
      updatePinDisplay();
    }
  }

  // =================================================================
  // Wiring
  // =================================================================
  function wireStatic() {
    // Submit button
    var submit = document.getElementById('creds-submit');
    if (submit) submit.addEventListener('click', submitCredentials);

    // Field live-validation
    ['creds-user', 'creds-pass', 'creds-pin', 'creds-pin2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', updateSubmitEnabled);
    });

    // Password visibility toggle
    var toggle = document.getElementById('creds-pass-toggle');
    if (toggle) toggle.addEventListener('click', togglePasswordVisibility);

    // Tastatur (TabTip launch) buttons
    var kbdButtons = document.querySelectorAll('.bsk-btn--kbd');
    for (var i = 0; i < kbdButtons.length; i++) {
      kbdButtons[i].addEventListener('click', function (ev) {
        try {
          if (window.kiosk && window.kiosk.launchTouchKeyboard) {
            window.kiosk.launchTouchKeyboard();
          }
        } catch (e) { /* ignore */ }
        // Also focus the target field so keyboard (if any) knows where to type
        var target = ev.currentTarget.getAttribute('data-kbd-for');
        var t = target ? document.getElementById(target) : null;
        if (t) t.focus();
      });
    }

    // Error overlay PIN button — variant-aware click target is assigned
    // via .onclick inside showMagiclineError (Phase 3 requestPinRecovery vs
    // Phase 4 reset-loop requestResetLoopRecovery). Default to Phase 3
    // behaviour so clicks work even if a variant with no explicit onclick
    // assignment ever shows the button.
    var errPin = document.getElementById('error-pin-button');
    if (errPin) {
      errPin.onclick = pinBtnRequestPinRecovery;
    }

    // Idle overlay dismiss bindings — button click AND overlay
    // pointerdown/touchstart/keydown route to the same dismiss() function
    // per 04-UI-SPEC §Component Inventory.
    var idleBtn = document.getElementById('idle-dismiss-btn');
    if (idleBtn) {
      idleBtn.addEventListener('click', dismissIdleOverlay);
    }
    var idleOverlay = document.getElementById('idle-overlay');
    if (idleOverlay) {
      idleOverlay.addEventListener('pointerdown', dismissIdleOverlay);
      idleOverlay.addEventListener('touchstart',  dismissIdleOverlay);
      idleOverlay.addEventListener('keydown',     dismissIdleOverlay);
    }

    // Keypad buttons
    var keypadButtons = document.querySelectorAll('.bsk-keypad-btn');
    for (var j = 0; j < keypadButtons.length; j++) {
      keypadButtons[j].addEventListener('click', function (ev) {
        var key = ev.currentTarget.getAttribute('data-key');
        if (key) handleKeypadKey(key);
      });
    }
  }

  // IPC subscriptions
  if (window.kiosk) {
    if (window.kiosk.onHideSplash)           window.kiosk.onHideSplash(hideSplash);
    if (window.kiosk.onShowSplash)           window.kiosk.onShowSplash(showSplash);
    if (window.kiosk.onShowMagiclineError)   window.kiosk.onShowMagiclineError(showMagiclineError);
    if (window.kiosk.onHideMagiclineError)   window.kiosk.onHideMagiclineError(hideMagiclineError);
    if (window.kiosk.onShowCredentialsOverlay) window.kiosk.onShowCredentialsOverlay(showCredentialsOverlay);
    if (window.kiosk.onHideCredentialsOverlay) window.kiosk.onHideCredentialsOverlay(hideCredentialsOverlay);
    if (window.kiosk.onShowPinModal)         window.kiosk.onShowPinModal(showPinModal);
    if (window.kiosk.onHidePinModal)         window.kiosk.onHidePinModal(hidePinModal);
    // Phase 4 — idle overlay IPC
    if (window.kiosk.onShowIdleOverlay)      window.kiosk.onShowIdleOverlay(showIdleOverlay);
    if (window.kiosk.onHideIdleOverlay)      window.kiosk.onHideIdleOverlay(hideIdleOverlayDom);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireStatic);
  } else {
    wireStatic();
  }
})();
