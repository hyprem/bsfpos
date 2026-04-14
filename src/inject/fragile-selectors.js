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
// the cash-register <button data-role="button">. Used by inject.js to detect
// the click that ends a sale and emit the BSK_AUDIT_SALE_COMPLETED sentinel
// (Phase 5 Plan 06 D-27).
var JETZT_VERKAUFEN_TEXT = 'Jetzt verkaufen';

// --- Auto-select locale strings (Phase 07, D-21 / LOCALE-01) -------------
// German text content matched by detectAndSelectRegister() in inject.js.
// When Magicline serves the cash-register UI in de-DE (enforced by
// app.commandLine --lang=de-DE + Accept-Language header override in main.js),
// these are the exact textContent.trim() values of the three buttons in the
// register-selection click chain. Drift-isolated here per D-21 — NO other
// source file may hard-code these strings. Nested under `de` so a future
// second locale can be added without renaming the table.
var LOCALE_STRINGS = {
  de: {
    KASSE_AUSWAEHLEN:     'Kasse auswählen',
    SELF_CHECKOUT_OPTION: 'Self-Checkout',
    SPEICHERN:            'Speichern'
  }
};

var STABLE_SELECTORS = [
  { category: 'stable', selector: '[data-role="topbar"]',                      purpose: 'Topbar' },
  { category: 'stable', selector: '[data-role="global-search-button"]',        purpose: 'Global search button' },
  { category: 'stable', selector: '[data-role="categories"]',                  purpose: 'Category tree' },
  // NFC descope (2026-04-14, quick 260414-eu9): customer-search selector
  // removed from the self-check list. The container remains hidden by
  // inject.css (defense-in-depth) but the kiosk no longer depends on its
  // presence, so a future Magicline rename of this data-role should not
  // trigger a drift event.
  { category: 'stable', selector: '[data-role="toolbar"] [data-role="icon-button"]', purpose: 'Toolbar three-dot icon button' },
  // Phase 3 — login page selectors (D-05). page:'login' excludes them from
  // the cash-register-page self-check (they legitimately don't exist there).
  { category: 'stable', selector: '[data-role="username"]',     purpose: 'Login: username field',  page: 'login' },
  { category: 'stable', selector: '[data-role="password"]',     purpose: 'Login: password field',  page: 'login' },
  { category: 'stable', selector: '[data-role="login-button"]', purpose: 'Login: submit button',   page: 'login' }
];
