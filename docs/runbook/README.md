# Bee Strong POS Kiosk — OS Hardening Runbook

Scripts and checklists to bring a fresh Windows 10 Pro or Windows 11 Pro
device to a locked-down kiosk state for the Bee Strong POS self-service
terminal.

## Target platform

- **Windows 10 Pro or Windows 11 Pro** — both are supported by the scripts in
  this directory. All registry keys, GPO paths, and PowerShell cmdlets used
  (`Get-LocalUser`, `HKLM\...\Winlogon`, `HKCU\...\Policies\Explorer`,
  `HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI`, Action Center,
  Ctrl+Alt+Del policies) are identical on both OSes.
- This runbook uses the **per-user custom shell via Winlogon registry**
  approach plus AutoAdminLogon + aggressive GPO/registry hardening. It was
  chosen for Win 11 Pro (which cannot use Assigned Access for classic Win32
  apps) but works equally well on Win 10 Pro.
- **Alternative on Win 10 Pro only:** Win 10 Pro supports Assigned Access for
  classic Win32 apps via `Set-AssignedAccess -UserName bsfkiosk -AppName "Bee Strong POS"`.
  This is a cleaner lockdown than the custom-shell fallback, but the
  custom-shell path already works and is already validated — no reason to
  switch unless you hit a specific issue. Win 11 Pro removed this capability,
  so keeping the custom-shell approach is also portable if the device is
  later upgraded.
- **Windows 10 end-of-support:** Windows 10 reached end of mainstream support
  on **2025-10-14**. The kiosk OS is past EOL as of this runbook's date
  (2026-04-10). See §Windows 10 EOL posture below for the risk acceptance.
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
standard Windows 10 Pro / Windows 11 Pro device without external hardware.

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

Windows cumulative updates (Win 10 and Win 11 both) are **known to reset** custom shell registry values. After any major Windows feature update:

1. Log in as Administrator (not the kiosk account — if the shell is reset, the kiosk account may behave unexpectedly)
2. Re-run `02-registry-hardening.reg` (`reg import`)
3. Re-run `04-gpo-hardening.ps1`
4. Run `05-verify-lockdown.ps1` to confirm all checks pass
5. Reboot and re-walk `BREAKOUT-CHECKLIST.md`

A scheduled task to run `05-verify-lockdown.ps1` at boot and email/log failures is a v2 improvement.

## Rollback

`ROLLBACK.ps1` restores `explorer.exe` as the shell and disables AutoAdminLogon. Use when the kiosk is in a broken state and you cannot reach the Bee Strong admin exit PIN (Phase 5).

## Windows 10 EOL posture

As of 2026-04-10, Windows 10 is **past mainstream end-of-support** (2025-10-14). The Bee Strong POS Kiosk on Win 10 Pro is a conscious risk acceptance, justified by the operating context:

- **Physical location**: staffed gym, not a public unattended space
- **Network exposure**: device reaches only `bee-strong-fitness.web.magicline.com` + GitHub Releases for auto-update; no inbound services, no file shares, no RDP exposed to the internet (RDP restricted to the local maintenance network)
- **Credential isolation**: Magicline creds encrypted via DPAPI under the `bsfkiosk` standard user; admin PIN hashed at rest; no stored member data on the device
- **OS-level lockdown**: custom shell + AutoAdminLogon + aggressive GPO/registry hardening + BitLocker (recommended)
- **Attack surface**: the Electron app is the only non-system process the `bsfkiosk` user can reach, and it loads exactly one external URL

**Options for extending Win 10 security coverage:**

1. **Consumer ESU** ($30/year, through 2026-10-14) — one year of security patches. Low friction, cheap, buys a year to upgrade or replace hardware.
2. **Enterprise ESU** (volume licensing, up to 3 years) — overkill for one device.
3. **Upgrade to Windows 11 Pro** — free if hardware meets requirements: TPM 2.0, Secure Boot capable, 8th-gen Intel / Zen 2 AMD (or newer), 4 GB RAM, 64 GB storage. Check on the kiosk with:
   ```powershell
   winver                              # current OS build
   Get-Tpm                             # TPM 2.0 check
   Confirm-SecureBootUEFI              # Secure Boot check
   (Get-CimInstance Win32_Processor).Name    # CPU check
   ```
   If the hardware is compatible, the Win 11 upgrade is the cleanest long-term path. All scripts in this runbook work unchanged.

**Why this is shippable on Win 10 today:** the app's security model does not depend on OS patch currency — credentials are isolated via DPAPI (which still works correctly on out-of-support Win 10), the network surface is tightly scoped, and physical access is controlled. The primary risk from running EOL Win 10 is unpatched local privilege escalation vulnerabilities, which matter most on multi-user or internet-facing systems — neither applies here. Still, **ESU or Win 11 upgrade within the next six months** is the recommended posture; log any deviation in `.planning/PROJECT.md` and set a reminder to revisit by 2026-10.

## Future: Enterprise path

If the device is upgraded to Win 11 Enterprise / Education / IoT Enterprise, replace `03-custom-shell-winlogon.reg` + `04-gpo-hardening.ps1` with a Shell Launcher v2 PowerShell configuration. The Electron app itself requires no changes. See `.planning/phases/01-locked-down-shell-os-hardening/01-RESEARCH.md` §Windows 11 Kiosk Lockdown Mechanism for the Shell Launcher v2 decision tree.
