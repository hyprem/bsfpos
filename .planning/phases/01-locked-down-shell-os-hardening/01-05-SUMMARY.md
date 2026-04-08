---
phase: 01-locked-down-shell-os-hardening
plan: 05
subsystem: os-hardening-runbook
tags: [runbook, windows, registry, gpo, kiosk-lockdown, powershell]
requires: [01-01]
provides: [SHELL-05, docs/runbook]
affects: []
tech-stack:
  added: [powershell, windows-registry]
  patterns: [docs-as-code, idempotent-scripts, numbered-run-order]
key-files:
  created:
    - docs/runbook/README.md
    - docs/runbook/01-create-kiosk-user.ps1
    - docs/runbook/02-registry-hardening.reg
    - docs/runbook/03-custom-shell-winlogon.reg
    - docs/runbook/04-gpo-hardening.ps1
    - docs/runbook/05-verify-lockdown.ps1
    - docs/runbook/BREAKOUT-CHECKLIST.md
    - docs/runbook/ROLLBACK.ps1
  modified: []
decisions:
  - D-12 realized: executable scripts (PowerShell + .reg) replace any manual checklist except the 2 unavoidable GUI steps (first login to create NTUSER.DAT, NSIS install under kiosk profile)
  - D-14 realized: Win11 Pro custom-shell path chosen — HKU\<sid>\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell set via hive-load in 04-gpo-hardening.ps1; Shell Launcher v2 and Assigned Access both ruled out
  - D-15 realized: AutoAdminLogon plaintext tradeoff documented explicitly in both 01-create-kiosk-user.ps1 header and README §D-15 with the four mitigating factors
metrics:
  duration: ~4 min
  tasks: 2
  files: 8
  completed: 2026-04-08
---

# Phase 1 Plan 5: Windows 11 Pro OS Hardening Runbook Summary

Reproducible script-driven OS hardening runbook (PowerShell + .reg) that brings a fresh Windows 11 Pro device to a locked-down kiosk state using the custom-shell Winlogon fallback, with automated verification, a breakout checklist, and a rollback script.

## What Was Built

`docs/runbook/` now contains 8 files covering the full kiosk provisioning lifecycle for a Win11 Pro device:

1. **`01-create-kiosk-user.ps1`** — Creates the `bsfkiosk` standard local user (explicitly removes from Administrators if present, defense against T-05-08), configures AutoAdminLogon with plaintext `DefaultPassword` per D-15. Idempotent — re-runnable after partial failures.

2. **`02-registry-hardening.reg`** — Disables every known OS-level escape vector: edge swipes (`AllowEdgeSwipe=0`), Win-key combos (`NoWinKeys`, `NoRun`, `NoClose`, `NoDesktop`), Task Manager (`DisableTaskMgr`), Lock Workstation (`DisableLockWorkstation`), Action Center (`NoNotificationCenter`), Cortana, Game Bar, Windows Ink. Re-importable after Windows feature updates (D-14 pitfall).

3. **`03-custom-shell-winlogon.reg`** — Marks `bsfkiosk` in `SpecialAccounts\UserList` so the kiosk account is hidden from the Windows login picker. Documents the per-user Shell override approach (actual HKU Shell key is set from PowerShell because it depends on the user SID).

4. **`04-gpo-hardening.ps1`** — Resolves the kiosk user SID via `Get-LocalUser`, loads `NTUSER.DAT` via `reg load` if the hive isn't already mounted, sets `HKU\<sid>\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell` to the installed `Bee Strong POS.exe` path, and unloads the hive afterwards. This is the D-14 Pro-SKU custom-shell mechanism.

5. **`05-verify-lockdown.ps1`** — Read-only probe script that tests 9 criteria (user exists, AutoAdminLogon, DefaultUserName, AllowEdgeSwipe, NoWinKeys, DisableTaskMgr, NoNotificationCenter, exe installed, Startup shortcut) and reports PASS/FAIL per line with non-zero exit code on any failure. Suitable for RDP maintenance runs and the post-Windows-update recovery flow.

6. **`ROLLBACK.ps1`** — Restores `explorer.exe` as the kiosk user's Shell, disables AutoAdminLogon, clears `DefaultPassword`, and optionally removes the kiosk user (`-RemoveUser`). Escape hatch if the kiosk becomes unreachable (e.g. the Phase 5 admin PIN exit also fails).

7. **`README.md`** — Run-order table (9 numbered steps including the 2 unavoidable GUI steps), D-15 plaintext tradeoff rationale with four mitigating factors, recommended OS hardening (BitLocker first), post-Windows-update recovery procedure, rollback pointer, and a Future: Enterprise path note in case the device is upgraded.

