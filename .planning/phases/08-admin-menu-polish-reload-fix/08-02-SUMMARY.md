---
phase: 08-admin-menu-polish-reload-fix
plan: 02
subsystem: host-ui
tags: [html, css, javascript, admin-menu, pin-change, close-button]

# Dependency graph
requires:
  - phase: 08-admin-menu-polish-reload-fix
    plan: 01
    provides: closeAdminMenu IPC, submit-pin-change IPC, cancel-pin-change IPC, preload channels
provides:
  - X close button in admin menu card (HTML + CSS + JS click handler)
  - Esc key handler with nested-overlay guard (D-02)
  - Credentials overlay title fix for re-entry mode (D-06)
  - PIN andern button in admin menu button stack (D-08)
  - PIN change overlay with 3-field form and client-side validation (D-09)
  - PIN change form wiring (submit + cancel IPC calls)
affects: [admin-menu, credentials-overlay, pin-change-overlay]

# Tech tracking
tech-stack:
  added: []
  patterns: [absolute-positioned close button within relative card, Esc keydown with nested overlay guard]

key-files:
  created: []
  modified: [src/host/host.html, src/host/host.css, src/host/host.js]

key-decisions:
  - "X close button uses .bsk-btn .bsk-admin-close (discreet, not primary) per UI-SPEC"
  - "PIN change overlay is a separate #pin-change-overlay div (not a third mode on #credentials-overlay) per CONTEXT.md discretion"
  - "Esc keydown handler checks 3 nested overlays (credentials, pin-change, update-config) before routing to closeAdminMenu"
  - "Client-side PIN validation is UX convenience only; server enforces via adminPin.verifyPin (T-08-09 accepted)"

patterns-established:
  - "Absolute close button pattern: position:relative on card, position:absolute on button"
  - "Esc key guard pattern: check all nested overlays display !== none before routing"

requirements-completed: [ADMIN-01, ADMIN-03, FIX-01]

# Metrics
duration: 3min
completed: 2026-04-20
---

# Phase 08 Plan 02: Host-Side UI — Admin Menu Polish & PIN Change Summary

**X close button (44x44 touch target) + Esc handler with nested-overlay guard + credentials title fix in re-entry mode + PIN andern button + full PIN change overlay with 3-field form, client-side validation, and German error messages**

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | HTML — X close button, PIN andern button, PIN change overlay | 45645cf | Added close button as first card child, PIN andern button in correct stack position, full #pin-change-overlay with 3 fields |
| 2 | CSS + JS — X button styling, Esc handler, credentials title fix, PIN change logic | 77f464c | .bsk-admin-close CSS, Esc keydown guard, title fix in showCredentialsOverlay, wirePinChangeForm with validation |
| 3 | Human verification of all Phase 08 admin menu changes | PENDING | Checkpoint — requires manual testing in running app |

## Checkpoint: Pending Human Verification (Task 3)

**Type:** human-verify
**Status:** Pending — automated tasks complete, manual verification required

### What Was Built

Complete Phase 08 admin menu polish: close button (X + Esc + Ctrl+Shift+F12 toggle), credentials re-entry mode title fix, PIN change flow, and Kasse nachladen welcome-state fix (IPC from Plan 01).

### How to Verify

1. Launch the app: `npm start`
2. **Close button (ADMIN-01):**
   - Open admin menu (Ctrl+Shift+F12, enter PIN)
   - Verify X button visible in top-right corner of admin card
   - Tap X button — admin menu should close, prior layer (welcome) should appear
   - Reopen admin menu, press Esc key — same close behavior
   - Reopen admin menu, press Ctrl+Shift+F12 again — should close (toggle)
3. **Esc nesting (D-02):**
   - Open admin menu, tap "Anmeldedaten andern" — credentials overlay appears
   - Press Esc — should NOT close the admin menu (only nested overlay's own cancel path)
   - Tap Abbrechen on credentials, then Esc from root admin menu — should close admin
4. **Credentials re-entry mode (ADMIN-03):**
   - Open admin menu, tap "Anmeldedaten andern"
   - Verify title says "Anmeldedaten andern" (NOT "Kiosk einrichten")
   - Verify only username + password fields visible (NO PIN fields)
5. **PIN change (D-08 through D-11):**
   - Open admin menu, verify "PIN andern" button visible between "Anmeldedaten andern" and "Auto-Update einrichten"
   - Tap "PIN andern" — PIN change overlay should appear with 3 fields
   - Enter wrong current PIN, valid new PIN + confirm — tap Speichern — should show "Falscher PIN"
   - Enter correct current PIN, mismatched new PINs — should show "PINs stimmen nicht uberein"
   - Enter correct current PIN, matching new PINs (4-6 digits) — should succeed and return to admin menu
   - Verify new PIN works: close admin, reopen with Ctrl+Shift+F12, enter new PIN
6. **Kasse nachladen fix (FIX-01):**
   - From welcome screen, open admin menu
   - Tap "Kasse nachladen"
   - Verify: admin menu closes, splash (BITTE WARTEN) appears, kiosk starts fresh login flow

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- `node --check src/host/host.js` - PASS
- All HTML element IDs present in host.html - PASS
- `.bsk-admin-close` CSS class present with correct positioning - PASS
- All JS functions present (showPinChangeOverlay, hidePinChangeOverlay, wirePinChangeForm) - PASS
- Esc handler with nested overlay guard - PASS
- Credentials title fix with unicode escape - PASS
- German error messages present - PASS

## Known Stubs

None - all UI elements are fully wired to Plan 01's IPC surface.

## Self-Check: PASSED
