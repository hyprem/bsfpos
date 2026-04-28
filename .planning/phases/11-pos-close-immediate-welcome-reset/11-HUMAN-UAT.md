---
status: partial
phase: 11-pos-close-immediate-welcome-reset
source: [11-VERIFICATION.md]
started: 2026-04-28T11:05:00Z
updated: 2026-04-28T11:05:00Z
---

## Current Test

[awaiting human testing — next kiosk visit]

## Tests

### 1. Closing POS over Magicline → dismiss → closed-welcome immediate
expected: Admin opens admin menu over the Magicline cash-register page and taps "POS schliessen". After dismissing the admin menu, the closed-welcome layer is visible IMMEDIATELY (no 60s wait). Status pill shows "POS geschlossen".
result: [pending]

### 2. No one-frame "open"-state flash before closed-welcome paints
expected: Welcome layer paints directly in closed-state markup; no transient "POS open" visual frame between dismiss and the final closed-welcome paint. (D-01 ordering rationale: pos-state-changed IPC must precede hardReset.)
result: [pending]

### 3. Open-direction asymmetry — opening POS does NOT trigger reset
expected: Admin opens POS via admin menu while closed-welcome layer is foregrounded. On dismiss, status changes to "POS geöffnet". NO welcome reset / splash animation fires (D-02). The existing welcome layer simply updates in place to the open state.
result: [pending]

### 4. Rapid 3x close cycle does NOT trigger loop-detection error overlay
expected: Admin rapidly toggles POS open→close→open→close (3 close cycles in <60s). Loop-detection error overlay does NOT appear. The reset-loop guard correctly excludes pos-closed from the countable counter (D-05 unit test passes; this row confirms lived experience).
result: [pending]

### 5. updateGate post-reset install path composes after pos-closed reset
expected: After admin closes POS and dismisses, a subsequent updateGate-eligible event (admin-closed-window trigger) installs a pending update. The pos-closed reset's onPostReset fires and the install path proceeds — same composition as sale-completed (D-06 unit test passes; this row covers end-to-end with a real pending update).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
