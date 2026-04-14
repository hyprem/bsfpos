// test/phase4-integration.test.js
// -----------------------------------------------------------------------------
// Phase 4 integration tests — cross-module wiring proof.
//
// These tests do NOT duplicate unit-level assertions (those live in the
// individual Phase 4 suites: idleTimer, sessionReset, authFlow).
// NFC descope (2026-04-14, quick 260414-eu9): badgeInput module + suite deleted.
// They exercise the CONTRACTS between modules that Plan 04-03 introduced:
//   - authFlow reducer emits start-idle-timer side-effect on CASH_REGISTER_READY
//   - magiclineView KNOWN_EVENT_TYPES whitelist contains Phase 4 entries
//   - idleTimer.expired() delegates to sessionReset.hardReset({reason:'idle-expired'})
//   - unified rolling window across idle+crash reasons (D-18)
//   - render-process-gone listener honors details.reason === 'clean-exit' (pin #6)
//   - preload.js Phase 4 IPC surface (5 entries)
//   - inject.js Phase 4 listeners live BELOW the idempotency anchor (pin #4)
//   - JETZT_VERKAUFEN_TEXT is the authoritative single-source literal (D-21)
// -----------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
function readSrc(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

// -----------------------------------------------------------------------------
// 1–2. authFlow reducer start-idle-timer side-effect on both CASH_REGISTER_READY branches
// -----------------------------------------------------------------------------

const { reduce, STATES } = require('../src/main/authFlow');

function hasSideEffect(sideEffects, kind) {
  return sideEffects.some((sx) => sx.kind === kind);
}

test('integration: authFlow BOOTING -> cash-register-ready emits start-idle-timer side-effect', () => {
  const r = reduce(STATES.BOOTING, { type: 'cash-register-ready' }, { hasCreds: true });
  assert.strictEqual(r.next, STATES.CASH_REGISTER_READY);
  const starts = r.sideEffects.filter((sx) => sx.kind === 'start-idle-timer');
  assert.strictEqual(starts.length, 1, 'expected exactly one start-idle-timer side-effect');
});

test('integration: authFlow LOGIN_SUBMITTED -> cash-register-ready emits start-idle-timer side-effect', () => {
  const r = reduce(STATES.LOGIN_SUBMITTED, { type: 'cash-register-ready' }, { hasCreds: true });
  assert.strictEqual(r.next, STATES.CASH_REGISTER_READY);
  const starts = r.sideEffects.filter((sx) => sx.kind === 'start-idle-timer');
  assert.strictEqual(starts.length, 1, 'expected exactly one start-idle-timer side-effect');
});

// -----------------------------------------------------------------------------
// 3. magiclineView KNOWN_EVENT_TYPES Phase 4 entries (source-file contract check)
// -----------------------------------------------------------------------------

test('integration: magiclineView KNOWN_EVENT_TYPES contains Phase 4 entries', () => {
  const src = readSrc('src/main/magiclineView.js');
  // Capture the Set literal.
  const setMatch = src.match(/KNOWN_EVENT_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(setMatch, 'KNOWN_EVENT_TYPES Set literal must be present in magiclineView.js');
  const setBody = setMatch[1];
  assert.ok(setBody.indexOf("'product-search-focused'") !== -1, 'product-search-focused missing');
  assert.ok(setBody.indexOf("'product-search-blurred'")  !== -1, 'product-search-blurred missing');
  assert.ok(setBody.indexOf("'activity'")                !== -1, 'activity missing');
});

// -----------------------------------------------------------------------------
// 4. idleTimer.expired() delegates to sessionReset.hardReset({reason:'idle-expired'})
// -----------------------------------------------------------------------------

test('integration: idleTimer.expired() calls sessionReset.hardReset({reason:"idle-expired"})', () => {
  // Install a fake sessionReset in require.cache BEFORE idleTimer is first required.
  const sessionResetPath = require.resolve('../src/main/sessionReset');
  const origEntry = require.cache[sessionResetPath];
  let captured = null;
  require.cache[sessionResetPath] = {
    id: sessionResetPath,
    filename: sessionResetPath,
    loaded: true,
    exports: {
      hardReset: (args) => { captured = args; return Promise.resolve(); },
      init: () => {},
      _resetForTests: () => {},
      _getStateForTests: () => ({ resetting: false, loopActive: false, resetTimestamps: [] }),
    },
  };

  try {
    // Fresh require of idleTimer so its lazy require('./sessionReset') picks up our mock.
    const idleTimerPath = require.resolve('../src/main/idleTimer');
    delete require.cache[idleTimerPath];
    const idleTimer = require('../src/main/idleTimer');

    // Fake mainWindow is needed only so init() doesn't choke; expired() doesn't use it.
    idleTimer.init({ webContents: { send: () => {}, isDestroyed: () => false } });
    idleTimer.expired();

    assert.ok(captured, 'sessionReset.hardReset was never called');
    // Phase 6 D-05: idleTimer.expired() now forwards mode:'welcome' so the
    // sessionReset path selects the full-logout branch.
    assert.deepStrictEqual(captured, { reason: 'idle-expired', mode: 'welcome' });
  } finally {
    // Restore cache
    if (origEntry) {
      require.cache[sessionResetPath] = origEntry;
    } else {
      delete require.cache[sessionResetPath];
    }
    const idleTimerPath = require.resolve('../src/main/idleTimer');
    delete require.cache[idleTimerPath];
  }
});

// -----------------------------------------------------------------------------
// 5. Unified rolling window (D-18) — idle + crash + idle within 60s trips loop
// -----------------------------------------------------------------------------

test('integration: sessionReset unified rolling window (D-18) — idle+crash+idle trips loopActive', async () => {
  // Install mocks for sessionReset's dependencies in require.cache BEFORE first load.
  const electronMock = {
    session: {
      fromPartition: () => ({
        clearStorageData: async () => {},
        cookies: { flushStore: async () => {} },
      }),
    },
  };
  require.cache.electron = {
    id: 'electron', filename: 'electron', loaded: true, exports: electronMock,
  };
  try {
    const electronResolved = require.resolve('electron');
    require.cache[electronResolved] = require.cache.electron;
  } catch (_e) { /* fine */ }

  const loggerPath = require.resolve('../src/main/logger');
  const origLogger = require.cache[loggerPath];
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: { info: () => {}, warn: () => {}, error: () => {}, audit: () => {} },
  };

  const magiclineViewPath = require.resolve('../src/main/magiclineView');
  const origMagicline = require.cache[magiclineViewPath];
  require.cache[magiclineViewPath] = {
    id: magiclineViewPath, filename: magiclineViewPath, loaded: true,
    exports: {
      destroyMagiclineView: () => {},
      createMagiclineView: () => {},
    },
  };

  // Virtual idleTimer shim so sessionReset's lazy require('./idleTimer').stop() works.
  const Module = require('module');
  const VIRTUAL = path.join(path.dirname(magiclineViewPath), '__virt_idleTimer_p4int.js');
  require.cache[VIRTUAL] = {
    id: VIRTUAL, filename: VIRTUAL, loaded: true,
    exports: { stop: () => {} },
  };
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === './idleTimer' && parent && parent.filename &&
        parent.filename.endsWith('sessionReset.js')) {
      return VIRTUAL;
    }
    return origResolve.call(this, request, parent, ...rest);
  };

  try {
    const sessionResetPath = require.resolve('../src/main/sessionReset');
    delete require.cache[sessionResetPath];
    const sessionReset = require('../src/main/sessionReset');

    const mw = { webContents: { send: () => {} } };
    sessionReset.init({ mainWindow: mw, store: {} });

    await sessionReset.hardReset({ reason: 'idle-expired' });
    await sessionReset.hardReset({ reason: 'crash' });
    await sessionReset.hardReset({ reason: 'idle-expired' }); // D-18: unified -> trip

    const st = sessionReset._getStateForTests();
    assert.strictEqual(st.loopActive, true, 'unified D-18 counter must trip on mixed reasons');
    const reasons = st.resetTimestamps.map((x) => x.reason);
    assert.deepStrictEqual(
      reasons,
      ['idle-expired', 'crash', 'idle-expired'],
      'resetTimestamps must record all three reasons'
    );
  } finally {
    Module._resolveFilename = origResolve;
    delete require.cache[VIRTUAL];
    if (origMagicline) { require.cache[magiclineViewPath] = origMagicline; }
    else { delete require.cache[magiclineViewPath]; }
    if (origLogger) { require.cache[loggerPath] = origLogger; }
    else { delete require.cache[loggerPath]; }
    const sessionResetPath = require.resolve('../src/main/sessionReset');
    delete require.cache[sessionResetPath];
  }
});

