# Bee Strong POS Kiosk — OS Hardening Runbook

Scripts and checklists to bring a fresh Windows 11 Pro device to a locked-down
kiosk state for the Bee Strong POS self-service terminal.

## Target platform

- **Windows 11 Pro** (confirmed 2026-04-08). Shell Launcher v2 and Assigned
  Access for Win32 apps are NOT available on Pro, so this runbook uses the
  supported fallback: **per-user custom shell via Winlogon registry**, plus
  AutoAdminLogon + aggressive GPO/registry hardening.
- If the device is ever upgraded to Windows 11 Enterprise/Education/IoT,
  switch to Shell Launcher v2 (cleaner — see §Future: Enterprise path).

## Prerequisites

- Local Administrator account (separate from the kiosk account) for running
  the scripts and for maintenance.
- Bee Strong POS NSIS installer (`Bee Strong POS-Setup-0.1.0.exe`) available
  locally on the device.
- Optional but recommended: **BitLocker enabled** on the system drive before
  running anything below. See §Recommended OS-level hardening.

## Run order

Run on the target device as Administrator. Numbered files are strict order:

| # | File | What it does | Reboot? |
|---|------|--------------|---------|
| 1 | `01-create-kiosk-user.ps1` | Creates the `bsfkiosk` local user (standard user, not admin) and configures AutoAdminLogon | No |
| 2 | `02-registry-hardening.reg` | Disables edge swipes, Win keys, Action Center, Task Manager, notifications, Cortana, Game Bar | No |
| 3 | (GUI) | Log in once as `bsfkiosk` to create the user profile (`C:\Users\bsfkiosk\NTUSER.DAT`). Log out. | Yes (log out) |
| 4 | (GUI) | Log back in as Administrator. Run the Bee Strong POS NSIS installer. When prompted for which user to install for, choose **per-user for the kiosk user** (or run the installer while logged in as `bsfkiosk` once — per-user install lands in `C:\Users\bsfkiosk\AppData\Local\Programs\Bee Strong POS\`). | No |
| 5 | `03-custom-shell-winlogon.reg` | Marks the kiosk user with `SpecialAccounts\UserList` flag and documents the per-user Shell approach | No |
| 6 | `04-gpo-hardening.ps1` | Resolves the kiosk user's SID, loads their hive if needed, sets `HKU\<sid>\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell` to the installed exe path | No |
| 7 | `05-verify-lockdown.ps1` | Probes every lockdown criterion and reports PASS/FAIL | No |
| 8 | Manual | Walk through `BREAKOUT-CHECKLIST.md` on the live device | — |
| 9 | Reboot | The device now boots into the kiosk shell | Yes |

## D-15: AutoAdminLogon plaintext password tradeoff

`01-create-kiosk-user.ps1` writes the kiosk password to
`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\DefaultPassword`
in **plaintext**. This is the only way to achieve unattended login on a
standard Windows 11 Pro device without external hardware.

**Accepted because:**
1. The `bsfkiosk` account is a **standard user** with zero sensitive access —
   no Magicline credentials, no email, no customer data.
2. A **separate strong local-admin account** is used for all maintenance and
   is NOT auto-logged-in.
3. The device is **physically located in a staffed gym** — not a public space
   with unattended physical access.
4. **BitLocker** (recommended below) protects the registry at rest from
   someone removing the drive.

The kiosk account password is **NOT** the Magicline credential. Magicline
creds are handled by Phase 3 via Electron `safeStorage` (Windows DPAPI).

## Recommended OS-level hardening (not in scripts — manual)

- [ ] Enable **BitLocker** on the system drive (mitigates registry plaintext at rest)
- [ ] Disable unneeded Windows services via `services.msc`: Windows Update (run manually during maintenance windows), Xbox services, Print Spooler if no printer, etc.
- [ ] Set a strong password on the local admin maintenance account
- [ ] Disable Fast Startup so reboots fully reset state
- [ ] Set Windows Update to "Semi-Annual Channel" and schedule maintenance windows

## Post-Windows-Update recovery (D-14 pitfall)

Windows 11 cumulative updates are **known to reset** custom shell registry values. After any major Windows feature update:

1. Log in as Administrator (not the kiosk account — if the shell is reset, the kiosk account may behave unexpectedly)
2. Re-run `02-registry-hardening.reg` (`reg import`)
3. Re-run `04-gpo-hardening.ps1`
4. Run `05-verify-lockdown.ps1` to confirm all checks pass
5. Reboot and re-walk `BREAKOUT-CHECKLIST.md`

A scheduled task to run `05-verify-lockdown.ps1` at boot and email/log failures is a v2 improvement.

## Rollback

`ROLLBACK.ps1` restores `explorer.exe` as the shell and disables AutoAdminLogon. Use when the kiosk is in a broken state and you cannot reach the Bee Strong admin exit PIN (Phase 5).

## Future: Enterprise path

If the device is upgraded to Win 11 Enterprise / Education / IoT Enterprise, replace `03-custom-shell-winlogon.reg` + `04-gpo-hardening.ps1` with a Shell Launcher v2 PowerShell configuration. The Electron app itself requires no changes. See `.planning/phases/01-locked-down-shell-os-hardening/01-RESEARCH.md` §Windows 11 Kiosk Lockdown Mechanism for the Shell Launcher v2 decision tree.
