---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 05-host-ui
subsystem: host-renderer
tags: [host-ui, branded, admin-menu, updating-cover, pin-lockout, error-variants]
requirements: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-08, BRAND-01, BRAND-02, BRAND-03]
dependency_graph:
  requires:
    - 05-04-main-orchestration (IPC channels + preload surface)
    - 05-02-admin-pin-lockout (verifyAdminPin contract)
  provides:
    - "#admin-menu (layer 500) with 5-row diagnostic header + 6-button safe→destructive stack"
    - "#update-config (layer 500) with masked PAT entry"
    - "#updating-cover (layer 300) with logo + CSS spinner"
    - "#pin-lockout-panel (inside #pin-modal) with live mm:ss countdown"
    - "showMagiclineError variants: bad-release, update-failed"
  affects:
    - src/host/host.html
    - src/host/host.css
    - src/host/host.js
tech-stack:
  added: []
  patterns: [context-aware-pin-routing, one-shot-pointerdown-cleanup, guard-before-setInterval]
key-files:
  created: []
  modified:
    - src/host/host.html
    - src/host/host.css
    - src/host/host.js
decisions:
  - Context-aware PIN modal via module-scoped pinModalContext variable — 'admin' routes to verifyAdminPin (with lockout), 'reset-loop' routes to legacy verifyPin (backward compat, T-05-29)
  - PIN lockout countdown started with explicit guard pattern (clearInterval before setInterval) to defeat double-start leak (T-05-31)
  - update-failed auto-dismiss wires BOTH a 10s setTimeout AND a one-shot pointerdown listener; hideMagiclineError cleans both to prevent stale-timer leaks (T-05-32)
  - PAT input value cleared after submit and on hideUpdateConfig — never retained in DOM (T-05-30)
  - Admin menu error strings never surface raw checkForUpdates error text (T-05-33): only 'Aktuell' / 'Update verfügbar — ...' / 'Auto-Update nicht konfiguriert' / 'Fehler bei der Update-Prüfung'
  - All new CSS additive; zero selectors target Magicline content ([class^="css-"], .MuiBox, .MuiButton) — BRAND-03 preserved
  - Relative-time helper returns German phrases (gerade eben / vor N Min / vor N Std / vor N Tag(en) / noch nie)
metrics:
  duration: "~30m"
  completed: 2026-04-10
  tasks_completed: 3
  files_modified: 3
---

# Phase 5 Plan 05: Host UI Summary

Implement locked UI-SPEC Phase 5 renderer surfaces — admin menu with diagnostic header, update-config PAT entry, updating cover, PIN lockout countdown panel, and two new magicline-error variants — all additive to existing host.html / host.css / host.js without touching pre-Phase-5 surfaces.

## Task Commits

| Task | Description                                          | Commit  | Files             |
| ---- | ---------------------------------------------------- | ------- | ----------------- |
| 1    | Extend host.html with Phase 5 DOM layers             | 9e2a4e6 | src/host/host.html |
| 2    | Add Phase 5 branded styles (layer 500, spinner, lockout) | 178c89f | src/host/host.css |
| 3    | Wire admin menu, PAT form, PIN lockout, error variants | 2af08f5 | src/host/host.js  |

## Diff Footprint

```
 src/host/host.css  | +185 -0
 src/host/host.html |  +83 -4    (79 net)
 src/host/host.js   | +322 -2   (320 net)
 3 files changed, 586 insertions(+), 6 deletions(-)
```

## CSS Rules Added

`host.css` gained a single Phase 5 section (additive, after `.bsk-btn--idle-dismiss`):

- `.bsk-layer--admin` — z-index 500, `rgba(26,26,26,0.97)` backdrop (matches `.bsk-layer--credentials` precedent)
- `.bsk-card--admin` — 32 px padding, `gap: 16px`
- `.bsk-admin-diagnostics` / `.bsk-diag-row` / `.bsk-diag-label` / `.bsk-diag-value`
- `.bsk-admin-btns`
- `.bsk-btn--admin-action` — `min-height: 64px`, 18 px font
- `.bsk-btn--admin-exit` — 20 px (WCAG large-text correction for `#FF6B6B` on `#1A1A1A` 3.95:1)
- `.bsk-admin-update-result` + `--available` modifier
- `.bsk-update-config-hint` (+ `strong` nested rule)
- `.bsk-layer--updating` — z-index 300, `#1A1A1A` background
- `.bsk-spinner` + `@keyframes bsk-spin`
- `.bsk-updating-heading` / `.bsk-updating-subtext`
- `.bsk-pin-lockout-msg`
- `.bsk-pin-lockout-countdown` — 48 px, `#F5C518`, `font-variant-numeric: tabular-nums`

No rule targets `[class^="css-"]`, `.MuiBox`, `.MuiButton` or any Magicline content selector (BRAND-03 grep-asserted = 0 matches).

## HTML Additions

