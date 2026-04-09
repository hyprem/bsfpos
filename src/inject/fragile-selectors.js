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
  }
];

var STABLE_SELECTORS = [
  { category: 'stable', selector: 'nav.SidebarWrapper-sc-bb205641-0',          purpose: 'Left sidebar' },
  { category: 'stable', selector: '[data-role="topbar"]',                      purpose: 'Topbar' },
  { category: 'stable', selector: '[data-role="global-search-button"]',        purpose: 'Global search button' },
  { category: 'stable', selector: '[data-role="categories"]',                  purpose: 'Category tree' },
  { category: 'stable', selector: '[data-role="customer-search"]',             purpose: 'Customer search container' },
  { category: 'stable', selector: '[data-role="toolbar"] [data-role="icon-button"]', purpose: 'Toolbar three-dot icon button' }
];
