@echo off
setlocal enableextensions
cd /d "%~dp0"

echo ================================================================
echo   Bee Strong POS - Phase 3 Kiosk Probes
echo ================================================================
echo.
echo   This script runs two hardware-dependent probes for Plan 03-09:
echo     * Probe C: scrypt CPU benchmark
echo     * Probe A: TabTip touch-keyboard locate + manual launch
echo.
echo   Results are written to phase3-kiosk-probes-results.txt in this
echo   folder. Copy that file back to the dev machine when done.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ================================================================
  echo   ERROR: Node.js is not installed or not in PATH.
  echo ================================================================
  echo.
  echo   Install Node.js LTS from https://nodejs.org
  echo   Default installer options are fine.
  echo   After installation, close this window and re-run run-probes.cmd.
  echo.
  pause
  exit /b 1
)

echo   Node:
node --version
echo.

node phase3-kiosk-probes.js

echo.
echo ================================================================
echo   Probes complete. Press any key to close this window.
echo ================================================================
pause >nul
endlocal
