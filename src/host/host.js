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

  // Phase 07 SPLASH-01 — welcome-path splash gate state.
  // splashPendingMode is true only between a welcome:tap and the subsequent
  // splash:hide-final OR the 5500 ms safety timer firing OR any splash:hide
  // (which acts as a defensive force-clear). The 5500 ms budget gives
  // inject.js's 4800 ms chain worst case 700 ms of drain headroom through
  // console-message → ipcMain → webContents.send (see 07-RESEARCH.md §9#6).
  var splashPendingMode = false;
  var splashSafetyTimer = null;
  var SPLASH_SAFETY_TIMEOUT_MS = 5500;

  function hideSplash() {
    // Defensive clear: whether this fires on cold-boot, idle-recovery, or
    // as the fallback of the 5500 ms safety timeout, always leave the
    // pending state clean so the next welcome:tap starts fresh.
    if (splashSafetyTimer) {
      try { clearTimeout(splashSafetyTimer); } catch (_) {}
      splashSafetyTimer = null;
    }
    splashPendingMode = false;
    var el = document.getElementById('splash');
    if (el) {
      el.classList.remove('auto-select-pending');
      el.style.display = 'none';
    }
  }
  function showSplash() {
    var el = document.getElementById('splash');
    if (el) {
      el.classList.remove('auto-select-pending');
      el.style.display = 'flex';
    }
    // Do NOT clear splashPendingMode here — welcome:tap sends splash:show
    // BEFORE the subsequent enterSplashPendingMode() call below, so clearing
    // here would stomp the pending state we're about to set.
  }

  function enterSplashPendingMode() {
    if (splashPendingMode) return; // re-entry guard
    splashPendingMode = true;
    var el = document.getElementById('splash');
    if (el) el.classList.add('auto-select-pending');
    splashSafetyTimer = setTimeout(function () {
      // Safety fallback — the auto-select chain has not emitted a sentinel
      // within 5500 ms. Hide the splash anyway so the kiosk never sticks.
      try { console.warn('[BSK] splash safety timeout — auto-select did not emit in 5500ms'); } catch (_) {}
      splashSafetyTimer = null;
      hideSplash();
    }, SPLASH_SAFETY_TIMEOUT_MS);
  }

  function hideSplashFinal(payload) {
    // payload: { degraded: bool } — currently unused by host (audit log has
    // already been written on the main side); accept for future use.
    try { void payload; } catch (_) {}
    hideSplash(); // clears timer + pending class + display:none
  }

  // =================================================================
  // Phase 6 — Welcome screen (Layer 150, D-02 / D-04)
  // =================================================================
  function showWelcome() {
    var el = document.getElementById('welcome-screen');
    if (!el) return;
    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
  }
  function hideWelcome() {
    var el = document.getElementById('welcome-screen');
    if (!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }
  function handleWelcomeTap(ev) {
    // D-02: any pointer event anywhere on the welcome layer fires welcome:tap.
    // Also swallow the event so badge-scan keystrokes arriving concurrently
    // do not double-fire. Main owns the state transition (hide welcome →
    // show splash/loading → create Magicline view → authFlow.start).
    if (ev && ev.stopPropagation) ev.stopPropagation();
    // Enter pending mode BEFORE notifying main. The subsequent splash:show
    // IPC (sent from main in response to welcome:tap) goes through the
    // showSplash handler, which preserves the pending class via the
    // re-application below.
    enterSplashPendingMode();
    try {
      if (window.kiosk && window.kiosk.notifyWelcomeTap) {
        window.kiosk.notifyWelcomeTap();
      }
    } catch (_) { /* ignore */ }
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
    } else if (variant === 'bad-release') {
      // Phase 5 D-31 — post-update health check failed. Staff must recover.
      if (title) title.textContent = 'Update fehlgeschlagen';
      if (sub)   sub.textContent   = 'Bitte Studio-Personal verst\u00E4ndigen';
      if (pinBtn) {
        pinBtn.style.display = 'inline-block';
        pinBtn.textContent = 'PIN eingeben';
        pinBtn.onclick = pinBtnRequestPinRecovery;
      }
    } else if (variant === 'update-failed') {
      // Phase 5 D-32 — install attempt failed at install time. Kiosk still
      // runs on old version; auto-dismiss after 10s or tap.
      if (title) title.textContent = 'Aktualisierung fehlgeschlagen';
      if (sub)   sub.textContent   = 'Erneuter Versuch beim n\u00E4chsten Neustart \u2014 der Kiosk l\u00E4uft weiter.';
      if (pinBtn) {
        pinBtn.style.display = 'none';
      }
      // 10-second auto-dismiss + one-shot tap-to-dismiss
      if (updateFailedTimer) { clearTimeout(updateFailedTimer); updateFailedTimer = null; }
      if (updateFailedHandler) {
        el.removeEventListener('pointerdown', updateFailedHandler);
        updateFailedHandler = null;
      }
      updateFailedTimer = setTimeout(function () {
        updateFailedTimer = null;
        hideMagiclineError();
      }, 10000);
      updateFailedHandler = function () {
        if (updateFailedTimer) { clearTimeout(updateFailedTimer); updateFailedTimer = null; }
        hideMagiclineError();
      };
      el.addEventListener('pointerdown', updateFailedHandler, { once: true });
    }

    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
  }
  function hideMagiclineError() {
    var el = document.getElementById('magicline-error');
    if (!el) return;
    // Phase 5: clean up update-failed variant timers/handlers so stale
    // state does not leak across variant changes.
    if (updateFailedTimer) { clearTimeout(updateFailedTimer); updateFailedTimer = null; }
    if (updateFailedHandler) {
      el.removeEventListener('pointerdown', updateFailedHandler);
      updateFailedHandler = null;
    }
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }

  // =================================================================
  // Phase 4 — Idle overlay (Layer 200, D-11 / 04-UI-SPEC countdown contract)
  // =================================================================
  var idleInterval = null;

  // --- Phase 5 state ------------------------------------------------------
  var pinModalContext = 'admin';          // 'admin' | 'reset-loop'
  var lockoutInterval = null;             // countdown setInterval id
  var adminUpdateResultTimer = null;      // 5s auto-hide for admin update result
  var updateFailedTimer = null;           // 10s auto-dismiss for update-failed variant
  var updateFailedHandler = null;         // one-shot pointerdown listener for update-failed

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
      var splash = document.getElementById('splash');
      if (splash) splash.style.display = 'none';
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
        // Phase 5: route by context. Admin hotkey path uses verify-admin-pin
        // (with lockout); reset-loop recovery path uses legacy verify-pin
        // (with resetLoopPending intercept in main).
        var res;
        if (pinModalContext === 'admin' && window.kiosk.verifyAdminPin) {
          res = await window.kiosk.verifyAdminPin(submitted);
          if (res && res.locked) {
            showPinLockout({ lockedUntil: res.lockedUntil });
            // Do not close modal — lockout panel replaces keypad
            return;
          }
          if (res && res.ok) {
            // Main will send hide-pin-modal + show-admin-menu — nothing more to do
            return;
          }
          setPinModalError(true);
          return;
        }
        // Legacy path (context === 'reset-loop') flows through Phase 3 verify-pin
        res = await window.kiosk.verifyPin(submitted);
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
  // Phase 5 — Admin menu, update config, updating cover, PIN lockout
  // =================================================================

  function formatRelativeGerman(iso) {
    if (!iso) return 'noch nie';
    var t = (typeof iso === 'number') ? iso : Date.parse(iso);
    if (!Number.isFinite(t)) return 'noch nie';
    var diff = Date.now() - t;
    if (diff < 60000) return 'gerade eben';
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return 'vor ' + mins + ' Min';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return 'vor ' + hrs + ' Std';
    var days = Math.floor(hrs / 24);
    return 'vor ' + days + ' Tag(en)';
  }

  function authStateLabel(s) {
    switch (s) {
      case 'CASH_REGISTER_READY': return 'BEREIT';
      case 'LOGIN_SUBMITTED':     return 'ANMELDUNG';
      case 'LOGIN_DETECTED':      return 'LOGIN ERKANNT';
      case 'BOOTING':             return 'STARTET';
      case 'NEEDS_CREDENTIALS':   return 'KEINE DATEN';
      case 'CREDENTIALS_UNAVAILABLE': return 'FEHLER';
      default:                    return s || 'UNBEKANNT';
    }
  }

  function renderDiagnostics(d) {
    if (!d) return;
    var set = function (id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set('diag-version',       d.version ? ('v' + d.version) : '\u2014');
    set('diag-last-update',   formatRelativeGerman(d.lastUpdateCheck));
    set('diag-auth-state',    authStateLabel(d.authState));
    set('diag-last-reset',    formatRelativeGerman(d.lastResetAt));
    set('diag-update-status', d.updateStatus || '\u2014');
    // Swap "Auto-Update einrichten" / "Update-Zugang ändern" label
    var cfgBtn = document.getElementById('admin-btn-update-config');
    if (cfgBtn) cfgBtn.textContent = d.patConfigured ? 'Update-Zugang \u00E4ndern' : 'Auto-Update einrichten';
  }

  function showAdminMenu(diagnostics) {
    renderDiagnostics(diagnostics);
    var menu = document.getElementById('admin-menu');
    if (menu) { menu.style.display = 'flex'; menu.setAttribute('aria-hidden', 'false'); }
    var cfg = document.getElementById('update-config');
    if (cfg) { cfg.style.display = 'none'; cfg.setAttribute('aria-hidden', 'true'); }
  }

  function hideAdminMenu() {
    var menu = document.getElementById('admin-menu');
    if (menu) { menu.style.display = 'none'; menu.setAttribute('aria-hidden', 'true'); }
    var res = document.getElementById('admin-update-result');
    if (res) res.style.display = 'none';
    if (adminUpdateResultTimer) { clearTimeout(adminUpdateResultTimer); adminUpdateResultTimer = null; }
  }

  function showUpdateConfig(_payload) {
    var cfg = document.getElementById('update-config');
    if (cfg) { cfg.style.display = 'flex'; cfg.setAttribute('aria-hidden', 'false'); }
    var menu = document.getElementById('admin-menu');
    if (menu) { menu.style.display = 'none'; menu.setAttribute('aria-hidden', 'true'); }
    var input = document.getElementById('update-pat-input');
    if (input) input.value = '';
    var save = document.getElementById('update-config-save');
    if (save) save.disabled = true;
    var err = document.getElementById('update-config-error');
    if (err) err.style.display = 'none';
  }

  function hideUpdateConfig() {
    var cfg = document.getElementById('update-config');
    if (cfg) { cfg.style.display = 'none'; cfg.setAttribute('aria-hidden', 'true'); }
    var input = document.getElementById('update-pat-input');
    if (input) input.value = ''; // defensive: never retain PAT in DOM
  }

  function showUpdatingCover() {
    var el = document.getElementById('updating-cover');
    if (el) { el.style.display = 'flex'; el.setAttribute('aria-hidden', 'false'); }
  }

  function hideUpdatingCover() {
    var el = document.getElementById('updating-cover');
    if (el) { el.style.display = 'none'; el.setAttribute('aria-hidden', 'true'); }
  }

  function showAdminUpdateResult(payload) {
    var el = document.getElementById('admin-update-result');
    if (!el) return;
    var text = '\u2014';
    var status = payload && payload.status;
    if (status === 'none') text = 'Aktuell';
    else if (status === 'available') text = 'Update verf\u00FCgbar \u2014 wird bei n\u00E4chster Ruhepause installiert';
    else if (status === 'disabled') text = 'Auto-Update nicht konfiguriert';
    else if (status === 'error') text = 'Fehler bei der Update-Pr\u00FCfung';
    el.textContent = text;
    el.classList.toggle('bsk-admin-update-result--available', status === 'available');
    el.style.display = 'block';
    if (adminUpdateResultTimer) clearTimeout(adminUpdateResultTimer);
    adminUpdateResultTimer = setTimeout(function () {
      el.style.display = 'none';
      adminUpdateResultTimer = null;
    }, 5000);
  }

  function formatMmSs(remainingMs) {
    if (remainingMs < 0) remainingMs = 0;
    var mins = Math.floor(remainingMs / 60000);
    var secs = Math.floor((remainingMs % 60000) / 1000);
    return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function showPinLockout(payload) {
    var modal = document.getElementById('pin-modal');
    if (modal && modal.style.display === 'none') {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }
    var keypad = document.querySelector('#pin-modal .bsk-keypad');
    var display = document.getElementById('pin-display');
    var errEl = document.getElementById('pin-modal-error');
    var panel = document.getElementById('pin-lockout-panel');
    var countdownEl = document.getElementById('pin-lockout-countdown');
    if (keypad) keypad.style.display = 'none';
    if (display) display.style.display = 'none';
    if (errEl) errEl.style.display = 'none';
    if (panel) panel.style.display = 'block';

    // PITFALL 4 / T-05-31: guard against double setInterval
    if (lockoutInterval) { clearInterval(lockoutInterval); lockoutInterval = null; }

    var until = payload && payload.lockedUntil ? Date.parse(payload.lockedUntil) : 0;
    function tick() {
      var remaining = until - Date.now();
      if (countdownEl) countdownEl.textContent = formatMmSs(remaining);
      if (remaining <= 0) {
        if (lockoutInterval) { clearInterval(lockoutInterval); lockoutInterval = null; }
        hidePinLockout();
      }
    }
    tick();
    lockoutInterval = setInterval(tick, 1000);
  }

  function hidePinLockout() {
    if (lockoutInterval) { clearInterval(lockoutInterval); lockoutInterval = null; }
    var panel = document.getElementById('pin-lockout-panel');
    if (panel) panel.style.display = 'none';
    var keypad = document.querySelector('#pin-modal .bsk-keypad');
    var display = document.getElementById('pin-display');
    if (keypad) keypad.style.display = '';
    if (display) {
      display.style.display = '';
      display.textContent = '\u00B7\u00B7\u00B7\u00B7';
    }
  }

  function wireAdminButtons() {
    var handlers = {
      'admin-btn-check-updates':   'check-updates',
      'admin-btn-logs':            'view-logs',
      'admin-btn-reload':          'reload',
      'admin-btn-credentials':     're-enter-credentials',
      'admin-btn-update-config':   'configure-auto-update',
      'admin-btn-dev-mode':        'toggle-dev-mode',
      'admin-btn-exit':            'exit-to-windows',
    };
    Object.keys(handlers).forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (window.kiosk && window.kiosk.adminMenuAction) {
          window.kiosk.adminMenuAction(handlers[id]);
        }
      });
    });

    // PAT config form wiring
    var patInput = document.getElementById('update-pat-input');
    var saveBtn  = document.getElementById('update-config-save');
    var cancelBtn = document.getElementById('update-config-cancel');
    var errEl    = document.getElementById('update-config-error');
    if (patInput && saveBtn) {
      patInput.addEventListener('input', function () {
        var v = patInput.value;
        saveBtn.disabled = !(v && v.trim().length > 0 && !/\s/.test(v.trim()));
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        if (!patInput || !window.kiosk || !window.kiosk.submitUpdatePat) return;
        var v = patInput.value.trim();
        if (!v) {
          if (errEl) { errEl.textContent = 'Bitte PAT eingeben'; errEl.style.display = 'block'; }
          return;
        }
        saveBtn.disabled = true;
        try {
          var r = await window.kiosk.submitUpdatePat(v);
          if (r && r.ok) {
            patInput.value = '';
            if (errEl) errEl.style.display = 'none';
            // Main sends hide-update-config + show-admin-menu
          } else {
            if (errEl) {
              errEl.textContent = 'PAT ung\u00FCltig \u2014 Verbindungsfehler. Bitte pr\u00FCfen und erneut speichern.';
              errEl.style.display = 'block';
            }
            saveBtn.disabled = false;
          }
        } catch (e) {
          if (errEl) {
            errEl.textContent = 'PAT ung\u00FCltig \u2014 Verbindungsfehler. Bitte pr\u00FCfen und erneut speichern.';
            errEl.style.display = 'block';
          }
          saveBtn.disabled = false;
        }
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async function () {
        // Return to admin menu without state change
        hideUpdateConfig();
        if (window.kiosk && window.kiosk.getAdminDiagnostics) {
          try {
            var d = await window.kiosk.getAdminDiagnostics();
            if (d) showAdminMenu(d);
          } catch (e) { /* ignore */ }
        }
      });
    }
  }

  // =================================================================
  // Wiring
  // =================================================================
  function wireStatic() {
    wireAdminButtons();
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

    // Phase 6 D-02 — welcome layer tap handler (full-viewport tap target).
    var welcomeEl = document.getElementById('welcome-screen');
    if (welcomeEl) {
      welcomeEl.addEventListener('pointerdown', handleWelcomeTap);
      welcomeEl.addEventListener('touchstart',  handleWelcomeTap);
      // NFC-05 (D-02): badge keystrokes arriving while welcome is visible
      // are ignored — do NOT forward to notifyWelcomeTap. Keys alone never
      // dismiss welcome; only taps do. The Phase 4 badge-input arbiter
      // still consumes them at main level.
    }
  }

  // IPC subscriptions
  if (window.kiosk) {
    if (window.kiosk.onHideSplash)           window.kiosk.onHideSplash(hideSplash);
    if (window.kiosk.onShowSplash) {
      window.kiosk.onShowSplash(function () {
        showSplash();
        if (splashPendingMode) {
          var el = document.getElementById('splash');
          if (el) el.classList.add('auto-select-pending');
        }
      });
    }
    // Phase 07 SPLASH-01 — welcome-path-only final hide (gated by the auto-select
    // click chain's terminal sentinel, forwarded by main only while welcomeTapPending).
    if (window.kiosk.onHideSplashFinal) {
      window.kiosk.onHideSplashFinal(hideSplashFinal);
    }
    if (window.kiosk.onShowMagiclineError)   window.kiosk.onShowMagiclineError(showMagiclineError);
    if (window.kiosk.onHideMagiclineError)   window.kiosk.onHideMagiclineError(hideMagiclineError);
    if (window.kiosk.onShowCredentialsOverlay) window.kiosk.onShowCredentialsOverlay(showCredentialsOverlay);
    if (window.kiosk.onHideCredentialsOverlay) window.kiosk.onHideCredentialsOverlay(hideCredentialsOverlay);
    if (window.kiosk.onShowPinModal) {
      window.kiosk.onShowPinModal(function (payload) {
        pinModalContext = (payload && payload.context) || 'admin';
        hidePinLockout(); // reset lockout view in case reopened
        showPinModal();
      });
    }
    if (window.kiosk.onHidePinModal)         window.kiosk.onHidePinModal(hidePinModal);
    // Phase 4 — idle overlay IPC
    if (window.kiosk.onShowIdleOverlay)      window.kiosk.onShowIdleOverlay(showIdleOverlay);
    if (window.kiosk.onHideIdleOverlay)      window.kiosk.onHideIdleOverlay(hideIdleOverlayDom);
    // Phase 5 — admin menu / update config / updating cover / PIN lockout
    if (window.kiosk.onShowAdminMenu)        window.kiosk.onShowAdminMenu(showAdminMenu);
    if (window.kiosk.onHideAdminMenu)        window.kiosk.onHideAdminMenu(hideAdminMenu);
    if (window.kiosk.onShowUpdateConfig)     window.kiosk.onShowUpdateConfig(showUpdateConfig);
    if (window.kiosk.onHideUpdateConfig)     window.kiosk.onHideUpdateConfig(hideUpdateConfig);
    if (window.kiosk.onShowUpdatingCover)    window.kiosk.onShowUpdatingCover(showUpdatingCover);
    if (window.kiosk.onHideUpdatingCover)    window.kiosk.onHideUpdatingCover(hideUpdatingCover);
    if (window.kiosk.onShowAdminUpdateResult) window.kiosk.onShowAdminUpdateResult(showAdminUpdateResult);
    if (window.kiosk.onShowPinLockout)       window.kiosk.onShowPinLockout(showPinLockout);
    if (window.kiosk.onHidePinLockout)       window.kiosk.onHidePinLockout(hidePinLockout);
    // Phase 6 — Welcome screen
    if (window.kiosk.onShowWelcome) window.kiosk.onShowWelcome(showWelcome);
    if (window.kiosk.onHideWelcome) window.kiosk.onHideWelcome(hideWelcome);
    // Dev mode toggle feedback
    if (window.kiosk.onDevModeChanged) window.kiosk.onDevModeChanged(function (payload) {
      var active = payload && payload.active;
      var btn = document.getElementById('admin-btn-dev-mode');
      if (btn) btn.textContent = active ? 'Dev-Modus AUS' : 'Dev-Modus';
      // Make splash semi-transparent so login flow is visible behind it
      var splash = document.getElementById('splash');
      if (splash) splash.style.opacity = active ? '0.3' : '1';
      // Make credentials overlay semi-transparent too
      var creds = document.getElementById('credentials-overlay');
      if (creds) creds.style.opacity = active ? '0.5' : '1';
      // Make magicline-error overlay semi-transparent so Magicline is visible
      // behind it (e.g. to debug what Magicline is actually showing after login)
      var mlErr = document.getElementById('magicline-error');
      if (mlErr) mlErr.style.opacity = active ? '0.4' : '1';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireStatic);
  } else {
    wireStatic();
  }
})();
