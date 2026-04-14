// test/fragileSelectors.test.js
// Phase 07 LOCALE-01 — assert the LOCALE_STRINGS.de shape. Guards against
// accidental key renames that would silently break detectAndSelectRegister().
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFragileSelectors() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'inject', 'fragile-selectors.js'),
    'utf8'
  );
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

test('LOCALE_STRINGS.de contains all three auto-select labels', () => {
  const ctx = loadFragileSelectors();
  assert.strictEqual(typeof ctx.LOCALE_STRINGS, 'object');
  assert.strictEqual(typeof ctx.LOCALE_STRINGS.de, 'object');
  assert.strictEqual(ctx.LOCALE_STRINGS.de.KASSE_AUSWAEHLEN, 'Kasse auswählen');
  assert.strictEqual(ctx.LOCALE_STRINGS.de.SELF_CHECKOUT_OPTION, 'Self-Checkout');
  assert.strictEqual(ctx.LOCALE_STRINGS.de.SPEICHERN, 'Speichern');
});

test('LOCALE_STRINGS.de values are all non-empty strings', () => {
  const ctx = loadFragileSelectors();
  for (const key of Object.keys(ctx.LOCALE_STRINGS.de)) {
    const v = ctx.LOCALE_STRINGS.de[key];
    assert.strictEqual(typeof v, 'string', key + ' must be string');
    assert.ok(v.length > 0, key + ' must be non-empty');
  }
});

test('JETZT_VERKAUFEN_TEXT still defined (regression guard)', () => {
  const ctx = loadFragileSelectors();
  assert.strictEqual(ctx.JETZT_VERKAUFEN_TEXT, 'Jetzt verkaufen');
});
