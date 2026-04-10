// test/phase5-acceptance.test.js
// Phase 5 Plan 06 Task 3 — requirement -> artifact trace.
//
// Every ADMIN-* and BRAND-* Phase 5 requirement must be grep-anchored to at
// least one code artifact. Fails loudly if a future refactor removes the
// marker. This is the last gate before Phase 5 close.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const mainJs            = read('src/main/main.js');
const keyboardLockdown  = read('src/main/keyboardLockdown.js');
const autoUpdater       = read('src/main/autoUpdater.js');
const updateGate        = read('src/main/updateGate.js');
const adminPinLockout   = read('src/main/adminPinLockout.js');
const logger            = read('src/main/logger.js');
const sessionReset      = read('src/main/sessionReset.js');
const authFlow          = read('src/main/authFlow.js');
const badgeInput        = read('src/main/badgeInput.js');
const hostHtml          = read('src/host/host.html');
const hostCss           = read('src/host/host.css');
const hostJs            = read('src/host/host.js');

test('ADMIN-01: Ctrl+Shift+F12 -> PIN prompt (reservedShortcuts + globalShortcut + before-input-event)', () => {
  assert.match(keyboardLockdown, /reservedShortcuts\.add\('Ctrl\+Shift\+F12'\)/);
  assert.match(mainJs, /globalShortcut\.register\('Ctrl\+Shift\+F12'/);
  assert.match(mainJs, /openAdminPinModal/);
  const hits = mainJs.match(/Ctrl\+Shift\+F12/g) || [];
  assert.ok(hits.length >= 3, 'expected Ctrl+Shift+F12 referenced in main.js at least 3 times, got ' + hits.length);
});

test('ADMIN-02: Admin menu with 6 actions', () => {
  const actions = ['check-updates', 'view-logs', 'reload', 're-enter-credentials', 'configure-auto-update', 'exit-to-windows'];
  for (const a of actions) {
    assert.ok(mainJs.includes("'" + a + "'"), 'missing admin action handler: ' + a);
  }
  assert.match(hostHtml, /id="admin-menu"/);
  assert.match(hostHtml, /id="admin-btn-check-updates"/);
  assert.match(hostHtml, /id="admin-btn-exit"/);
  assert.match(hostJs, /adminMenuAction/);
});

test('ADMIN-03: PIN hashed + 5-wrong-in-60s -> 5-min lockout', () => {
  assert.match(adminPinLockout, /MAX_ATTEMPTS\s*=\s*5/);
  assert.match(adminPinLockout, /WINDOW_MS\s*=\s*60_?000/);
  assert.match(adminPinLockout, /LOCKOUT_MS\s*=\s*5\s*\*\s*60_?000/);
  assert.match(mainJs, /ipcMain\.handle\('verify-admin-pin'/);
  assert.match(hostHtml, /id="pin-lockout-panel"/);
  assert.match(hostJs, /showPinLockout/);
});

test('ADMIN-04: Structured rotating logs + taxonomy events', () => {
  assert.match(logger, /log\.audit = function/);
  assert.match(logger, /archiveLogFn/);
  // Canonical taxonomy sampling — all 5 must appear somewhere under src/main/.
  const events = ["'startup'", "'startup.complete'", "'auth.state'", "'idle.reset'", "'sale.completed'", "'badge.scanned'"];
  const bundle = mainJs + sessionReset + authFlow + badgeInput;
  for (const e of events) {
    assert.ok(bundle.includes(e), 'missing log.audit event: ' + e);
  }
});

test('ADMIN-05: 5-file rotation + redactor (no raw secrets in log.info/warn/error)', () => {
  assert.match(logger, /MAX_ARCHIVES\s*=\s*5/);
  assert.match(logger, /BADGE_FIELDS/);
  assert.match(logger, /SECRET_FIELDS/);
  assert.match(logger, /CIPHER_FIELDS/);
  // No log.info/warn/error calls with raw pat / password field names across
  // the main-process modules touched by Plan 06.
  const files = [
    'src/main/authFlow.js',
    'src/main/badgeInput.js',
    'src/main/credentialsStore.js',
    'src/main/main.js',
    'src/main/autoUpdater.js',
  ];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(
      src,
      /log\.(info|warn|error)\([^)]*\bpat\s*:/i,
      f + ' leaks pat field in log.info/warn/error'
    );
    assert.doesNotMatch(
      src,
      /log\.(info|warn|error)\([^)]*\bpassword\s*:/i,
      f + ' leaks password field in log.info/warn/error'
    );
  }
});

test('ADMIN-06: electron-updater with addAuthHeader + NsisUpdater (no embedded PAT)', () => {
  assert.match(autoUpdater, /NsisUpdater/);
  assert.match(autoUpdater, /addAuthHeader/);
  assert.match(autoUpdater, /autoDownload\s*=\s*false/);
  assert.match(autoUpdater, /autoInstallOnAppQuit\s*=\s*false/);
  assert.match(mainJs, /ipcMain\.handle\('submit-update-pat'/);
  assert.match(mainJs, /safeStorage\.encryptString/);
  // package.json must not contain a publish.token
  const pkg = read('package.json');
  assert.doesNotMatch(pkg, /"token"\s*:/);
});

test('ADMIN-07: safe-window install gate (post-reset OR 03:00-05:00)', () => {
  assert.match(updateGate, /MAINTENANCE_HOUR_START\s*=\s*3/);
  assert.match(updateGate, /MAINTENANCE_HOUR_END\s*=\s*5/);
  assert.match(updateGate, /'post-reset'/);
  assert.match(updateGate, /'maintenance-window'/);
  assert.match(sessionReset, /onPostReset/);
});

test('ADMIN-08: updating cover + bad-release/update-failed variants + health watchdog', () => {
  assert.match(hostHtml, /id="updating-cover"/);
  assert.match(hostJs, /'bad-release'/);
  assert.match(hostJs, /'update-failed'/);
  assert.match(mainJs, /pendingUpdate/);
  assert.match(mainJs, /HEALTH_WATCHDOG_MS/);
  assert.match(mainJs, /autoUpdateDisabled/);
});

test('BRAND-01: Logo + brand colors on all new Phase 5 surfaces', () => {
  // Each new surface must include the logo asset inside its scope.
  const newSurfacePatterns = [
    /id="admin-menu"[\s\S]*?assets\/logo-dark\.png/,
    /id="update-config"[\s\S]*?assets\/logo-dark\.png/,
    /id="updating-cover"[\s\S]*?assets\/logo-dark\.png/,
  ];
  for (const re of newSurfacePatterns) {
    assert.match(hostHtml, re);
  }
  // Brand accent #F5C518 referenced in host.css (Phase 5 block reuses it).
  assert.match(hostCss, /#F5C518/);
});

test('BRAND-02: CSS touch target floors declared', () => {
  assert.match(hostCss, /\.bsk-btn--admin-action[\s\S]*?min-height:\s*64px/);
  assert.match(hostCss, /\.bsk-btn\s*\{[\s\S]*?min-height:\s*(44|4[5-9]|[5-9]\d|\d{3,})px/);
});

test('BRAND-03: Magicline content area not themed', () => {
  const bad = [/\[class\^="css-"\]/, /\.MuiBox/, /\.MuiButton/, /\.MuiTypography/];
  for (const re of bad) {
    assert.doesNotMatch(hostCss, re);
  }
});
