---
status: complete
phase: 06-welcome-screen-lifecycle-redesign
source:
  - 06-01-SUMMARY.md
  - 06-02-SUMMARY.md
  - 06-03-SUMMARY.md
  - 06-04-SUMMARY.md
started: 2026-04-14T07:32:17+02:00
updated: 2026-04-28T11:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start → Welcome Screen
expected: Kill any running kiosk. `npm start`. Splash shows briefly then full-viewport black with yellow "Zum Kassieren tippen" + Bee Strong logo. No Magicline view appears.
result: pass

### 2. Tap Welcome → Magicline Loads
expected: Tap anywhere on the welcome screen. Splash cover appears briefly, then the Magicline cash register renders normally (or credentials overlay on first run).
result: pass

### 3. Idle Countdown Starts at 10
expected: With Magicline loaded and idle, after 60s the "Noch da?" overlay appears and the countdown begins at "10" (not "30"), ticking down each second.
result: pass

### 4. Idle Expiry Returns to Welcome
expected: Let the "Noch da?" countdown run to 0. Magicline view is destroyed and the welcome screen ("Zum Kassieren tippen") reappears as the resting state — not a fresh Magicline page.
result: pass

### 5. Welcome Loop Stability (3 Cycles)
expected: Repeat tap → Magicline → idle → welcome for at least 3 cycles. Each tap produces a clean cash register (empty cart, no error screen). No reset-loop error overlay appears.
result: pass

### 6. Badge Scan on Welcome Is Ignored
expected: While the welcome screen is showing, scan an NFC badge. Nothing happens — the welcome layer stays visible and Magicline does not load from the scan (only a tap triggers login).
result: out_of_scope
reason: NFC member-badge identification descoped from v1.0 (quick 260414-eu9, commit cbc9b59, 2026-04-14). The Deka NFC reader is no longer wired into the welcome flow — there is no "badge scan on welcome" path to verify. May return in v1.2+ pending a fresh permission/identification design.

## Summary

total: 6
passed: 5
issues: 0
pending: 0
out_of_scope: 1
status_note: |
  Closed 2026-04-28: 5 passed at original session 2026-04-14; Test 6 closed
  as out_of_scope because the NFC welcome-badge path was descoped from v1.0
  (quick 260414-eu9, commit cbc9b59). May return in v1.2+ if a fresh
  identification design lands.

## Gaps

[none]
