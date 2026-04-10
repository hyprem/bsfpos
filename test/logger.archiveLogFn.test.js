// test/logger.archiveLogFn.test.js
// Unit tests for the 5-file rotation chain (Phase 5 D-26 / ADMIN-05).
// Uses a temp dir + fake LogFile wrapper — no electron-log internals required.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const log = require('../src/main/logger');

function makeFakeLogFile(p) {
  return { toString: () => p };
}

test('archiveLogFn: rotates main.log -> main.1.log on first call', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsk-logrotate-'));
  const main = path.join(dir, 'main.log');
  fs.writeFileSync(main, 'current');

  log.transports.file.archiveLogFn(makeFakeLogFile(main));

  assert.ok(!fs.existsSync(main), 'main.log should have been renamed');
  assert.ok(fs.existsSync(path.join(dir, 'main.1.log')), 'main.1.log should exist');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.1.log'), 'utf8'), 'current');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('archiveLogFn: walks chain main.1->2, main.2->3, main.3->4, main.4->5', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsk-logrotate-'));
  const main = path.join(dir, 'main.log');
  fs.writeFileSync(main, 'current');
  fs.writeFileSync(path.join(dir, 'main.1.log'), 'one');
  fs.writeFileSync(path.join(dir, 'main.2.log'), 'two');
  fs.writeFileSync(path.join(dir, 'main.3.log'), 'three');
  fs.writeFileSync(path.join(dir, 'main.4.log'), 'four');

  log.transports.file.archiveLogFn(makeFakeLogFile(main));

  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.1.log'), 'utf8'), 'current');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.2.log'), 'utf8'), 'one');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.3.log'), 'utf8'), 'two');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.4.log'), 'utf8'), 'three');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.5.log'), 'utf8'), 'four');
  assert.ok(!fs.existsSync(main));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('archiveLogFn: deletes main.5.log when chain is full (no 6th file)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsk-logrotate-'));
  const main = path.join(dir, 'main.log');
  fs.writeFileSync(main, 'current');
  fs.writeFileSync(path.join(dir, 'main.1.log'), 'one');
  fs.writeFileSync(path.join(dir, 'main.2.log'), 'two');
  fs.writeFileSync(path.join(dir, 'main.3.log'), 'three');
  fs.writeFileSync(path.join(dir, 'main.4.log'), 'four');
  fs.writeFileSync(path.join(dir, 'main.5.log'), 'five-GONE');

  log.transports.file.archiveLogFn(makeFakeLogFile(main));

  // five-GONE must be unlinked, not survive as a 6th file.
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.5.log'), 'utf8'), 'four');
  assert.ok(!fs.readdirSync(dir).includes('main.6.log'));
  // Total files in dir = main.1..5 = 5 files, no main.log.
  const files = fs.readdirSync(dir).filter(f => f.startsWith('main'));
  assert.strictEqual(files.length, 5, 'expected exactly 5 archives, got: ' + files.join(','));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('archiveLogFn: does not throw on a missing main.log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsk-logrotate-'));
  const main = path.join(dir, 'main.log');
  assert.doesNotThrow(() => log.transports.file.archiveLogFn(makeFakeLogFile(main)));
  fs.rmSync(dir, { recursive: true, force: true });
});
