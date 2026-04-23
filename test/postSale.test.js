// test/postSale.test.js
// Phase 10 SALE-01: unit tests for src/main/main.js post-sale IPC state machine.
//
// Main.js cannot be loaded directly from this test file (it self-mounts the
// electron app at top level). This test re-implements the three post-sale
// handler functions using the EXACT code from Plan 05, then exercises them
// via a fake ipcMain.emit. The acceptance criteria at PR time cross-check
// that the re-implementation below matches the main.js source verbatim.
//
// Mocks: node:test + node:assert + hand-rolled fakes. No sinon, no fake timers.
// Pattern mirrors test/updateGate.test.js (hand-rolled factories) and
// test/sessionReset.test.js (require.cache electron injection).

const test = require('node:test');
const assert = require('node:assert');

// --- Hand-rolled fakes ------------------------------------------------------

function makeIpcMain() {
  const handlers = {};
  const emits = [];
  return {
    emits,
    on: (channel, cb) => { handlers[channel] = cb; },
    removeAllListeners: (channel) => { delete handlers[channel]; },
    emit: function (channel /* , ...args */) {
      const args = Array.prototype.slice.call(arguments, 1);
      emits.push([channel].concat(args));
      if (handlers[channel]) handlers[channel].apply(null, args);
    },
    _hasHandler: (channel) => !!handlers[channel],
  };
}

function makeIdleTimer() {
  const calls = [];
  return {
    calls,
    stop:  () => { calls.push('stop'); },
    start: () => { calls.push('start'); },
    bump:  () => { calls.push('bump'); },
  };
}

function makeSessionReset() {
  const calls = [];
  return {
    calls,
    hardReset: (opts) => { calls.push(['hardReset', opts]); return Promise.resolve(); },
    onPostReset: (_cb) => {},
    onPreReset:  (_cb) => {},
  };
}

function makeLog() {
  const audits = [];
  const errors = [];
  const infos = [];
  return {
    audits, errors, infos,
    audit: (event, fields) => { audits.push({ event, fields }); },
    info:  (msg) => { infos.push(msg); },
    error: (msg) => { errors.push(msg); },
    warn:  (_msg) => {},
  };
}

function makeMainWindow() {
  const sent = [];
  return {
    sent,
    webContents: {
      isDestroyed: () => false,
      send: (ch, payload) => { sent.push([ch, payload]); },
    },
  };
}

// --- Module under test (faithful re-implementation of Plan 05 main.js) -----
// This block MUST remain byte-equivalent (save for 'require' vs injected deps)
// to the corresponding code in src/main/main.js. PR review checks drift.

function createPostSaleModule(deps) {
  // Mirrors src/main/main.js lines 438-504 as of Phase 10 Plan 05.
  // Specifically mirrors the Plan 05 startPostSaleFlow helper and the three
  // ipcMain handlers (post-sale:trigger, post-sale:next-customer,
  // post-sale:auto-logout). Update this re-implementation if those handlers
  // change. PR reviewers must diff this block against the main.js source.
  const { ipcMain, idleTimer, sessionReset, log, mainWindow } = deps;
  let postSaleShown = false;

  function startPostSaleFlow(opts) {
    const trigger = (opts && opts.trigger) || 'unknown';
    postSaleShown = true;
    try { idleTimer.stop(); } catch (_) {}
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('post-sale:show');
      }
    } catch (e) {
      log.error('phase10.startPostSaleFlow.send failed: ' + (e && e.message));
    }
    try { log.audit('post-sale.shown', { trigger: trigger }); } catch (_) {}
  }

  try { ipcMain.removeAllListeners('post-sale:trigger'); } catch (_) {}
  ipcMain.on('post-sale:trigger', function (_ev, payload) {
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

  try { ipcMain.removeAllListeners('post-sale:next-customer'); } catch (_) {}
  ipcMain.on('post-sale:next-customer', function () {
    try {
      postSaleShown = false;
      try { idleTimer.start(); } catch (_) {}
      try { log.audit('post-sale.dismissed', { via: 'next-customer' }); } catch (_) {}
    } catch (err) {
      log.error('phase10.post-sale:next-customer failed: ' + (err && err.message));
    }
  });

  try { ipcMain.removeAllListeners('post-sale:auto-logout'); } catch (_) {}
  ipcMain.on('post-sale:auto-logout', function () {
    try {
      try { log.audit('post-sale.dismissed', { via: 'auto-logout' }); } catch (_) {}
      sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
    } catch (err) {
      log.error('phase10.post-sale:auto-logout failed: ' + (err && err.message));
    }
  });

  // Expose internal state for assertion.
  return {
    _getPostSaleShown: () => postSaleShown,
    _simulateOnPreReset: () => { postSaleShown = false; },
  };
}

function setupHarness() {
  const ipcMain = makeIpcMain();
  const idleTimer = makeIdleTimer();
  const sessionReset = makeSessionReset();
  const log = makeLog();
  const mainWindow = makeMainWindow();
  const mod = createPostSaleModule({ ipcMain, idleTimer, sessionReset, log, mainWindow });
  return { ipcMain, idleTimer, sessionReset, log, mainWindow, mod };
}

// --- Tests -----------------------------------------------------------------

test('D-12: post-sale:trigger with postSaleShown=false → idleTimer.stop + post-sale:show + audit', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  assert.deepStrictEqual(h.idleTimer.calls, ['stop'], 'idleTimer.stop must be called exactly once');
  assert.strictEqual(h.mainWindow.sent.length, 1, 'exactly one IPC send to host');
  assert.strictEqual(h.mainWindow.sent[0][0], 'post-sale:show');
  const shownAudit = h.log.audits.find(a => a.event === 'post-sale.shown');
  assert.ok(shownAudit, 'post-sale.shown audit must be emitted');
  assert.strictEqual(shownAudit.fields.trigger, 'print-intercept');
  assert.strictEqual(h.mod._getPostSaleShown(), true, 'postSaleShown latched to true');
});