// -----------------------------------------------------------------------------
// 6. render-process-gone clean-exit guard (pin #6)
// -----------------------------------------------------------------------------

test('integration: magiclineView render-process-gone skips recovery on details.reason === "clean-exit"', () => {
  const src = readSrc('src/main/magiclineView.js');
  // Must contain the literal guard AND an early return directly following it.
  const guardRegex = /details\.reason\s*===\s*'clean-exit'\s*\)\s*return/;
  assert.ok(guardRegex.test(src), 'magiclineView.js must contain clean-exit guard with early return');
});

// -----------------------------------------------------------------------------
// 7. preload.js Phase 4 IPC surface (5 entries)
// -----------------------------------------------------------------------------

test('integration: preload.js exposes the 5 Phase 4 IPC entries on window.kiosk', () => {
  const src = readSrc('src/main/preload.js');
  assert.ok(src.indexOf('onShowIdleOverlay')        !== -1, 'onShowIdleOverlay missing');
  assert.ok(src.indexOf('onHideIdleOverlay')        !== -1, 'onHideIdleOverlay missing');
  assert.ok(src.indexOf('notifyIdleDismissed')      !== -1, 'notifyIdleDismissed missing');
  assert.ok(src.indexOf('notifyIdleExpired')        !== -1, 'notifyIdleExpired missing');
  assert.ok(src.indexOf('requestResetLoopRecovery') !== -1, 'requestResetLoopRecovery missing');
  // IPC channel string literals
  assert.ok(src.indexOf("'show-idle-overlay'")        !== -1, "'show-idle-overlay' channel missing");
  assert.ok(src.indexOf("'hide-idle-overlay'")        !== -1, "'hide-idle-overlay' channel missing");
  assert.ok(src.indexOf("'idle-dismissed'")           !== -1, "'idle-dismissed' channel missing");
  assert.ok(src.indexOf("'idle-expired'")             !== -1, "'idle-expired' channel missing");
  assert.ok(src.indexOf("'request-reset-loop-recovery'") !== -1, "'request-reset-loop-recovery' channel missing");
});

