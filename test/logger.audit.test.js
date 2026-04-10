// test/logger.audit.test.js
// Unit tests for log.audit redactor and event format (Phase 5 D-25).
// Uses node:test / node:assert — no new npm deps.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const log = require('../src/main/logger');

// Capture log.info output by monkey-patching so we can inspect the rendered
// line without hitting the file transport.
function captureAudit(fn) {
  const captured = [];
  const orig = log.info;
  log.info = (msg) => captured.push(msg);
  try { fn(); } finally { log.info = orig; }
  return captured;
}

test('audit: emits event= and at= tokens for no-fields call', () => {
  const [line] = captureAudit(() => log.audit('startup'));
  assert.match(line, /^event=startup /);
  assert.match(line, / at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('audit: redacts badge field to sha256 slice(0,8)', () => {
  const raw = '4200000012345';
  const expected = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  const [line] = captureAudit(() => log.audit('badge.scanned', { badge: raw }));
  assert.ok(line.includes('badge=' + expected), 'line: ' + line);
  assert.ok(!line.includes(raw), 'raw badge leaked: ' + line);
});

test('audit: redacts badgeId, member, memberId fields', () => {
  for (const key of ['badgeId', 'member', 'memberId']) {
    const [line] = captureAudit(() => log.audit('t', { [key]: 'secret-value-123' }));
    assert.ok(!line.includes('secret-value-123'), key + ' leaked: ' + line);
    assert.match(line, new RegExp(key + '=[0-9a-f]{8}'));
  }
});

test('audit: redacts password/pass/pwd to ***', () => {
  for (const key of ['password', 'pass', 'pwd']) {
    const [line] = captureAudit(() => log.audit('t', { [key]: 'hunter2' }));
    assert.ok(!line.includes('hunter2'), key + ' leaked: ' + line);
    assert.ok(line.includes(key + '=***'), 'no *** for ' + key + ': ' + line);
  }
});

test('audit: redacts cipher/ciphertext/token/pat to [cipher:<len>]', () => {
  for (const key of ['cipher', 'ciphertext', 'token', 'pat']) {
    const [line] = captureAudit(() => log.audit('t', { [key]: 'ghp_abcdef' }));
    assert.ok(!line.includes('ghp_abcdef'), key + ' leaked: ' + line);
    assert.match(line, new RegExp(key + '=\\[cipher:10\\]'));
  }
});

test('audit: passes non-allowlisted fields through as String()', () => {
  const [line] = captureAudit(() => log.audit('t', { version: '1.2.3', count: 42 }));
  assert.ok(line.includes('version=1.2.3'));
  assert.ok(line.includes('count=42'));
});

test('audit: handles null/undefined fields without throwing', () => {
  assert.doesNotThrow(() => log.audit('t', null));
  assert.doesNotThrow(() => log.audit('t', undefined));
  assert.doesNotThrow(() => log.audit('t'));
});

test('audit: multiple fields serialise in iteration order', () => {
  const [line] = captureAudit(() => log.audit('update.check', { version: '1.0', result: 'ok' }));
  assert.match(line, /^event=update\.check version=1\.0 result=ok at=/);
});
