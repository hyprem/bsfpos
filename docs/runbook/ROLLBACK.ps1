# docs/runbook/ROLLBACK.ps1
#
# Restores explorer.exe as the default shell for the kiosk user, disables
# AutoAdminLogon, and optionally removes the kiosk user. Use in case of a
# broken kiosk state where the operator cannot exit to the admin account.
#
# Run from the admin maintenance account as Administrator.

#Requires -RunAsAdministrator

param(
    [string]$KioskUsername = "bsfkiosk",
    [switch]$RemoveUser
)

Write-Host "=== Bee Strong POS — Rollback ===" -ForegroundColor Cyan

# 1. Disable AutoAdminLogon
$wl = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty -Path $wl -Name "AutoAdminLogon" -Value "0" -Type String
Remove-ItemProperty -Path $wl -Name "DefaultPassword" -ErrorAction SilentlyContinue
Write-Host "AutoAdminLogon disabled and DefaultPassword cleared." -ForegroundColor Green

# 2. Restore per-user Shell to explorer.exe
$user = Get-LocalUser -Name $KioskUsername -ErrorAction SilentlyContinue
if ($user) {
    $sid = $user.SID.Value
    $hivePath = "Registry::HKU\$sid\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
    $weLoaded = $false
    if (-not (Test-Path $hivePath)) {
        $ntuserDat = "C:\Users\$KioskUsername\NTUSER.DAT"
        if (Test-Path $ntuserDat) {
            reg load "HKU\$sid" $ntuserDat | Out-Null
            $weLoaded = $true
        }
    }
    if (Test-Path $hivePath) {
        Set-ItemProperty -Path $hivePath -Name "Shell" -Value "explorer.exe" -Type String
        Write-Host "Per-user Shell restored to explorer.exe for $KioskUsername." -ForegroundColor Green
    }
    if ($weLoaded) {
        [gc]::Collect(); Start-Sleep 1
        reg unload "HKU\$sid" | Out-Null
    }
}

# 3. Optionally remove the kiosk user
if ($RemoveUser -and $user) {
    Remove-LocalUser -Name $KioskUsername
    Write-Host "Kiosk user $KioskUsername removed." -ForegroundColor Green
}

Write-Host "`nRollback complete. Reboot to verify." -ForegroundColor Cyan
