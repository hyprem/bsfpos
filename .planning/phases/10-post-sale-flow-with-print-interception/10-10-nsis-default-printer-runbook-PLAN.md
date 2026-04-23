---
phase: 10-post-sale-flow-with-print-interception
plan: 10
type: execute
wave: 1
depends_on: []
files_modified:
  - build/installer.nsh
  - docs/runbook/default-printer-setup.md
autonomous: false
requirements: [SALE-01]
tags: [installer, nsis, powershell, runbook, default-printer, phase-10]
user_setup:
  - service: windows-printing
    why: "Set Microsoft Print to PDF as the default printer on the bsfkiosk Windows user so any print that escapes the window.print JS override goes to a silent PDF sink rather than a physical printer (D-14/D-15)."
    env_vars: []
    dashboard_config:
      - task: "Verify Microsoft Print to PDF is installed on the kiosk (Settings → Devices → Printers)"
        location: "Windows 11 Settings app"
      - task: "Disable 'Let Windows manage my default printer' (done automatically by the NSIS installer via HKCU LegacyDefaultPrinterMode=1)"
        location: "Windows 11 Settings → Printers & scanners"
must_haves:
  truths:
    - "NSIS installer sets Microsoft Print to PDF as default printer for the installing user (bsfkiosk) via HKCU + CIM SetDefaultPrinter"
    - "LegacyDefaultPrinterMode=1 is written to HKCU to prevent Windows 11 from auto-switching the default printer"
    - "Installer exits successfully whether or not the printer setup succeeds (non-blocking)"
    - "Runbook documents manual one-time command + admin-menu diagnostic for verification (D-15 backstop)"
  artifacts:
    - path: "build/installer.nsh"
      provides: "PowerShell post-install step inside !macro customInstall"
      contains: "Microsoft Print to PDF"
    - path: "docs/runbook/default-printer-setup.md"
      provides: "Manual fallback command + verification checklist"
      contains: "Microsoft Print to PDF"
  key_links:
    - from: "build/installer.nsh !macro customInstall"
      to: "PowerShell script invocation via ExecWait"
      via: "temp .ps1 file write + execute + delete"
      pattern: "bsk-set-printer.ps1"
---

<objective>
Configure Microsoft Print to PDF as the default printer for the bsfkiosk Windows user via an NSIS post-install PowerShell step (D-14). This is defense-in-depth: the `window.print` JS override in Plan 03 prevents Chrome print preview from opening, but if Magicline ever calls print via a path that bypasses the override (iframe, worker), the default-printer setting ensures the print job goes to a silent PDF sink rather than a physical printer that would print receipts the member can see.

