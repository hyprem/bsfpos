// test/magiclineView.sentinel.test.js
// Phase 07 SPLASH-01 / LOCALE-01 — unit tests for the sentinel parser allowlist.
// Mitigates T-07-04 (log-injection via Magicline main world).
const test = require('node:test');
const assert = require('node:assert');
const { parseAutoSelectSentinel } = require('../src/main/magiclineView');

test('parses canonical ok/done', () => {
  assert.deepStrictEqual(
    parseAutoSelectSentinel('BSK_AUTO_SELECT_RESULT:ok:done'),
    { result: 'ok', step: 'done' }
  );
});

test('parses fail at step3', () => {
  assert.deepStrictEqual(
    parseAutoSelectSentinel('BSK_AUTO_SELECT_RESULT:fail:step3-self-checkout'),
    { result: 'fail', step: 'step3-self-checkout' }
  );
});

test('parses timeout/unknown', () => {
  assert.deepStrictEqual(
    parseAutoSelectSentinel('BSK_AUTO_SELECT_RESULT:timeout:unknown'),
    { result: 'timeout', step: 'unknown' }
  );
});

test('allowlists an out-of-range result to unknown', () => {
  assert.deepStrictEqual(
    parseAutoSelectSentinel('BSK_AUTO_SELECT_RESULT:pwn:done'),
    { result: 'unknown', step: 'done' }
  );
});

test('allowlists an out-of-range step to unknown', () => {
  assert.deepStrictEqual(
    parseAutoSelectSentinel('BSK_AUTO_SELECT_RESULT:ok:<script>'),
    { result: 'ok', step: 'unknown' }
  );
});

test('returns null on missing prefix', () => {
  assert.strictEqual(parseAutoSelectSentinel('hello world'), null);
  assert.strictEqual(parseAutoSelectSentinel(''), null);
  assert.strictEqual(parseAutoSelectSentinel(null), null);
  assert.strictEqual(parseAutoSelectSentinel(undefined), null);
  assert.strictEqual(parseAutoSelectSentinel(42), null);
});

test('ignores extra colon-separated fields', () => {
  assert.deepStrictEqual(
    parseAutoSelectSentinel('BSK_AUTO_SELECT_RESULT:ok:done:extra:junk'),
    { result: 'ok', step: 'done' }
  );
});

test('accepts prefix with preceding noise (e.g. Chromium console prefix)', () => {
  assert.deepStrictEqual(
    parseAutoSelectSentinel('[1234:567] BSK_AUTO_SELECT_RESULT:fail:step2-popup'),
    { result: 'fail', step: 'step2-popup' }
  );
});
