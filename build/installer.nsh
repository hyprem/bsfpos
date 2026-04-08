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
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$SMSTARTUP\${PRODUCT_NAME}.lnk"
  DetailPrint "Startup shortcut removed: $SMSTARTUP\${PRODUCT_NAME}.lnk"
!macroend