RESEARCH REFERENCE: RESEARCH §2-3 confirmed (a) the filename-prompt in Microsoft Print to PDF cannot be suppressed via registry (it's by design), but this is a non-issue because the JS override prevents print preview from rendering in the first place; (b) `!macro customInstall` is the correct NSIS hook point; (c) CIM `SetDefaultPrinter` avoids port-name guessing (`Ne00:`) risk; (d) temp-file `.ps1` write avoids NSIS inline-escaping fragility (RISK-05).

Output: Extended `!macro customInstall` in `build/installer.nsh` + a new `docs/runbook/default-printer-setup.md` documenting the manual fallback per D-15. This plan also includes a human checkpoint to TEST the installer on a fresh Win 11 VM or the actual kiosk hardware because NSIS inline-PowerShell escaping cannot be fully verified without a live installer run.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md
@./CLAUDE.md

<interfaces>
Existing build/installer.nsh (verbatim):
```
!macro customInstall
  SetShellVarContext current
  CreateShortCut "$SMSTARTUP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0
  DetailPrint "Startup shortcut created: $SMSTARTUP\${PRODUCT_NAME}.lnk"
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$SMSTARTUP\${PRODUCT_NAME}.lnk"
  DetailPrint "Startup shortcut removed: $SMSTARTUP\${PRODUCT_NAME}.lnk"
!macroend
```

Notes verified:
- electron-builder `perMachine: false` → NSIS runs as current user (bsfkiosk on the kiosk)
- `SetShellVarContext current` is already on line 13 — HKCU writes target the installing user's hive
- No signing config in package.json; installer is unsigned (pre-existing condition)

Required behavior (RESEARCH §2 + §3):
1. Write LegacyDefaultPrinterMode = 1 (DWord) to HKCU\Software\Microsoft\Windows NT\CurrentVersion\Windows
2. Invoke CIM SetDefaultPrinter on Win32_Printer matching Name='Microsoft Print to PDF'
3. Both steps wrapped in try/catch so installer continues on failure (non-blocking — runbook fallback per D-15)

Admin diagnostics row for "Standarddrucker" is DEFERRED to a later polish pass (per CONTEXT.md Claude's Discretion — the planner judgment is: runbook + NSIS is sufficient for v1.1; diagnostics row adds ~10 lines but isn't blocking). If you choose to include it, add it as a follow-up quick task rather than in this plan.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend build/installer.nsh customInstall macro with default-printer PowerShell step</name>
  <read_first>
    - build/installer.nsh (current — verify the existing `!macro customInstall` block structure and that `SetShellVarContext current` is already present)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md §3 (exact recommended PowerShell snippet using the temp-file strategy per RISK-05 resolution)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §installer.nsh (exact insertion block)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-14/D-15 (NSIS primary + runbook fallback)
  </read_first>
  <files>build/installer.nsh</files>
  <action>
Extend `!macro customInstall` in `build/installer.nsh` to write a temp PowerShell script that configures Microsoft Print to PDF as default printer, execute it, and delete it. Use the temp-file strategy per RESEARCH §3 RISK-05 resolution (avoids NSIS inline-escaping fragility).

**Find this exact block:**
```
!macro customInstall
  SetShellVarContext current
  CreateShortCut "$SMSTARTUP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0
  DetailPrint "Startup shortcut created: $SMSTARTUP\${PRODUCT_NAME}.lnk"
!macroend
```

**Replace with (the original two functional lines stay; new block is appended before `!macroend`):**
```
!macro customInstall
  SetShellVarContext current
  CreateShortCut "$SMSTARTUP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0
  DetailPrint "Startup shortcut created: $SMSTARTUP\${PRODUCT_NAME}.lnk"

  ; Phase 10 D-14: Set Microsoft Print to PDF as default printer for bsfkiosk.
  ; Defense-in-depth — the inject.js window.print override prevents Chrome's
  ; print preview from ever rendering, but if Magicline calls print via a
  ; path that bypasses the override (iframe / worker / sandboxed frame), this
  ; default-printer setting routes the escaping print job to a silent PDF
  ; sink rather than a physical receipt printer.
  ;
  ; Writes a temp PS1 to $TEMP to avoid NSIS inline-PowerShell string-escaping
  ; fragility (RISK-05 in 10-RESEARCH.md). perMachine:false + SetShellVarContext
  ; current (line above) ensure HKCU writes target the installing user hive.
  ;
  ; Non-blocking — installer continues and exits cleanly even if printer setup
  ; fails. Runbook fallback (D-15) covers the failure case.
  DetailPrint "Phase 10: Setting Microsoft Print to PDF as default printer..."
  FileOpen $0 "$TEMP\bsk-set-printer.ps1" w
  FileWrite $0 "try {$\r$\n"
  FileWrite $0 "  Set-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows' -Name 'LegacyDefaultPrinterMode' -Value 1 -Type DWord -Force -ErrorAction Stop$\r$\n"
  FileWrite $0 "  $$p = Get-CimInstance -Class Win32_Printer -Filter 'Name=''Microsoft Print to PDF''' -ErrorAction Stop$\r$\n"
  FileWrite $0 "  if ($$p) { Invoke-CimMethod -InputObject $$p -MethodName SetDefaultPrinter -ErrorAction Stop | Out-Null }$\r$\n"
  FileWrite $0 "  Write-Host 'OK'$\r$\n"
  FileWrite $0 "} catch {$\r$\n"
  FileWrite $0 "  Write-Host ('FAIL: ' + $$_.Exception.Message)$\r$\n"
  FileWrite $0 "  exit 0$\r$\n"  ; exit 0 so NSIS ExecWait does not flag a failure
  FileWrite $0 "}$\r$\n"
  FileClose $0
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$TEMP\bsk-set-printer.ps1"' $1
  Delete "$TEMP\bsk-set-printer.ps1"
  DetailPrint "Printer setup exit code: $1"
!macroend
```

**Critical:**
- Use `$\r$\n` (NSIS escape for CRLF) in the FileWrite calls — PowerShell on Windows expects CRLF line endings in .ps1 files.
- Use `$$` to emit a literal `$` in NSIS FileWrite strings — e.g. `$$p` becomes `$p` in the final PS1 file. If you used a single `$`, NSIS would interpret it as a variable reference.
- Single-quoted PS strings for the HKCU path and CIM filter — avoids escape headaches. The nested single-quotes `'Name=''Microsoft Print to PDF'''` are PowerShell's escape for a literal single-quote (double-up the `'`).
- `exit 0` in the PS catch block ensures the NSIS ExecWait exit code is 0 on PowerShell-side failure — the installer continues cleanly. The DetailPrint line captures the actual exit code in `$1` for the installer log.
- `$0` and `$1` are NSIS general-purpose registers (NOT function parameters).
- `Out-Null` silences the CIM method's return object (prevents spurious output in the installer detail log).
- Do NOT modify `!macro customUnInstall` — unset on uninstall is not required (leaving the default printer as Microsoft Print to PDF is harmless; per D-15 the admin can set a different default manually if needed).
- Do NOT prompt for elevation (`UAC` macros) — perMachine:false + HKCU writes do not require admin rights.
- Do NOT write to HKLM — user-scope only.
  </action>
  <verify>
    <automated>grep -q "Microsoft Print to PDF" build/installer.nsh &amp;&amp; grep -q "LegacyDefaultPrinterMode" build/installer.nsh &amp;&amp; grep -q "SetDefaultPrinter" build/installer.nsh &amp;&amp; grep -q "bsk-set-printer.ps1" build/installer.nsh &amp;&amp; grep -q "ExecWait" build/installer.nsh &amp;&amp; grep -q "Delete \"\$TEMP" build/installer.nsh</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `Microsoft Print to PDF`
    - File contains exact substring `LegacyDefaultPrinterMode`
    - File contains exact substring `SetDefaultPrinter`
    - File contains exact substring `bsk-set-printer.ps1`
    - File contains exact substring `ExecWait`
    - File contains exact substring `Delete "$TEMP\bsk-set-printer.ps1"`
    - File contains exact substring `Phase 10 D-14`
    - File does NOT contain `HKLM` (no machine-wide writes)
    - File does NOT contain `UAC` macros or `RequestExecutionLevel admin` (no elevation)
    - Existing `SetShellVarContext current` and `CreateShortCut` calls are preserved in customInstall
    - `!macro customUnInstall` is unchanged
    - The new PS1 write uses CRLF line endings via `$\r$\n` (grep-able: `grep -c "\\$\\\\r\\$\\\\n" build/installer.nsh` returns >= 7)
  </acceptance_criteria>
  <done>
    NSIS customInstall extended with PowerShell temp-file default-printer step. Existing shortcut creation preserved. customUnInstall unchanged. Writes to HKCU only (no elevation needed).
  </done>
</task>

<task type="auto">
  <name>Task 2: Create docs/runbook/default-printer-setup.md</name>
  <read_first>
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-14/D-15 (runbook fallback rationale)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md §3 Runbook Fallback
    - ls docs/runbook/ (verify the directory exists — if not, create it)
  </read_first>
  <files>docs/runbook/default-printer-setup.md</files>
  <action>
Create `docs/runbook/default-printer-setup.md` with the manual fallback command (D-15). This is the runbook admins use when the NSIS installer cannot be re-run (e.g. existing 0.1.x installs that shipped before Phase 10 landed) OR when the NSIS PowerShell step fails for any reason.

If the `docs/runbook/` directory does not exist, create it first. Check: `ls docs/runbook/ 2>/dev/null`. If the command shows a directory listing, the directory exists. If it errors, create it via `mkdir -p docs/runbook`.

**Exact file contents (create verbatim):**

```
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
```

**Critical:**
- The PowerShell commands in the runbook use DOUBLE-quoted strings (`"Name='Microsoft Print to PDF'"`) rather than the escaped-single-quote form — this is the idiomatic PowerShell style for a human-readable runbook. The NSIS variant in Task 1 uses escaped-single-quotes because PS1 file escaping is different.
- Markdown structure: H1 title, prerequisites section, one primary command block, verification section, failure-mode table, related files, change log.
- Keep it concise — the kiosk admin is reading this over RDP under pressure; skip any non-essential context.
- No German strings needed here — runbook is for admin use.
  </action>
  <verify>
    <automated>test -f docs/runbook/default-printer-setup.md &amp;&amp; grep -q "Microsoft Print to PDF" docs/runbook/default-printer-setup.md &amp;&amp; grep -q "LegacyDefaultPrinterMode" docs/runbook/default-printer-setup.md &amp;&amp; grep -q "bsfkiosk" docs/runbook/default-printer-setup.md</automated>
  </verify>
  <acceptance_criteria>
    - File `docs/runbook/default-printer-setup.md` exists
    - File contains exact substring `Microsoft Print to PDF`
    - File contains exact substring `LegacyDefaultPrinterMode`
    - File contains exact substring `bsfkiosk`
    - File contains exact substring `Set-ItemProperty`
    - File contains exact substring `Invoke-CimMethod`
    - File contains a `## Verification` section
    - File contains a `## Failure modes` section with a markdown table
    - File length is between 40 and 150 lines (concise)
    - No trailing whitespace, no raw Unicode that isn't intentional
  </acceptance_criteria>
  <done>
    Runbook file created. Manual PowerShell command, verification, and failure-mode table all present. Admin can execute the command over RDP without further instruction.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human checkpoint — verify NSIS installer executes the PowerShell step successfully</name>
  <what-built>
    - NSIS customInstall macro writes a temp PS1 to $TEMP, executes it via ExecWait, deletes the temp file
    - PS1 sets LegacyDefaultPrinterMode=1 (HKCU) and invokes CIM SetDefaultPrinter on Microsoft Print to PDF
    - Non-blocking: PS catch block suppresses failures, installer exits cleanly
    - Runbook at docs/runbook/default-printer-setup.md for admin-triggered manual fallback
  </what-built>
  <how-to-verify>
    **Why this checkpoint exists:** NSIS inline-file-write escaping (FileWrite with `$\r$\n` and `$$`) and PowerShell single-quote escaping interact in subtle ways that cannot be fully verified offline. A live installer run against a fresh Windows user profile OR the actual bsfkiosk user on the kiosk is required to confirm:
    1. The PS1 file writes correctly (all escapes resolve)
    2. PowerShell executes without a parse error
    3. The CIM method succeeds (Microsoft Print to PDF is found and set as default)
    4. LegacyDefaultPrinterMode=1 lands in HKCU
    5. The temp file is deleted after execution
    6. Installer continues and completes cleanly even if the PS step fails

    **Step 1 — Build the installer locally:**
    ```
    npm run build   # or the existing electron-builder command in package.json
    ```
    Artifact: `dist/bsfpos-Setup-<version>.exe` (or similar — check package.json)

    **Step 2 — Test on a Windows 11 VM OR on the actual kiosk (NOT your dev machine):**
    a. Copy the installer to a fresh Win 11 VM OR to the bsfkiosk user's Downloads folder via RDP
    b. Before running: open PowerShell as bsfkiosk and record the current default printer:
       ```
       (Get-CimInstance -Class Win32_Printer | Where-Object { $_.Default }).Name
       ```
       Record this value so you can compare post-install.
    c. Run the installer
    d. When the installer completes, verify the default printer changed:
       ```
       (Get-CimInstance -Class Win32_Printer | Where-Object { $_.Default }).Name
       # Expected: Microsoft Print to PDF
       ```
    e. Verify LegacyDefaultPrinterMode:
       ```
       Get-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows' -Name LegacyDefaultPrinterMode
       # Expected: LegacyDefaultPrinterMode : 1
       ```
    f. Verify the temp PS1 was deleted:
       ```
       Test-Path "$env:TEMP\bsk-set-printer.ps1"
       # Expected: False
       ```

    **Step 3 — Check the NSIS installer detail log for the DetailPrint output:**
    The installer UI detail panel (or the uninstaller log at `$INSTDIR\Uninstall *.exe.log` if electron-builder keeps one) should show:
    - `Phase 10: Setting Microsoft Print to PDF as default printer...`
    - `Printer setup exit code: 0`

    If the exit code is non-zero, investigate:
    - PS1 parse error → inspect the written PS1 content by running the installer with `/D=$TEMP\bsk-install-debug` and capturing the file BEFORE it's deleted (add a temporary DetailPrint + pause to the nsh for this run only)
    - PowerShell execution policy → the `-ExecutionPolicy Bypass` flag should handle this; if it doesn't, the bsfkiosk user may have a group-policy override that forbids even bypass

    **Step 4 — Test failure tolerance:**
    a. Uninstall Microsoft Print to PDF (Control Panel → Programs → Turn Windows features on or off → untick "Microsoft Print to PDF")
    b. Re-run the installer
    c. Expected: installer completes cleanly, detail log shows exit code 0 (PS catch branch swallowed the error)
    d. Re-enable the Windows feature after testing

    **Step 5 — Test the runbook manual command:**
    a. With Microsoft Print to PDF installed and SOMETHING ELSE set as default
    b. Run the PowerShell snippet from `docs/runbook/default-printer-setup.md` verbatim
    c. Verify default printer changes to Microsoft Print to PDF
    d. Verify the runbook's failure-mode table commands (LegacyDefaultPrinterMode read, spooler start) work as described

    **Step 6 — Report:**
    In the resume message, confirm:
    - [ ] Installer executed PowerShell step successfully on the test VM / kiosk
    - [ ] Default printer changed to Microsoft Print to PDF
    - [ ] LegacyDefaultPrinterMode = 1 confirmed in HKCU
    - [ ] Temp PS1 deleted after execution
    - [ ] Installer non-blocking: succeeds even if Microsoft Print to PDF feature is absent
    - [ ] Runbook manual command works standalone
  </how-to-verify>
  <resume-signal>
    Type "approved" with the six checkboxes checked. If any checkbox fails, describe the failure and we'll either (a) fix the NSIS escape issue, (b) switch from inline PS1 to a distributed-with-installer .ps1 file, or (c) downgrade to runbook-only per D-15.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| NSIS installer → PowerShell execution | Installer invokes PowerShell with `-ExecutionPolicy Bypass`, running as the installing user. |
| PowerShell → HKCU registry + CIM printer method | Writes affect the current user's hive and current user's default-printer setting. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-10-01 | Tampering | Attacker modifies the installer binary to write a malicious PS1 | accept | The installer is downloaded from GitHub Releases (Phase 5 auto-update chain). GitHub HTTPS + SHA256 checksum in electron-updater's latest.yml covers supply-chain integrity. Kiosk admin's RDP session is the trust anchor — same as all other installer content. |
| T-10-10-02 | Privilege escalation | PS runs with user privileges but writes to HKCU | accept | HKCU writes require no elevation and affect only the current user. No HKLM/system-wide changes. Elevation is explicitly NOT requested. |
| T-10-10-03 | DoS | PS step hangs indefinitely, installer never completes | mitigate | ExecWait has no built-in timeout, but CIM `SetDefaultPrinter` is a local RPC call that either returns in ~100ms or fails synchronously. PS try/catch + `exit 0` catch block ensures non-hanging failure. Worst case: installer waits ~1-5 seconds for the CIM call. |
| T-10-10-04 | Information disclosure | PS1 script left on disk contains no secrets | N/A | PS1 content is idempotent configuration only; no credentials, no secrets. Deletion after execution is a cleanliness measure, not a security control. |
| T-10-10-05 | NSIS escape injection | A product name or version string containing NSIS metacharacters breaks the FileWrite block | accept | FileWrite strings are all static literals (no `${PRODUCT_NAME}` in the PS1 content). NSIS metacharacter injection is not a vector. |
| T-10-10-06 | PowerShell escape injection | PS1 contains no user-supplied strings | N/A | Hardcoded literals for printer name, registry path, field name. |
| T-10-10-07 | Repudiation | Silent failure means admin doesn't know printer setup failed | mitigate | DetailPrint outputs exit code to installer detail log. Runbook (Task 2) provides manual verification command. Admin-menu diagnostics row is a follow-up polish candidate. |

**Threat level:** LOW. All writes are HKCU-scoped, no elevation, no user-controlled input in the PS1 content, fail-safe catch block.
</threat_model>

<verification>
- `grep "Microsoft Print to PDF" build/installer.nsh` matches
- `grep "LegacyDefaultPrinterMode" build/installer.nsh` matches
- `test -f docs/runbook/default-printer-setup.md` succeeds
- Human checkpoint passed: installer run on test VM / kiosk sets default printer successfully and cleans up temp file
</verification>

<success_criteria>
- NSIS customInstall extended with temp-file PowerShell approach
- Runbook documents manual fallback command + verification + failure modes
- Non-blocking installer: PS catch swallows failures, installer exits 0
- Human checkpoint confirms the installer actually works on Win 11
- No HKLM writes, no elevation requested
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-10-SUMMARY.md` documenting:
- The NSIS block diff (before/after of customInstall)
- The new runbook file (path + summary of sections)
- Human checkpoint findings:
  - Test environment (VM vs actual kiosk)
  - Exit code observed from installer detail log
  - Verification commands output
  - Any escape bugs encountered and fixes applied
- Note on admin-menu diagnostics row deferral (ship as follow-up quick task if field UAT surfaces verification gaps)
</output>
