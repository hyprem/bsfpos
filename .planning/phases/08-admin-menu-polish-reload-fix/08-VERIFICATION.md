---
phase: 08-admin-menu-polish-reload-fix
verified: 2026-04-20T15:30:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Close button (X, Esc, Ctrl+Shift+F12 toggle) non-destructively hides admin menu and returns to prior layer"
    expected: "X button visible top-right, clicking it or pressing Esc or second Ctrl+Shift+F12 hides admin, shows welcome/cash register underneath"
    why_human: "Visual layout, touch target size, layer stacking behavior in live Electron window"
  - test: "Esc key does NOT close admin menu when nested overlay is visible"
    expected: "From credentials/PIN-change/update-config overlay, Esc does nothing; only from root admin menu does Esc close"
    why_human: "Keyboard event routing with nested overlay state is runtime behavior"
  - test: "PAT lockout persists through admin close/reopen cycle"
    expected: "Close admin during lockout, reopen -- lockout countdown still active"
    why_human: "Lockout state is in electron-store; requires live app timing test"
  - test: "Credentials re-entry shows 'Anmeldedaten andern' title and hides PIN fields"
    expected: "Title is 'Anmeldedaten andern', PIN fields hidden; first-boot still shows 'Kiosk einrichten' + all 4 fields"
    why_human: "Visual confirmation of DOM text and field visibility in both modes"
  - test: "PIN change flow: wrong PIN, mismatch, success all produce correct German errors and behavior"
    expected: "Wrong PIN -> 'Falscher PIN'; mismatch -> 'PINs stimmen nicht uberein'; success -> returns to admin menu; new PIN works on next login"
    why_human: "End-to-end IPC flow with state changes requires live app"
  - test: "Kasse nachladen from welcome state starts fresh session without wedging"
    expected: "From welcome, admin menu -> Kasse nachladen -> splash shows -> fresh login flow starts -> does not hang"
    why_human: "FIX-01 core bug fix requires verifying actual navigation lifecycle"
---

# Phase 08: Admin Menu Polish & Reload Fix Verification Report

