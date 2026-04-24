---
status: partial
phase: 10-post-sale-flow-with-print-interception
source: [10-VERIFICATION.md]
started: 2026-04-24T00:00:00Z
updated: 2026-04-24T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Plan 10-03 hardware checkpoint — verify window.print override + cart-empty observer against live Magicline

expected: |
  In DevTools on the live Magicline cash register page (bsfkiosk user, dev mode):
    1. `window.print` evaluates to the override function (NOT native [native code])
    2. Calling `window.print()` emits `BSK_PRINT_INTERCEPTED` to console with NO Chrome print preview
    3. `document.querySelectorAll('[data-role="cart"]').length` returns 1 (or the discovered selector)
    4. Completing a real sale through Kartenzahlung emits `BSK_POST_SALE_FALLBACK` within ~700ms of cart hitting zero
    5. Real cart container `data-role` is documented in 10-CART-SELECTOR-DISCOVERY.md
    6. If discovered selector differs from `[data-role="cart"]` / `[data-role="shopping-cart"]`, inject.js + fragile-selectors.js are updated

why_human: RESEARCH §1 RISK-04 + RISK-02 require live Magicline DOM access. The cart container's
data-role attribute cannot be discovered by static analysis — only by DevTools inspection of the
running Magicline React app. Code committed (9b7b906 + e2d2ead); only on-device verification pending.

result: [pending]

### 2. Plan 10-10 hardware checkpoint — verify NSIS installer sets default printer on Win 11 kiosk

expected: |
  On a fresh Win 11 VM OR the actual bsfkiosk user (not the dev machine):
    1. Build the installer: `npm run build` (or equivalent electron-builder command)
    2. Record current default printer via `(Get-CimInstance -Class Win32_Printer | Where-Object { $_.Default }).Name`
    3. Run installer; confirm installer detail panel shows "Phase 10: Setting Microsoft Print to PDF as default printer..." and "Printer setup exit code: 0"
    4. Re-query default printer; expected output: `Microsoft Print to PDF`
    5. `Get-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows' -Name LegacyDefaultPrinterMode` returns 1
    6. `Test-Path "$env:TEMP\bsk-set-printer.ps1"` returns False (temp file deleted)
    7. Failure-tolerance: uninstall Microsoft Print to PDF feature, re-run installer; installer must still complete cleanly (exit code 0)
    8. Runbook (docs/runbook/default-printer-setup.md) manual command works standalone

why_human: NSIS inline-PowerShell escaping (`$\r$\n` for CRLF, `$$` for literal $, escaped single-quotes
for the CIM filter) cannot be fully verified without an actual installer build + run. PowerShell
execution policy and CIM SetDefaultPrinter behavior are environment-specific to the target
Windows user profile. Code committed (5833cd9 + 0f6cab9); only an installer build + run on the
target hardware can validate the temp-file-write + ExecWait + Delete sequence end-to-end.

result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