- Updated z-index ladder comment documenting layers 300/500 for Phase 5
- `#updating-cover` layer 300 sibling to `#magicline-error`
- `#pin-lockout-panel` inserted inside `.bsk-card--pin` after the keypad
- `#admin-menu` layer 500 with 5 diagnostic rows (`diag-version`, `diag-last-update`, `diag-auth-state`, `diag-last-reset`, `diag-update-status`) and 6 buttons in safe → destructive order: `check-updates`, `logs`, `reload`, `credentials`, `update-config`, `exit`
- `#update-config` layer 500 with `type="password"` PAT input, `Speichern` (disabled), `Abbrechen`
- Pre-existing layers `#magicline-mount`, `#splash`, `#idle-overlay`, `#credentials-overlay`, `#pin-modal`, `#magicline-error` all intact (grep count == 6)

## JavaScript Additions

Phase 5 state block near Phase 4 idle state:
```
var pinModalContext = 'admin';
var lockoutInterval = null;
var adminUpdateResultTimer = null;
var updateFailedTimer = null;
var updateFailedHandler = null;
```

New helper functions (all inside the existing IIFE):

- `formatRelativeGerman(iso)` — noch nie / gerade eben / vor N Min|Std|Tag(en)
- `authStateLabel(s)` — translates authFlow state to German caps
- `renderDiagnostics(d)` — populates 5 diag rows + swaps update-config button label
- `showAdminMenu(d)` / `hideAdminMenu()`
- `showUpdateConfig()` / `hideUpdateConfig()` (both clear PAT input → T-05-30)
- `showUpdatingCover()` / `hideUpdatingCover()`
- `showAdminUpdateResult(payload)` — 5 s auto-hide, status strings only (T-05-33)
- `formatMmSs(ms)` — pad-start mm:ss
- `showPinLockout({lockedUntil})` — hides keypad, starts tick interval WITH `if (lockoutInterval) clearInterval` guard (T-05-31)
- `hidePinLockout()` — clears interval + restores keypad/display
- `wireAdminButtons()` — binds 6 admin button IDs + PAT form input/save/cancel

Modified existing handlers:

- PIN keypad OK handler — branches on `pinModalContext`: `'admin'` → `verifyAdminPin` (handles `{locked, ok}` response) else legacy `verifyPin`
- `showMagiclineError` — new branches for `bad-release` (PIN button visible, recovery via `pinBtnRequestPinRecovery`) and `update-failed` (PIN button hidden, 10 s setTimeout + one-shot pointerdown, cleaned in hide)
- `hideMagiclineError` — clears `updateFailedTimer` and removes `updateFailedHandler` to prevent stale-timer leaks
- `onShowPinModal` subscriber — now stores `pinModalContext` from payload then resets lockout view + shows modal
- IPC subscriber block extended with 9 new Phase 5 `on*` channels

## Self-Check: PASSED

- `node --check src/host/host.js` → exits 0 (SYNTAX_OK)
- `grep -c 'id="admin-btn-' src/host/host.html` → 6 (all admin buttons)
- `grep -c 'class="bsk-diag-row"' src/host/host.html` → 5 (all diagnostic rows)
- `grep -c 'id="splash"|id="idle-overlay"|id="credentials-overlay"|id="pin-modal"|id="magicline-error"|id="magicline-mount"' src/host/host.html` → 6 (pre-existing layers intact)
- `grep -cE '\[class\^="css-"\]|\.MuiBox|\.MuiButton' src/host/host.css` → 0 (BRAND-03 preserved)
- `grep -c "pinModalContext" src/host/host.js` → 3 (declare + set + branch)
- `grep -c "lockoutInterval" src/host/host.js` → 5 (exceeds ≥4 threshold; guard+tick+hide)
- `grep -c "updateFailedTimer" src/host/host.js` → 6 (declare + set + multiple clears)
- `grep -c "admin-btn-" src/host/host.js` → 7 (6 button IDs + the id swap reference)
- `grep -c "showPinLockout" src/host/host.js` → 3 (def + call in OK handler + IPC subscribe)
- `grep -c "showUpdatingCover" src/host/host.js` → 2 (def + subscribe)
- Full test suite `node --test test/*.test.js` → **242/242 passing** (no regression)

All commits verified:
- `git log --oneline` shows 9e2a4e6, 178c89f, 2af08f5

## Deviations from Plan

None — plan executed exactly as written. All inline code snippets were adapted to match the existing host.js code style (`var` not `let`, IIFE scoping, no ES2020+ numeric separators in runtime code) without changing behavior.

## Threat Register Verification

| Threat | Disposition | Verification |
|--------|-------------|--------------|
| T-05-28 Admin menu DOM visible at boot | mitigate | `#admin-menu` declared `style="display:none"` and `aria-hidden="true"` |
| T-05-29 Reset-loop PIN miswired to verifyAdminPin | mitigate | `pinModalContext === 'admin'` branch guards; legacy `verifyPin` path preserved |
| T-05-30 PAT retained in DOM post-save | mitigate | `patInput.value = ''` in both save-success and `hideUpdateConfig` |
| T-05-31 Countdown setInterval leak | mitigate | `if (lockoutInterval) { clearInterval... }` guard before `setInterval` |
| T-05-32 update-failed variant blocks forever | mitigate | setTimeout(10000) + `{once:true}` pointerdown; both cleaned in `hideMagiclineError` |
| T-05-33 PAT error text leaks | mitigate | `showAdminUpdateResult` uses fixed German strings only; raw errors never displayed |
| T-05-34 Magicline content theme drift | mitigate | Grep asserts 0 matches for `[class^="css-"]`, `.MuiBox`, `.MuiButton` in host.css |