**Phase Goal:** Admins can dismiss the admin menu non-destructively, change only Magicline credentials without exposing PIN-reset fields, and recover from "Kasse nachladen" tapped on the welcome layer without wedging the kiosk.
**Verified:** 2026-04-20T15:30:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admin menu has a discreet top-right close control (>=44x44 px) that hides the overlay and returns to the prior layer; Esc and second Ctrl+Shift+F12 route through the same handler | VERIFIED | `#admin-btn-close` in host.html (first child of .bsk-card--admin), CSS min-width/min-height 44px, host.js click handler calls closeAdminMenu(), Esc handler guards nested overlays then calls closeAdminMenu(), main.js openAdminPinModal toggles via closeAdminMenu() when adminMenuOpen=true |
| 2 | Closing during PAT lockout dismisses panel without resetting lockout countdown; audit log `admin.action action=close-menu` emitted | VERIFIED | closeAdminMenu() sets adminMenuOpen=false and emits audit log (line 92) but does NOT touch store lockout fields; lockout state lives independently in electron-store |
| 3 | Credentials overlay in re-entry mode shows username+password only; PIN fields absent; first-boot dispatches mode=first-run with all 4 fields | VERIFIED | showCredentialsOverlay sets firstRunFields.style.display='none' when not firstRun; title updated to 'Anmeldedaten andern' via cardTitle.textContent; first-run path sets display='block' and title 'Kiosk einrichten' |
| 4 | Kasse nachladen from welcome state starts fresh session via startLoginFlow() rather than reload() against null | VERIFIED | Reload case branches on mvExists(); when false: hides welcome, shows splash, calls startLoginFlow(). mainWindow.webContents.reload() removed entirely from codebase |
| 5 | Public magiclineView.exists() method exists and is used by the reload handler to branch on view existence | VERIFIED | function exists() at line 726-728, exported at line 740; used in reload case (line 794-795) and closeAdminMenu (line 94-95) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/magiclineView.js` | exists() public method | VERIFIED | function exists() exported, returns magiclineView !== null |
| `src/main/main.js` | closeAdminMenu helper, toggle logic, reload fix, pin-change case, submit-pin-change handler | VERIFIED | All present: closeAdminMenu (line 90), toggle in openAdminPinModal (line 72), reload fix (line 791), pin-change case (line 830), submit-pin-change (line 895) |
| `src/main/preload.js` | Phase 08 IPC channels for PIN change | VERIFIED | onShowPinChangeOverlay, onHidePinChangeOverlay, submitPinChange, cancelPinChange all present (lines 80-83) |
| `src/host/host.html` | X close button, PIN andern button, #pin-change-overlay | VERIFIED | admin-btn-close (line 176), admin-btn-pin-change (line 193), pin-change-overlay (line 203) with 3 fields |
| `src/host/host.css` | X button positioning, admin card relative | VERIFIED | .bsk-admin-close with position:absolute top:8px right:8px min-44x44; .bsk-card--admin position:relative |
| `src/host/host.js` | X button handler, Esc logic, PIN change overlay logic, credentials title fix | VERIFIED | showPinChangeOverlay, hidePinChangeOverlay, wirePinChangeForm, Esc guard, cardTitle fix all present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| main.js closeAdminMenu() | magiclineView.exists() | require('./magiclineView').exists() | WIRED | Line 94: `const { exists: mvExists, setMagiclineViewVisible } = require('./magiclineView')` then `if (mvExists())` |
| main.js reload case | magiclineView getMagiclineWebContents() | require('./magiclineView') | WIRED | Line 794: `const { exists: mvExists, getMagiclineWebContents } = require('./magiclineView')` |
| main.js submit-pin-change | adminPin.verifyPin + setPin | require('./adminPin') | WIRED | Line 900: `adminPin.verifyPin(store, payload.currentPin)`, Line 906: `adminPin.setPin(store, payload.newPin)` |
| host.js #admin-btn-close click | window.kiosk.closeAdminMenu() | click event handler | WIRED | Line 811: `window.kiosk.closeAdminMenu()` |
| host.js Esc keydown | window.kiosk.closeAdminMenu() | keydown handler with nested-overlay guard | WIRED | Line 1038: `window.kiosk.closeAdminMenu()` after Escape check + nested overlay guards |
| host.js submitPinChange | window.kiosk.submitPinChange(payload) | IPC invoke from Speichern button | WIRED | Line in wirePinChangeForm: `await window.kiosk.submitPinChange({ currentPin: current, newPin: newPin })` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| magiclineView.js syntax valid | `node --check src/main/magiclineView.js` | Exit 0 | PASS |
| main.js syntax valid | `node --check src/main/main.js` | Exit 0 | PASS |
| preload.js syntax valid | `node --check src/main/preload.js` | Exit 0 | PASS |
| exists() exported as function | `node -e "typeof require('./src/main/magiclineView').exists"` | "function" | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ADMIN-01 | 08-01, 08-02 | Admin menu close control (X, Esc, toggle), non-destructive, lockout-safe, audit log | SATISFIED | Close button HTML/CSS/JS, Esc handler, toggle in openAdminPinModal, audit line `close-menu`, no lockout state touched |
| ADMIN-03 | 08-01, 08-02 | Credentials overlay re-entry mode with username+password only, correct title | SATISFIED | Title fix in showCredentialsOverlay, firstRunFields hidden in non-firstRun mode, audit `credentials-changed` |
| FIX-01 | 08-01 | Kasse nachladen from welcome starts fresh session not reload against null | SATISFIED | Reload case branches on exists(), calls startLoginFlow() when no view, mainWindow.webContents.reload() eliminated |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No TODOs, FIXMEs, placeholders, or stubs found in Phase 08 modified files |

### Human Verification Required

### 1. Close Button Visual and Functional Test

**Test:** Launch app, open admin menu, verify X button in top-right (44x44 min), tap X to close, reopen and press Esc, reopen and press Ctrl+Shift+F12
**Expected:** All three paths close admin menu non-destructively, returning to prior layer (welcome or cash register)
**Why human:** Touch target size, visual positioning, and layer restoration require live visual confirmation

### 2. Esc Key Nesting Guard

**Test:** Open admin menu, navigate to credentials overlay, press Esc
**Expected:** Esc does NOT close admin menu while nested overlay is visible; only fires from root admin menu state
**Why human:** Keyboard event routing with nested DOM state requires live interaction

### 3. Credentials Re-Entry Mode Title and Fields

**Test:** Open admin menu, tap "Anmeldedaten andern"; separately test first-boot flow
**Expected:** Re-entry: title "Anmeldedaten andern", only username+password visible. First-boot: title "Kiosk einrichten", all 4 fields
**Why human:** Visual DOM state confirmation in both modes

### 4. PIN Change End-to-End Flow

**Test:** Open admin menu, tap "PIN andern", test wrong current PIN, mismatched PINs, then successful change
**Expected:** German error messages for each failure case; success returns to admin menu; new PIN works on next login
**Why human:** Multi-step IPC flow with state persistence requires live app verification

### 5. Kasse Nachladen from Welcome State (FIX-01)

**Test:** From welcome screen, open admin menu, tap "Kasse nachladen"
**Expected:** Admin closes, splash appears, fresh login flow starts, kiosk does NOT wedge
**Why human:** Core bug fix -- must verify actual navigation lifecycle and non-wedging behavior

### 6. PAT Lockout Persistence Through Close

**Test:** Trigger PAT lockout, open admin menu, close it, reopen -- verify lockout countdown still active
**Expected:** Lockout is not reset by admin close
**Why human:** Requires timing-dependent state persistence test in live app

### Gaps Summary

No automated gaps found. All 5 roadmap success criteria are satisfied at the code level. All 3 requirement IDs (ADMIN-01, ADMIN-03, FIX-01) have full implementation evidence. Status is `human_needed` because the phase delivers interactive UI behavior that cannot be fully verified without running the Electron app.

---

_Verified: 2026-04-20T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
