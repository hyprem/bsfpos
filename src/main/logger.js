// src/main/logger.js
// Electron-log instance configured for Phase 1 boot events.
// File transport writes to %AppData%/Bee Strong POS/logs/main.log
// Rotation: 1 MB per file (electron-log default), one main.old.log backup.
// This module is the single logging entry point for the main process — all
// future phases import from here.

const log = require('electron-log/main');

// Initialize main-process logging. electron-log v5 requires explicit init.
log.initialize();

// File transport: 1 MB max size, rotation to main.old.log
log.transports.file.level = 'info';
log.transports.file.maxSize = 1024 * 1024; // 1 MB per file
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
// Filename defaults to main.log; resolve path on demand so electron app path is ready.
log.transports.file.fileName = 'main.log';

// Console transport: always-on at info in dev, warn in prod
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

module.exports = log;
