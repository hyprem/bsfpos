# build/installer.nsh
# Custom NSIS macros injected by electron-builder via build.nsis.include.
# Phase 1 plan 04: installs/removes a Startup folder shortcut so the kiosk
# auto-launches on login as one layer of the D-04 belt-and-suspenders pair.
# The runtime layer (app.setLoginItemSettings) is in src/main/main.js.
#
# $SMSTARTUP resolves to the per-user Startup folder
# (%AppData%\Microsoft\Windows\Start Menu\Programs\Startup) when perMachine
# is false, which matches our kiosk account model.
# Ref: electron-userland/electron-builder#1145, electron.build/nsis.html

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
  FileWrite $0 "  exit 0$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileClose $0
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$TEMP\bsk-set-printer.ps1"' $1
  Delete "$TEMP\bsk-set-printer.ps1"
  DetailPrint "Printer setup exit code: $1"
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$SMSTARTUP\${PRODUCT_NAME}.lnk"
  DetailPrint "Startup shortcut removed: $SMSTARTUP\${PRODUCT_NAME}.lnk"
!macroend
