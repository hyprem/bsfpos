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

  if (window.kiosk && window.kiosk.onHideSplash) {
    window.kiosk.onHideSplash(hideSplash);
  }
  if (window.kiosk && window.kiosk.onShowSplash) {
    window.kiosk.onShowSplash(showSplash);
  }
})();