8. **`BREAKOUT-CHECKLIST.md`** — Concrete per-vector manual verification list sourced from `github.com/ikarus23/kiosk-mode-breakout` + Electron #40159 + 01-RESEARCH.md. Covers: keyboard chords (Alt+F4/Tab/Esc, F11, Esc, Ctrl+W, Ctrl+R/F5, Ctrl+Shift+I/F12, Ctrl+P, Win/Win+D/R/L/Tab/E/I/G, Ctrl+Shift+Esc, Ctrl+Alt+Del), touchscreen edge swipes (left/right/top/bottom), mouse hot corners, USB/Wi-Fi integration, double-launch single-instance verification, recovery paths, and a post-Windows-update re-verification block.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create runbook scripts (PowerShell + .reg) | 3d5a68f | 01-create-kiosk-user.ps1, 02-registry-hardening.reg, 03-custom-shell-winlogon.reg, 04-gpo-hardening.ps1, 05-verify-lockdown.ps1, ROLLBACK.ps1 |
| 2 | Create runbook README and BREAKOUT-CHECKLIST | d9e1283 | README.md, BREAKOUT-CHECKLIST.md |

## Deviations from Plan

None — plan executed exactly as written. All 8 files match the plan's literal content blocks. Both automated verification probes exited 0 on first run.

## Threat Model Coverage

All STRIDE entries in the plan's threat register are mitigated as planned:

- **T-05-01** (Task Manager): `DisableTaskMgr=1` in 02-registry-hardening.reg + verified in 05-verify-lockdown.ps1
- **T-05-02** (Run dialog): `NoRun=1` + `NoWinKeys=1`
- **T-05-03** (Action Center edge swipe): `AllowEdgeSwipe=0` + `NoNotificationCenter=1`
- **T-05-04** (Win+D desktop escape): `NoWinKeys=1` + custom shell replaces explorer.exe
- **T-05-05** (plaintext password disclosure): **Accepted** per D-15, documented in README + script header
- **T-05-06** (Windows Update resets shell): README §Post-Windows-Update recovery + idempotent re-runnable scripts
- **T-05-07** (partial-state crashes): every script checks existing state before writing; ROLLBACK.ps1 baseline
- **T-05-08** (accidental admin group): 01-create-kiosk-user.ps1 explicitly checks and removes
- **T-05-09** (power button): **Accepted** — next boot reaches kiosk state automatically

## Success Criteria

- [x] All tasks in 01-05-PLAN.md executed
- [x] Each task committed individually (3d5a68f, d9e1283)
- [x] docs/runbook/README.md explains the numbered script order (9-row run-order table)
- [x] All .reg files are idempotent and re-applicable after Windows feature updates (explicit D-14 comment at the top of 02 and 03)
- [x] BREAKOUT-CHECKLIST.md covers known escape vectors (Win+D, Win+Tab, edge swipes, Ctrl+Alt+Del menu)
- [x] ROLLBACK.ps1 reverses the lockdown changes (explorer.exe shell + AutoAdminLogon disabled + optional user removal)

## Known Stubs

None. All files are complete, concrete, and operator-ready. No placeholders, no TODOs in runbook content.

## Notes for Future Phases

- Phase 5 will wire the admin PIN exit hotkey (`Ctrl+Shift+F12`) — the breakout checklist already references this as the ONE intended escape path.
- Post-install, the runbook instructs the operator to run the NSIS installer as the `bsfkiosk` user so the exe lands in that user's `%LocalAppData%`. If a future refactor moves to a machine-wide install, `04-gpo-hardening.ps1`'s default `$AppExePath` needs updating.
- A v2 improvement: turn `05-verify-lockdown.ps1` into a scheduled task that runs at boot and logs failures to Windows Event Log, so a reset by Windows Update is detected within one reboot cycle rather than on the next physical visit.

## Self-Check: PASSED

- `docs/runbook/01-create-kiosk-user.ps1` — FOUND
- `docs/runbook/02-registry-hardening.reg` — FOUND
- `docs/runbook/03-custom-shell-winlogon.reg` — FOUND
- `docs/runbook/04-gpo-hardening.ps1` — FOUND
- `docs/runbook/05-verify-lockdown.ps1` — FOUND
- `docs/runbook/ROLLBACK.ps1` — FOUND
- `docs/runbook/README.md` — FOUND
- `docs/runbook/BREAKOUT-CHECKLIST.md` — FOUND
- Commit `3d5a68f` — FOUND
- Commit `d9e1283` — FOUND
