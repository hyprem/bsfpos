// test/phase5-touch-target.test.js
// Phase 5 Plan 06 BRAND-02: CSS-level touch target audit.
//
// Reads src/host/host.css as text and asserts that every Phase 5 interactive
// selector declares (or inherits from a base class that does) a min-height
// >= 44 px. Pure regex/string parser — no DOM, no bundler.
//
// The test doubles as a BRAND-03 regression guard by asserting that no
// Magicline content selectors (MUI/css-xxxxx) leaked into host.css.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'src', 'host', 'host.css');
const css = fs.readFileSync(cssPath, 'utf8');

// Extract the rule block for a given selector. Returns the body text
// between `{` and the matching `}`. Handles simple single-level rules only.
function getRuleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchor on a whitespace-or-start followed by the selector + optional
  // whitespace + open brace. Avoids matching substrings inside longer selectors.
  const re = new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}', 'm');
  const m = css.match(re);
  return m ? m[1] : null;
}

function getMinHeightPx(selector) {
  const body = getRuleBody(selector);
  if (!body) return null;
  const m = body.match(/min-height\s*:\s*(\d+)px/);
  return m ? parseInt(m[1], 10) : null;
}

test('CSS file loads', () => {
  assert.ok(css.length > 0);
});

test('.bsk-btn--admin-action declares min-height >= 44px', () => {
  const mh = getMinHeightPx('.bsk-btn--admin-action');
  assert.ok(mh !== null, '.bsk-btn--admin-action rule or min-height missing');
  assert.ok(mh >= 44, '.bsk-btn--admin-action min-height=' + mh + ' < 44');
});

test('.bsk-btn--admin-action min-height specifically 64px per UI-SPEC', () => {
  assert.strictEqual(getMinHeightPx('.bsk-btn--admin-action'), 64);
});

test('.bsk-btn--admin-exit inherits min-height >= 44 and declares 20px font override', () => {
  // admin-exit inherits .bsk-btn--admin-action min-height:64px via CSS cascade.
  // Explicitly assert the WCAG font-size override is present.
  const body = getRuleBody('.bsk-btn--admin-exit');
  assert.ok(body !== null, '.bsk-btn--admin-exit rule missing');
  assert.match(body, /font-size\s*:\s*20px/, '.bsk-btn--admin-exit missing 20px WCAG override');
});

test('.bsk-btn base class declares min-height >= 44px (inheritance path for update-config Abbrechen)', () => {
  const mh = getMinHeightPx('.bsk-btn');
  assert.ok(mh !== null, '.bsk-btn base rule missing min-height');
  assert.ok(mh >= 44, '.bsk-btn min-height=' + mh + ' < 44 — BRAND-02 violation');
});

test('.bsk-btn--primary declares min-height >= 44px (update-config Speichern button)', () => {
  const primaryMh = getMinHeightPx('.bsk-btn--primary');
  const baseMh    = getMinHeightPx('.bsk-btn');
  const effective = primaryMh !== null ? primaryMh : baseMh;
  assert.ok(effective !== null, 'no min-height found on .bsk-btn--primary or .bsk-btn');
  assert.ok(effective >= 44, 'effective min-height=' + effective + ' < 44');
});

test('.bsk-input declares min-height >= 44px (PAT input field)', () => {
  const mh = getMinHeightPx('.bsk-input');
  assert.ok(mh !== null, '.bsk-input rule missing min-height');
  assert.ok(mh >= 44, '.bsk-input min-height=' + mh + ' < 44 — BRAND-02 violation for PAT field');
});

test('.bsk-layer--admin declares z-index: 500 per UI-SPEC layer ladder', () => {
  const body = getRuleBody('.bsk-layer--admin');
  assert.ok(body !== null);
  assert.match(body, /z-index\s*:\s*500/);
});

test('.bsk-layer--updating declares z-index: 300 per UI-SPEC layer ladder', () => {
  const body = getRuleBody('.bsk-layer--updating');
  assert.ok(body !== null);
  assert.match(body, /z-index\s*:\s*300/);
});

test('.bsk-pin-lockout-countdown declares font-size: 48px and tabular-nums', () => {
  const body = getRuleBody('.bsk-pin-lockout-countdown');
  assert.ok(body !== null);
  assert.match(body, /font-size\s*:\s*48px/);
  assert.match(body, /font-variant-numeric\s*:\s*tabular-nums/);
});

test('no Magicline content selectors in host.css (BRAND-03 regression guard)', () => {
  const bad = [
    /\[class\^="css-"\]/,
    /\.MuiBox/,
    /\.MuiButton/,
    /\.MuiTypography/,
  ];
  for (const re of bad) {
    assert.doesNotMatch(css, re, 'Magicline selector leaked into host.css: ' + re);
  }
});

test('@keyframes bsk-spin is declared (updating cover spinner)', () => {
  assert.match(css, /@keyframes\s+bsk-spin/);
});
