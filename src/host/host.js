// src/host/host.js — renderer glue.
// Consumes window.kiosk exposed by preload.js. Phase 1 only handles splash
// visibility toggles; Phase 4/5 add idle/admin overlay handlers here.

(function () {
  'use strict';

  if (window.kiosk && window.kiosk.isDev) {
    document.body.setAttribute('data-dev', 'true');
  }

  function hideSplash() {
    const el = document.getElementById('splash');
    if (el) el.style.display = 'none';
  }

  function showSplash() {
    const el = document.getElementById('splash');
    if (el) el.style.display = 'flex';
  }

  function showMagiclineError(payload) {
    const el = document.getElementById('magicline-error');
    if (!el) return;
    if (payload && typeof payload.message === 'string' && payload.message.length > 0) {
      const sub = el.querySelector('.bsk-error-subtext');
      if (sub) sub.textContent = payload.message;
    }
    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
  }

  function hideMagiclineError() {
    const el = document.getElementById('magicline-error');
    if (!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }

  if (window.kiosk && window.kiosk.onHideSplash) {
    window.kiosk.onHideSplash(hideSplash);
  }
  if (window.kiosk && window.kiosk.onShowSplash) {
    window.kiosk.onShowSplash(showSplash);
  }
  if (window.kiosk && window.kiosk.onShowMagiclineError) {
    window.kiosk.onShowMagiclineError(showMagiclineError);
  }
  if (window.kiosk && window.kiosk.onHideMagiclineError) {
    window.kiosk.onHideMagiclineError(hideMagiclineError);
  }
})();
