---
created: 2026-04-14T08:07:29.637Z
title: Lock Magicline UI to de-DE regardless of Windows display language
area: general
files:
  - src/main/main.js
  - src/inject/inject.js
  - src/inject/fragile-selectors.js
---

## Problem

Observed during the 0.1.1 kiosk visit on 2026-04-14: with Windows in English, Magicline served its UI in English (Electron's `Accept-Language` inherits from the host OS locale). This broke the kiosk in two ways:

1. **Auto-selection click chain failed.** The hardware-fix-#7 sequence from 2026-04-12 (`Kasse auswählen` → `Self-Checkout` → `Speichern`) text-matches German button labels. In English Magicline those labels are different, so the auto-selection never fires and the user lands on a manual register picker.
2. **Welcome cycle stuck at "BITTE WARTEN".** After one successful welcome cycle, the second tap landed on a Magicline error page in English: *"You are not authorized to log in or your account has expired. Please try again."* `inject.js` cannot detect this page (its login-form selectors don't match an error page), so `LOGIN_DETECTED` never fires, the boot watchdog expires, and the welcome loop kicks back in.

Switching Windows display language to German caused Magicline to serve German, the auto-selection ran, and the welcome loop survived 3+ cycles cleanly. So the underlying Phase 6 storage wipe is working — the bug is purely a language confound.

**Practical impact for v1.0:** low. Bee Strong is in Germany and the kiosk Windows install will always be German under the runbook. But the fragility surfaced once already and would surface again after a Windows reimage if someone forgot to set the locale, or after a Windows feature update that resets language preferences.

## Solution

Two-part fix, both in v1.1:

1. **Force Electron locale to de-DE regardless of host OS language.**
   - `app.commandLine.appendSwitch('lang', 'de-DE')` in `src/main/main.js` before `app.whenReady()`.
   - Belt-and-suspenders: override `Accept-Language` on the magicline session via `session.fromPartition('persist:magicline').webRequest.onBeforeSendHeaders(...)` to force `Accept-Language: de-DE,de;q=0.9`.
   - Verify Magicline serves German UI even with English Windows.

2. **Make the auto-selection click chain locale-resilient.**
   - Prefer stable selectors over text matches where possible (e.g. `[data-role="register-select-button"]` if such a selector exists in the Magicline DOM — survey first).
   - For text matches that have to stay, move strings into a single locale lookup table in `src/inject/fragile-selectors.js` so a Magicline language change becomes a one-file update, not a hunt across the codebase.
   - Add a structured log line on auto-selection success/failure so kiosk-visit inspectors can grep `auto-select.result=fail` instead of relying on visual inspection.

**Out of scope for this todo:** detecting the "expired session" English-language error page in `inject.js`. If item 1 above works, the page should never appear because Magicline will always be in German and Phase 6's full storage wipe prevents the error in the first place.
