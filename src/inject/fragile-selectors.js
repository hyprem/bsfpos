// src/inject/fragile-selectors.js
// -----------------------------------------------------------------------------
// Magicline drift-prone selectors. Plain JS fragment — NOT a CommonJS module.
//
// Read as a raw string by src/main/magiclineView.js and concatenated BEFORE
// src/inject/inject.js into a single executeJavaScript call. After concat,
// FRAGILE_SELECTORS and STABLE_SELECTORS are global `var` declarations visible
// to inject.js's IIFE.
//
// EDIT THIS FILE when Magicline ships an MUI class rename.
// Also edit the matching rule in src/inject/inject.css FRAGILE section.
// Never edit src/main/ in response to a Magicline drift incident (D-11).
// -----------------------------------------------------------------------------

var FRAGILE_SELECTORS = [
  {
    category: 'fragile',
    selector: '.MuiBox-root.css-p8umht',
    fallback: null,
    purpose: 'Product grid tablet'
  },
  {
    category: 'fragile',
    selector: '.css-qo4f3u',
    fallback: null,
    purpose: 'Kategorien button'
  },
  {
    category: 'fragile',
    selector: '.MuiTypography-h5.css-1b1c5ke',
    fallback: null,
    purpose: 'Category h5 heading'
  },
  // styled-components hash class (-sc-<hash>-0) — drifts on Magicline
  // version bumps exactly like MUI css-xxxxx hashes. Keep in FRAGILE.
  {
    category: 'fragile',
    selector: 'nav.SidebarWrapper-sc-bb205641-0',
    fallback: null,
    purpose: 'Left sidebar'
  }
];

// --- Structural-text constants (Phase 4, D-21) ---------------------------
// Text content used for structural matching against Magicline buttons. These
// strings drift with Magicline localization / copy changes exactly like the
// fragile MUI class hashes — isolating them here keeps the drift-patch blast
// radius inside this single file (D-21).
//
// JETZT_VERKAUFEN_TEXT: German label on the primary "sell now" button inside
// the cash-register <button data-role="button">. Used by inject.js Phase 4
// post-sale clear (IDLE-06) to detect the click that ends a sale and schedule
// the 3s customer-search clear.
var JETZT_VERKAUFEN_TEXT = 'Jetzt verkaufen';

var STABLE_SELECTORS = [
  { category: 'stable', selector: '[data-role="topbar"]',                      purpose: 'Topbar' },
  { category: 'stable', selector: '[data-role="global-search-button"]',        purpose: 'Global search button' },
  { category: 'stable', selector: '[data-role="categories"]',                  purpose: 'Category tree' },
  { category: 'stable', selector: '[data-role="customer-search"]',             purpose: 'Customer search container' },
  { category: 'stable', selector: '[data-role="toolbar"] [data-role="icon-button"]', purpose: 'Toolbar three-dot icon button' },
  // Phase 3 — login page selectors (D-05). page:'login' excludes them from
  // the cash-register-page self-check (they legitimately don't exist there).
  { category: 'stable', selector: '[data-role="username"]',     purpose: 'Login: username field',  page: 'login' },
  { category: 'stable', selector: '[data-role="password"]',     purpose: 'Login: password field',  page: 'login' },
  { category: 'stable', selector: '[data-role="login-button"]', purpose: 'Login: submit button',   page: 'login' }
];
