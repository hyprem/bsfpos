# docs/runbook/04-gpo-hardening.ps1
#
# Applies the per-user custom shell registry value for the kiosk account,
# plus a handful of local policy tweaks that cannot be expressed in .reg form
# without knowing the user SID ahead of time.
#
# Run as Administrator AFTER 01-create-kiosk-user.ps1 and AFTER installing
# the Bee Strong POS NSIS installer.

#Requires -RunAsAdministrator

param(
    [string]$KioskUsername = "bsfkiosk",
    [string]$AppExePath = ""
)

Write-Host "=== Bee Strong POS — Per-user Shell + GPO Hardening ===" -ForegroundColor Cyan

# --- 1. Resolve kiosk user SID --------------------------------------------

$user = Get-LocalUser -Name $KioskUsername -ErrorAction Stop
$sid = $user.SID.Value
Write-Host "Kiosk user SID: $sid"

# --- 2. Resolve the app exe path (if not provided) ------------------------

if ([string]::IsNullOrEmpty($AppExePath)) {
    $candidate = "C:\Users\$KioskUsername\AppData\Local\Programs\Bee Strong POS\Bee Strong POS.exe"
    if (Test-Path $candidate) {
        $AppExePath = $candidate
    } else {
        Write-Error "App exe not found at $candidate. Install the NSIS installer as the kiosk user first, then re-run with -AppExePath."
        exit 1
    }
}
Write-Host "App exe: $AppExePath"

# --- 3. Load the kiosk user's registry hive if they've never logged in ----

$hivePath = "HKU\$sid"
$hiveLoaded = Test-Path "Registry::$hivePath"
if (-not $hiveLoaded) {
    $ntuserDat = "C:\Users\$KioskUsername\NTUSER.DAT"
    if (Test-Path $ntuserDat) {
        reg load "HKU\$sid" $ntuserDat | Out-Null
        $hiveLoaded = $true
        $weLoaded = $true
        Write-Host "Loaded kiosk user hive from $ntuserDat"
    } else {
        Write-Error "Kiosk user has never logged in and NTUSER.DAT is absent. Log in once as the kiosk user to create the profile, then re-run."
        exit 2
    }
}

# --- 4. Set per-user Shell override ---------------------------------------

$winlogonKey = "Registry::HKU\$sid\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
if (-not (Test-Path $winlogonKey)) {
    New-Item -Path $winlogonKey -Force | Out-Null
}
Set-ItemProperty -Path $winlogonKey -Name "Shell" -Value "`"$AppExePath`"" -Type String
Write-Host "Per-user Shell set: $AppExePath" -ForegroundColor Green

# --- 5. Unload hive if we loaded it ---------------------------------------

if ($weLoaded) {
    [gc]::Collect()
    Start-Sleep -Seconds 1
    reg unload "HKU\$sid" | Out-Null
    Write-Host "Unloaded kiosk user hive."
}

# --- 6. Apply local policy tweaks via secedit ------------------------------

# Disable Ctrl+Alt+Del requirement (optional — tradeoff documented in README)
# Uncomment only if you want to skip the CAD screen entirely:
# Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name "DisableCAD" -Value 1

Write-Host "`n=== Hardening complete ===" -ForegroundColor Cyan
Write-Host "Next: run 05-verify-lockdown.ps1 and review BREAKOUT-CHECKLIST.md." -ForegroundColor Cyan
Write-Host "Reboot the device to apply the shell change." -ForegroundColor Yellow
