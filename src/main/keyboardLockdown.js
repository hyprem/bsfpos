// src/main/keyboardLockdown.js
// Phase 1 keyboard lockdown per D-09 (broad-sweep suppression) and D-10
// (reservedShortcuts hook for Phase 5 admin hotkey).
//
// Exports:
//   attachLockdown(webContents)  — attaches before-input-event suppression.
//                                  Phase 2 reuses this for the Magicline
//                                  BrowserView's webContents — the same
//                                  handler must be attached to EVERY webContents
//                                  that holds focus, because before-input-event
//                                  only fires on the focused webContents.
//   reservedShortcuts            — Set<string> of canonical accelerator strings
//                                  that should pass through. Empty in Phase 1;
//                                  Phase 5 adds 'Ctrl+Shift+F12' here.
//   SUPPRESS_LIST                — exported for inspection / testing.
//
// Dev mode: attachLockdown is a no-op when NODE_ENV === 'development' (D-07).

const log = require('./logger');

const isDev = process.env.NODE_ENV === 'development';

// D-10: Phase 5 will add 'Ctrl+Shift+F12'. Phase 1 ships this empty.
const reservedShortcuts = new Set();

// D-09: broad-sweep blocklist.
// SHELL-04 required: Alt+F4, Alt+Tab, Meta (Win), F11, Escape, Ctrl+W.
// Defensive extras: reload/DevTools/print/view-source/open/new-tab.
//
// Case note: input.key for letter keys is lowercase when Shift is not held.
// Include BOTH cases defensively for Ctrl+letter combos.
const SUPPRESS_LIST = new Set([
  // SHELL-04 required combos
  'Alt+F4',
  'Alt+Tab',
  'F11',
  'Escape',
  'Ctrl+w', 'Ctrl+W',
  // D-09 defensive extras
  'Ctrl+r', 'Ctrl+R',
  'Ctrl+Shift+R',
  'F5',
  'Ctrl+Shift+I',
  'F12',
  'Ctrl+Shift+J',
  'Ctrl+p', 'Ctrl+P',
  'Ctrl+u', 'Ctrl+U',
  'Ctrl+o', 'Ctrl+O',
  'Ctrl+n', 'Ctrl+N',
  'Ctrl+t', 'Ctrl+T',
]);

function canonical(input) {
  const parts = [];
  if (input.control) parts.push('Ctrl');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');
  if (input.meta) parts.push('Meta');
  parts.push(input.key);
  return parts.join('+');
}

function attachLockdown(webContents) {
  if (isDev) {
    log.info('keyboardLockdown: dev mode — suppression disabled');
    return;
  }
  if (!webContents || webContents.isDestroyed && webContents.isDestroyed()) {
    log.warn('keyboardLockdown: refusing to attach to destroyed webContents');
    return;
  }
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const accel = canonical(input);

    // D-10: reserved shortcuts pass through to downstream handlers.
    if (reservedShortcuts.has(accel)) return;

    // Bare Meta (Win) key press — suppress regardless of SUPPRESS_LIST entry form.
    if (input.key === 'Meta') {
      event.preventDefault();
      return;
    }

    if (SUPPRESS_LIST.has(accel)) {
      event.preventDefault();
    }
  });
  log.info('keyboardLockdown: attached to webContents id=' + webContents.id);
}

module.exports = { attachLockdown, reservedShortcuts, SUPPRESS_LIST, canonical };