// -----------------------------------------------------------------------------
// 8. inject.js Phase 4 listeners live BELOW the idempotency anchor (pin #4)
// -----------------------------------------------------------------------------

test('integration: inject.js Phase 4 listeners are AFTER the window.__bskiosk_injected__ anchor', () => {
  const src = readSrc('src/inject/inject.js');
  const lines = src.split(/\r?\n/);

  function findLine(needle) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(needle) !== -1) return i + 1; // 1-based
    }
    return -1;
  }

  const anchor = findLine('window.__bskiosk_injected__ = true');
  assert.ok(anchor > 0, 'idempotency anchor window.__bskiosk_injected__ = true must exist');

  const focusin   = findLine("'focusin'");
  const focusout  = findLine("'focusout'");
  const pointerdn = findLine("'pointerdown'");
  const touchst   = findLine("'touchstart'");

  assert.ok(focusin   > anchor, "'focusin' listener must be after the anchor (got " + focusin + " vs " + anchor + ")");
  assert.ok(focusout  > anchor, "'focusout' listener must be after the anchor");
  assert.ok(pointerdn > anchor, "'pointerdown' listener must be after the anchor");
  assert.ok(touchst   > anchor, "'touchstart' listener must be after the anchor");

  // The post-sale click listener references JETZT_VERKAUFEN_TEXT in inject.js; verify it is also below.
  const jetztRef = findLine('JETZT_VERKAUFEN_TEXT');
  assert.ok(jetztRef > anchor, 'JETZT_VERKAUFEN_TEXT use must be after the anchor');
});

// -----------------------------------------------------------------------------
// 9. JETZT_VERKAUFEN_TEXT authoritative declaration (D-21 single source)
// -----------------------------------------------------------------------------

test('integration: JETZT_VERKAUFEN_TEXT is declared exactly once as the authoritative literal', () => {
  const fragile = readSrc('src/inject/fragile-selectors.js');
  const inject  = readSrc('src/inject/inject.js');

  // The DECLARATION with the string literal must exist in fragile-selectors.js exactly once.
  const declMatches = fragile.match(/var\s+JETZT_VERKAUFEN_TEXT\s*=\s*'Jetzt verkaufen'/g) || [];
  assert.strictEqual(declMatches.length, 1, 'expected exactly 1 JETZT_VERKAUFEN_TEXT declaration in fragile-selectors.js');

  // inject.js must REFERENCE the symbol but must NOT re-declare the literal in code
  // (a literal 'Jetzt verkaufen' in a comment is allowed — we only forbid a code-level assignment).
  assert.ok(inject.indexOf('JETZT_VERKAUFEN_TEXT') !== -1, 'inject.js must reference JETZT_VERKAUFEN_TEXT');
  const injectDecl = inject.match(/var\s+JETZT_VERKAUFEN_TEXT\s*=\s*'Jetzt verkaufen'/g) || [];
  assert.strictEqual(injectDecl.length, 0, 'inject.js must NOT re-declare JETZT_VERKAUFEN_TEXT');

  // Explicit mention of "Jetzt verkaufen" in fragile-selectors.js is the single source.
  // Allow the inject.js occurrence only as a comment reference (D-21 blast radius: 1 file).
  const fragileLit = (fragile.match(/'Jetzt verkaufen'/g) || []).length;
  assert.strictEqual(fragileLit, 1, 'fragile-selectors.js must contain the literal exactly once');
});
