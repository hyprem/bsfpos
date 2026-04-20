---
status: partial
phase: 08-admin-menu-polish-reload-fix
source: [08-VERIFICATION.md]
started: 2026-04-20T18:08:05Z
updated: 2026-04-20T18:08:05Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Close button visual and functional test
expected: X button visible in top-right of admin card (44x44 min), Esc key, and Ctrl+Shift+F12 toggle all close admin menu non-destructively — prior layer (welcome or cash register) restored
result: [pending]

### 2. Esc key nesting guard
expected: Esc does NOT close admin menu when a nested overlay (credentials, PIN change, PAT config) is visible — only closes from root admin menu
result: [pending]

### 3. Credentials re-entry mode title
expected: Opening "Anmeldedaten andern" from admin menu shows title "Anmeldedaten andern" (not "Kiosk einrichten") and PIN fields are hidden
result: [pending]

### 4. PIN change end-to-end
expected: Wrong current PIN shows "Falscher PIN", mismatched new PINs shows "PINs stimmen nicht uberein", successful change returns to admin menu, new PIN works on next admin login
result: [pending]

### 5. Kasse nachladen from welcome state (FIX-01)
expected: From welcome screen, admin opens menu and taps "Kasse nachladen" — splash appears, fresh login flow starts, kiosk does NOT wedge
result: [pending]

### 6. PAT lockout persistence
expected: Closing admin menu during PAT lockout does NOT reset lockout countdown on reopen
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