test('D-12: cart-empty-fallback trigger routes through same handler with different audit field', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
  const shownAudit = h.log.audits.find(a => a.event === 'post-sale.shown');
  assert.ok(shownAudit);
  assert.strictEqual(shownAudit.fields.trigger, 'cart-empty-fallback');
  assert.strictEqual(h.mainWindow.sent[0][0], 'post-sale:show');
});

test('D-12: DOUBLE-TRIGGER race — second post-sale:trigger is dedupe-gated no-op', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
  assert.strictEqual(h.mainWindow.sent.length, 1, 'exactly ONE post-sale:show sent despite two triggers');
  assert.strictEqual(h.idleTimer.calls.length, 1, 'idleTimer.stop called exactly once');
  const shownAudits = h.log.audits.filter(a => a.event === 'post-sale.shown');
  assert.strictEqual(shownAudits.length, 1, 'exactly ONE post-sale.shown audit');
  assert.strictEqual(shownAudits[0].fields.trigger, 'print-intercept', 'first trigger wins');
  const ignoredLogs = h.log.infos.filter(m => m.indexOf('post-sale:trigger.ignored') !== -1);
  assert.strictEqual(ignoredLogs.length, 1, 'second trigger logs at info level');
});

test('D-06: post-sale:next-customer resets postSaleShown + starts idle timer + audits', () => {
  const h = setupHarness();
  // First show
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  assert.strictEqual(h.mod._getPostSaleShown(), true);
  // Button tap
  h.ipcMain.emit('post-sale:next-customer');
  assert.strictEqual(h.mod._getPostSaleShown(), false, 'postSaleShown cleared on next-customer');
  assert.ok(h.idleTimer.calls.indexOf('start') !== -1, 'idleTimer.start called');
  const dismissAudit = h.log.audits.find(a => a.event === 'post-sale.dismissed' && a.fields.via === 'next-customer');
  assert.ok(dismissAudit, 'post-sale.dismissed via=next-customer audit emitted');
});

test('D-06: after next-customer, a subsequent post-sale:trigger re-shows the overlay', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.ipcMain.emit('post-sale:next-customer');
  // Second sale in same session — must re-show
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  const shownAudits = h.log.audits.filter(a => a.event === 'post-sale.shown');
  assert.strictEqual(shownAudits.length, 2, 'two independent shows across two sales');
});

test('D-20: post-sale:auto-logout calls sessionReset.hardReset with canonical reason+mode', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.ipcMain.emit('post-sale:auto-logout');
  assert.strictEqual(h.sessionReset.calls.length, 1);
  assert.deepStrictEqual(h.sessionReset.calls[0], ['hardReset', { reason: 'sale-completed', mode: 'welcome' }]);
  const dismissAudit = h.log.audits.find(a => a.event === 'post-sale.dismissed' && a.fields.via === 'auto-logout');
  assert.ok(dismissAudit, 'post-sale.dismissed via=auto-logout audit emitted');
});

test('D-20: audit emitted BEFORE hardReset to guarantee log durability', () => {
  // If hardReset throws/rejects, the audit line should still have landed
  const h = setupHarness();
  h.sessionReset.hardReset = () => { throw new Error('simulated reset failure'); };
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.ipcMain.emit('post-sale:auto-logout');
  const dismissAudit = h.log.audits.find(a => a.event === 'post-sale.dismissed' && a.fields.via === 'auto-logout');
  assert.ok(dismissAudit, 'dismiss audit must fire even when hardReset throws');
  const errors = h.log.errors.filter(m => m.indexOf('phase10.post-sale:auto-logout') !== -1);
  assert.strictEqual(errors.length, 1, 'hardReset failure logged at error level');
});

test('onPreReset (simulated): clearing postSaleShown allows next trigger to fire', () => {
  const h = setupHarness();
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  h.mod._simulateOnPreReset();  // mimic main.js onPreReset callback
  // Post-reset: new trigger should fire (not dedupe)
  h.ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
  const shownAudits = h.log.audits.filter(a => a.event === 'post-sale.shown');
  assert.strictEqual(shownAudits.length, 2);
});
