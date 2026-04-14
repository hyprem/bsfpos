// src/main/logger.js
// Phase 1: electron-log v5 init, 1 MB rotation
// Phase 5: log.audit helper + redactor (ADMIN-04/05 D-25) + 5-file archiveLogFn (D-26)
//
// File transport writes to %AppData%/Bee Strong POS/logs/main.log.
// This module is the single logging entry point for the main process — all
// future phases import from here.

const log = require('electron-log/main');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Initialize main-process logging. electron-log v5 requires explicit init.
log.initialize();

// --- File transport -----------------------------------------------------
log.transports.file.level = 'info';
log.transports.file.maxSize = 1024 * 1024; // 1 MB (ADMIN-05)
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.file.fileName = 'main.log';

// --- Phase 5 D-26: 5-file rotation chain --------------------------------
// electron-log calls archiveLogFn synchronously when maxSize is exceeded.
// We walk main.log -> main.1.log -> main.2.log -> ... -> main.5.log and
// delete main.5.log on overflow (6 files total = 6 MB ceiling with maxSize).
const MAX_ARCHIVES = 5;

log.transports.file.archiveLogFn = function archiveLog(oldLogFile) {
  // Called synchronously by electron-log when maxSize exceeded.
  // oldLogFile.toString() is the full path to main.log.
  // MUST use only sync fs (Phase 5 RESEARCH Gotcha 4).
  try {
    const currentPath = oldLogFile.toString();
    const info = path.parse(currentPath);
    const archivePath = (n) => path.join(info.dir, info.name + '.' + n + info.ext);

    // Step 1: delete main.5.log if it exists (drops oldest).
    const oldest = archivePath(MAX_ARCHIVES);
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    // Steps 2..5: walk 4->5, 3->4, 2->3, 1->2.
    for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
      const src = archivePath(i);
      const dst = archivePath(i + 1);
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }

    // Step 6: rename main.log -> main.1.log.
    if (fs.existsSync(currentPath)) {
      fs.renameSync(currentPath, archivePath(1));
    }
  } catch (e) {
    // Never throw from archiveLogFn — electron-log swallows exceptions but a
    // best-effort path keeps the next write from crashing the main process.
    // The next write will still succeed into a fresh main.log.
  }
};

// --- Console transport --------------------------------------------------
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

// --- Phase 5 D-25: redactor ---------------------------------------------
// Field-name allowlists — the ONLY source of truth for which keys get
// rewritten. Non-allowlisted keys pass through via String(value).
const BADGE_FIELDS  = new Set(['badge', 'badgeId', 'member', 'memberId']);
const SECRET_FIELDS = new Set(['password', 'pass', 'pwd']);
const CIPHER_FIELDS = new Set(['cipher', 'ciphertext', 'token', 'pat']);

function redactValue(key, value) {
  if (BADGE_FIELDS.has(key)) {
    if (value == null) return '';
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
  }
  if (SECRET_FIELDS.has(key)) {
    return '***';
  }
  if (CIPHER_FIELDS.has(key)) {
    const len = typeof value === 'string'
      ? value.length
      : (value == null ? 0 : String(value).length);
    return '[cipher:' + len + ']';
  }
  return String(value);
}

// --- Phase 5 D-25: log.audit helper -------------------------------------
// Canonical taxonomy (D-28): startup, startup.complete,
//   startup.locale,          ← NEW (Phase 07 LOCALE-01)
//   auth.state, auth.submit,
//   auth.failure, idle.reset, badge.scanned, sale.completed, update.check,
//   update.downloaded, update.install, update.failed, pin.verify, pin.lockout,
//   admin.open, admin.exit, crash,
//   auto-select.result        ← NEW (Phase 07 LOCALE-01)
//
// Emits a stable `event=<name> k=v k=v at=<ISO>` line via log.info — every
// existing call site using log.info/warn/error keeps working unchanged.
log.audit = function audit(event, fields) {
  const parts = ['event=' + event];
  if (fields && typeof fields === 'object') {
    for (const k of Object.keys(fields)) {
      parts.push(k + '=' + redactValue(k, fields[k]));
    }
  }
  parts.push('at=' + new Date().toISOString());
  log.info(parts.join(' '));
};

// Test-only exports — attached for unit tests only. Not part of the public
// logger API; downstream phases must call log.info/warn/error/audit.
log._redactValue = redactValue;
log._BADGE_FIELDS = BADGE_FIELDS;
log._SECRET_FIELDS = SECRET_FIELDS;
log._CIPHER_FIELDS = CIPHER_FIELDS;
log._MAX_ARCHIVES = MAX_ARCHIVES;

module.exports = log;
