// test/productSearchFocus.test.js
// -----------------------------------------------------------------------------
// Quick 260414-eu9 — NFC descope focus assertion.
//
// After descoping the NFC badge input, the HID reader's keystrokes must land
// directly in the Magicline product-search input. The cash-register-ready
// handler in magiclineView.js is responsible for focusing that input once
// the page hydrates. This test is a source-grep contract check — fails loudly
// if a future refactor removes the focus call.
// -----------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const magiclineViewSrc = fs.readFileSync(
  path.join(REPO, 'src/main/magiclineView.js'),
  'utf8'
);

test('magiclineView: cash-register-ready handler focuses product-search input', () => {
  // Locate the cash-register-ready branch.
  const idx = magiclineViewSrc.indexOf("if (type === 'cash-register-ready')");
  assert.ok(idx !== -1, 'cash-register-ready handler must exist in magiclineView.js');

  // Find the end of the handler block — the next sibling `if (type === ...)`
  // or `return` sequence. Cheap upper bound: slice to next 'if (type ===' match.
  const rest = magiclineViewSrc.slice(idx + 1);
  const nextBranchRel = rest.indexOf("if (type === '");
  const handlerBody = nextBranchRel === -1
    ? magiclineViewSrc.slice(idx)
    : magiclineViewSrc.slice(idx, idx + 1 + nextBranchRel);

  // Must issue an executeJavaScript call targeting [data-role="product-search"] input
  // with .focus() somewhere in the expression.
  assert.match(
    handlerBody,
    /executeJavaScript\s*\(/,
    'cash-register-ready handler must call executeJavaScript to run the focus snippet'
  );
  assert.ok(
    handlerBody.indexOf('[data-role="product-search"] input') !== -1,
    'cash-register-ready handler must reference the product-search input selector'
  );
  assert.match(
    handlerBody,
    /\.focus\(\)/,
    'cash-register-ready handler must call .focus() on the product-search input'
  );
});

test('magiclineView: badgeInput module is no longer required anywhere', () => {
  assert.ok(
    magiclineViewSrc.indexOf("require('./badgeInput')") === -1,
    'magiclineView.js must not require ./badgeInput after NFC descope'
  );

  const mainSrc = fs.readFileSync(
    path.join(REPO, 'src/main/main.js'),
    'utf8'
  );
  assert.ok(
    mainSrc.indexOf("require('./badgeInput')") === -1,
    'main.js must not require ./badgeInput after NFC descope'
  );
  assert.ok(
    mainSrc.indexOf('attachBadgeInput') === -1,
    'main.js must not reference attachBadgeInput after NFC descope'
  );
});
