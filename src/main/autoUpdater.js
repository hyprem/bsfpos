// src/main/autoUpdater.js
// Phase 5 ADMIN-06, ADMIN-07, ADMIN-08.
//
// Wraps electron-updater's NsisUpdater class directly (NOT the autoUpdater
// singleton) so we can inject the GitHub PAT at runtime via addAuthHeader
// without embedding it in the installer (RESEARCH Pitfall 1, #2314).
//
// All public entry points are dev-safe: calls are no-ops when
// app.isPackaged === false (Gotcha 2).
//
// Download gating: autoDownload=false + autoInstallOnAppQuit=false.
// Install only via installUpdate() called from updateGate.js safe-window
// trigger.

const { NsisUpdater } = require('electron-updater');
const log = require('./logger');

let updater = null;
let enabled = false;
let lastCheckAt = null;

/**
 * Construct the updater with a decrypted PAT. Idempotent: calling twice
 * replaces the prior instance (detaches listeners on the old one).
 *
 * @param {object} opts
 * @param {string} opts.owner - GitHub owner/org (from env or hard-coded)
 * @param {string} opts.repo  - GitHub repo name
 * @param {string} opts.pat   - Fine-grained PAT (contents:read)
 * @param {object} opts.store - electron-store for pendingUpdate persistence
 * @param {boolean} opts.isPackaged - typically require('electron').app.isPackaged
 * @param {(info) => void} opts.onUpdateDownloaded - main.js arms updateGate here
 * @param {(err) => void}  opts.onUpdateFailed - main.js shows update-failed variant
 * @returns {boolean} true if updater was constructed, false in dev / missing args
 */
function initUpdater(opts) {
  if (!opts) return false;
  if (!opts.isPackaged) {
    log.info('autoUpdater.skipped: dev mode (app.isPackaged=false)');
    enabled = false;
    return false;
  }
  if (!opts.pat || typeof opts.pat !== 'string' || opts.pat.length === 0) {
    log.info('autoUpdater.skipped: no PAT configured');
    enabled = false;
    return false;
  }
  if (!opts.owner || !opts.repo) {
    log.warn('autoUpdater.skipped: owner/repo missing');
    enabled = false;
    return false;
  }

  // Tear down any prior instance
  if (updater) {
    try { updater.removeAllListeners(); } catch (_) {}
    updater = null;
  }

  updater = new NsisUpdater({
    provider: 'github',
    owner: opts.owner,
    repo: opts.repo,
    private: true,
  });

  // CRITICAL: gate all installs behind safe-window manually
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.logger = log;
  updater.addAuthHeader('Bearer ' + opts.pat);

  updater.on('checking-for-update', () => {
    lastCheckAt = new Date().toISOString();
    log.audit('update.check', { result: 'started' });
  });

  updater.on('update-available', (info) => {
    log.audit('update.check', { result: 'available', version: (info && info.version) || 'unknown' });
    // Kick off download explicitly since autoDownload=false
    updater.downloadUpdate().catch((err) => {
      log.audit('update.failed', { reason: String(err && err.message), phase: 'download' });
      if (typeof opts.onUpdateFailed === 'function') opts.onUpdateFailed(err);
    });
  });

  updater.on('update-not-available', () => {
    log.audit('update.check', { result: 'none' });
  });

  updater.on('update-downloaded', (info) => {
    const version = (info && info.version) || 'unknown';
    log.audit('update.downloaded', { version: version });
    // D-29: persist pendingUpdate BEFORE handing control to updateGate
    try {
      opts.store.set('pendingUpdate', {
        pendingVersion: version,
        installedAt: new Date().toISOString(),
      });
    } catch (e) {
      log.error('autoUpdater.pendingUpdate-persist-failed: ' + (e && e.message));
    }
    if (typeof opts.onUpdateDownloaded === 'function') {
      opts.onUpdateDownloaded(info);
    }
  });

  updater.on('error', (err) => {
    log.audit('update.failed', { reason: String(err && err.message), phase: 'runtime' });
    if (typeof opts.onUpdateFailed === 'function') opts.onUpdateFailed(err);
  });

  enabled = true;
  log.info('autoUpdater.initialized: owner=' + opts.owner + ' repo=' + opts.repo);
  return true;
}

function isEnabled() {
  return enabled;
}

function getLastCheckAt() {
  return lastCheckAt;
}

/**
 * Trigger a check. Returns a promise that RESOLVES (not rejects) even on
 * failure — errors are logged and swallowed. Result can be:
 *   'available' | 'none' | 'error' | 'disabled'
 */
async function checkForUpdates() {
  if (!enabled || !updater) return { result: 'disabled' };
  try {
    const res = await updater.checkForUpdates();
    // electron-updater returns { updateInfo, cancellationToken, versionInfo }
    // The update-available / update-not-available events do the real work.
    // This return is for the admin menu "Updates prüfen" synchronous feedback.
    if (res && res.updateInfo && res.updateInfo.version) {
      return { result: 'available', version: res.updateInfo.version };
    }
    return { result: 'none' };
  } catch (err) {
    log.audit('update.failed', { reason: String(err && err.message), phase: 'check' });
    return { result: 'error', error: String(err && err.message) };
  }
}

/**
 * Called by updateGate.js when the safe window is open.
 * Invokes updater.quitAndInstall(isSilent=true, isForceRunAfter=true).
 */
function installUpdate() {
  if (!enabled || !updater) {
    log.warn('autoUpdater.installUpdate: called while disabled — no-op');
    return;
  }
  log.audit('update.install', { phase: 'quitAndInstall' });
  try {
    updater.quitAndInstall(true, true);
  } catch (err) {
    log.audit('update.failed', { reason: String(err && err.message), phase: 'quitAndInstall' });
  }
}

function _resetForTests() {
  if (updater) {
    try { updater.removeAllListeners(); } catch (_) {}
  }
  updater = null;
  enabled = false;
  lastCheckAt = null;
}

module.exports = {
  initUpdater,
  checkForUpdates,
  installUpdate,
  isEnabled,
  getLastCheckAt,
  _resetForTests,
};
