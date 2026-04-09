---
phase: 02-magicline-embed-injection-layer
plan: 02
subsystem: injection-layer
tags: [injection, css, fragile-selectors, drift-patch]
requires: [01]
provides:
  - stable-hide-layer
  - fragile-selector-isolation
  - drift-patch-contract
affects:
  - src/inject/
tech-stack:
  added: []
  patterns:
    - "Pattern 6: Stable vs fragile selector boundary (STABLE/FRAGILE section markers in inject.css)"
    - "Pattern 4: Fragile-selectors plain-var fragment for string concatenation into main world"
key-files:
  created:
    - src/inject/README.md
    - src/inject/inject.css
    - src/inject/fragile-selectors.js
  modified: []
decisions:
  - "Section markers STABLE/FRAGILE (uppercase) in inject.css for Plan 06 grep detectability"
  - "LayoutContainer-sc-5eddc1f5-0 margin-left rule is kept in inject.css but intentionally omitted from STABLE_SELECTORS (it's a layout adjustment, not a must-match hide target)"
  - "fragile-selectors.js uses var (not let/const) to ensure clean scoping when concatenated into inject.js IIFE"
metrics:
  duration: ~5m
  completed: 2026-04-09
requirements: [EMBED-02, EMBED-04, EMBED-06]
---

# Phase 02 Plan 02: Inject Drift-Patch Surface Summary

**One-liner:** Ports the prototype's 10 Magicline hide rules into `src/inject/inject.css` split into STABLE/FRAGILE sections and isolates all MUI `css-xxxxx` drift-prone selectors into `src/inject/fragile-selectors.js` as a plain-var fragment for main-world concatenation.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/inject/README.md` | 31 | Drift-patch blast-radius contract ("Never edit src/main/") |
| `src/inject/inject.css` | 39 | STABLE + FRAGILE hide layer (insertCSS input) |
| `src/inject/fragile-selectors.js` | 43 | FRAGILE_SELECTORS (3) + STABLE_SELECTORS (6) plain-var arrays |

## Commits

- `cfc55bf` — docs(02-02): add src/inject drift-patch contract README
- `f82dabb` — feat(02-02): port prototype hide layer to src/inject/inject.css
- `6562480` — feat(02-02): add fragile-selectors.js with FRAGILE + STABLE arrays

## Hide Rules Reference (for future drift review)

### STABLE section (7 rules, rarely edited)

| # | Selector | Action | Purpose |
|---|----------|--------|---------|
| 1 | `nav.SidebarWrapper-sc-bb205641-0` | display:none | Left sidebar |
| 2 | `[data-role="topbar"]` | display:none | Topbar |
| 3 | `[data-role="global-search-button"]` | display:none | Global search button |
| 4 | `[data-role="categories"]` | display:none | Category tree |
| 5 | `[data-role="customer-search"]` | display:none | Customer search container (EMBED-06: container only) |
| 6 | `[data-role="toolbar"] [data-role="icon-button"]` | display:none | Toolbar three-dot icon button |
| 7 | `.LayoutContainer-sc-5eddc1f5-0` | margin-left:0 | Pull cart content left after sidebar hidden |

### FRAGILE section (3 rules, drift-prone)

| # | Selector | Action | Purpose |
|---|----------|--------|---------|
| 1 | `.MuiBox-root.css-p8umht` | display:none | Product grid tablet |
| 2 | `.css-qo4f3u` | display:none | Kategorien button |
| 3 | `.MuiTypography-h5.css-1b1c5ke` | display:none | Category h5 heading |

Total `display: none !important` occurrences in `inject.css`: **9** (6 stable + 3 fragile).
Total `margin-left: 0 !important` occurrences: **1** (LayoutContainer).

## Requirement Guarantees

### EMBED-02: Stable CSS hide layer ready for insertCSS

Confirmed — `src/inject/inject.css` contains the STABLE section with 7 prototype rules. Plan 04 will pass the file content to `webContents.insertCSS`.

### EMBED-04: Fragile MUI css-xxxxx selectors isolated to src/inject/

Confirmed via cross-directory search: `css-p8umht`, `css-qo4f3u`, `css-1b1c5ke` appear ONLY in `src/inject/inject.css` and `src/inject/fragile-selectors.js`. The `src/main/` tree contains **zero** occurrences. Drift-patch blast radius is contained.

### EMBED-06: customer-search inner input remains DOM-queryable

Confirmed — the only rule targeting customer-search is `[data-role="customer-search"] { display: none !important; }` which hides the container. There is no descendant selector `[data-role="customer-search"] input` anywhere in `inject.css`. Phase 4 NFC badge injection can still call `document.querySelector('[data-role="customer-search"] input')` and receive the element (though it will not be visible while the container is hidden — that is the desired behavior for the "hidden but addressable" pattern).

## Cross-File Sync Check

`inject.css` FRAGILE section and `fragile-selectors.js` FRAGILE_SELECTORS both reference the same 3 selector strings byte-for-byte:

- `.MuiBox-root.css-p8umht`
- `.css-qo4f3u`
- `.MuiTypography-h5.css-1b1c5ke`

The drift-patch playbook in README.md explicitly requires editing both files in lock-step.

## Verification Results

- `src/inject/README.md`, `src/inject/inject.css`, `src/inject/fragile-selectors.js` — all exist
- `node --check src/inject/fragile-selectors.js` — exit 0 (valid JS syntax)
- `grep -r "css-p8umht|css-qo4f3u|css-1b1c5ke" src/main/` — no matches (EMBED-04)
- All 10 prototype rules preserved in `inject.css`
- customer-search container rule does not descend into ` input` (EMBED-06)
- Section markers `STABLE` and `FRAGILE` both present for Plan 06 grep detectability
- `fragile-selectors.js` contains no `require(`, `module.exports`, `import `, `export ` (pure fragment)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All files are data-only artifacts (CSS rules + selector arrays); no placeholder code paths that require future wiring.

## Self-Check: PASSED

- FOUND: src/inject/README.md
- FOUND: src/inject/inject.css
- FOUND: src/inject/fragile-selectors.js
- FOUND: commit cfc55bf
- FOUND: commit f82dabb
- FOUND: commit 6562480
