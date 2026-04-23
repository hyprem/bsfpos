# Default Printer Setup — Runbook

**Phase:** 10 — Post-Sale Flow with Print Interception
**Requirement:** SALE-01
**Audience:** Kiosk admin performing maintenance via RDP / TeamViewer
**Scope:** One-time setup (or post-recovery) of Microsoft Print to PDF as the default printer for the bsfkiosk Windows user

## What this does

Sets Microsoft Print to PDF as the default printer for the currently logged-in
Windows user (bsfkiosk on the kiosk) and disables Windows 11's "let Windows
manage my default printer" behavior so the setting stays put.

## When to run

The Bee Strong POS installer (v0.2.0+) runs this automatically via an NSIS
post-install PowerShell step. You only need to run the manual command below
when:

- Recovering an existing 0.1.x install that predates Phase 10
- Troubleshooting a post-0.2.0 install that did NOT correctly set the printer
  (symptom: Chrome print preview briefly visible on a sale OR a physical
  printer receives a receipt)
- Re-running the setup after a Windows user profile rebuild

## Why it matters

The kiosk overrides `window.print` at the JavaScript level so Chrome's print
preview never opens. But if Magicline ever calls print via a path that
bypasses the override (iframe, worker, sandboxed frame), a print job will
fire. Setting Microsoft Print to PDF as the default printer ensures that
escaping print job goes to a silent PDF sink (a file the user never has to
interact with) rather than a physical receipt printer that would print an
unexpected receipt in front of a member.

## Prerequisites

- RDP or TeamViewer access to the kiosk as the **bsfkiosk** user (NOT a
  different Windows account — default printer is per-user on Windows 11)
- Microsoft Print to PDF is installed (Windows 11 ships with it enabled by
  default; verify via Settings → Printers & scanners → "Microsoft Print to
  PDF" is listed)

## Manual command (PowerShell)

Open PowerShell (no admin needed — HKCU writes only) as the **bsfkiosk** user
and run:

```powershell
Set-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows' `
  -Name 'LegacyDefaultPrinterMode' -Value 1 -Type DWord -Force

$p = Get-CimInstance -Class Win32_Printer -Filter "Name='Microsoft Print to PDF'"
if ($p) {
  Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter
  Write-Host "Default printer set to Microsoft Print to PDF"
} else {
  Write-Host "ERROR: Microsoft Print to PDF printer not found — install it first"
}
```

## Verification

After running the command, verify:

1. Open Settings → Printers & scanners
2. "Microsoft Print to PDF" should appear with a checkmark / "Default" badge
3. The toggle "Let Windows manage my default printer" should be **off**

Alternative verification via PowerShell:
```powershell
(Get-CimInstance -Class Win32_Printer | Where-Object { $_.Default }).Name
# Expected output: Microsoft Print to PDF
```

## Failure modes

| Symptom | Diagnosis | Fix |
|--------|-----------|-----|
| PowerShell says "Microsoft Print to PDF printer not found" | Windows feature not enabled | Control Panel → Programs → Turn Windows features on or off → tick "Microsoft Print to PDF" → OK, then re-run the command |
| Printer change reverts after a few minutes or a reboot | LegacyDefaultPrinterMode not set correctly | Re-run the `Set-ItemProperty` line above; verify via `Get-ItemProperty HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows LegacyDefaultPrinterMode` returns `1` |
| Command errors with "access denied" | Running as wrong user | Switch to the bsfkiosk user via Task Manager → Users, or via a bsfkiosk-logged-in RDP session |
| CIM method fails with RPC error | Windows Spooler service stopped | Start the Print Spooler service: `Start-Service -Name Spooler`, then re-run |

## Related files

- `build/installer.nsh` — NSIS post-install step that runs this automatically on fresh installs
- `src/inject/inject.js` — JavaScript `window.print` override (Phase 10 primary trigger)
- `.planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md §2-3` — full technical rationale

## Change log

- 2026-04-23: Initial runbook — Phase 10 SALE-01
