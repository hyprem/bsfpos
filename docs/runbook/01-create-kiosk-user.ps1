# docs/runbook/01-create-kiosk-user.ps1
#
# Creates the dedicated local kiosk user account and configures AutoAdminLogon.
# Run as Administrator on the target Windows 11 Pro device.
#
# SECURITY NOTE (D-15): AutoAdminLogon stores the kiosk account password in
# HKLM\...\Winlogon\DefaultPassword in PLAINTEXT. This is an accepted tradeoff:
#   (a) the kiosk account is a standard user with zero sensitive access
#   (b) a separate strong local-admin account is used for maintenance
#   (c) the device is physically in a staffed gym
#   (d) BitLocker is recommended (see README.md §Recommended OS-level hardening)
# The kiosk account password is NOT the Magicline credential. Magicline creds
# are handled by Phase 3 via Electron safeStorage (DPAPI).

#Requires -RunAsAdministrator

param(
    [string]$KioskUsername = "bsfkiosk",
    [string]$KioskPassword = "ChangeMeOnDevice!2026",
    [string]$KioskFullName = "Bee Strong Kiosk"
)

Write-Host "=== Bee Strong POS — Kiosk User Setup ===" -ForegroundColor Cyan

# --- 1. Create the local kiosk user ---------------------------------------

$existing = Get-LocalUser -Name $KioskUsername -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "User '$KioskUsername' already exists — skipping creation." -ForegroundColor Yellow
} else {
    $securePassword = ConvertTo-SecureString $KioskPassword -AsPlainText -Force
    New-LocalUser -Name $KioskUsername `
                  -Password $securePassword `
                  -FullName $KioskFullName `
                  -Description "Bee Strong POS kiosk autologin account (D-15 plaintext tradeoff)" `
                  -PasswordNeverExpires `
                  -UserMayNotChangePassword | Out-Null
    Write-Host "Created local user '$KioskUsername'." -ForegroundColor Green
}

# Ensure membership in Users (standard), NOT in Administrators.
Add-LocalGroupMember -Group "Users" -Member $KioskUsername -ErrorAction SilentlyContinue
$adminMembers = Get-LocalGroupMember -Group "Administrators" | Select-Object -ExpandProperty Name
if ($adminMembers -match $KioskUsername) {
    Write-Warning "Kiosk user is in Administrators group. Removing."
    Remove-LocalGroupMember -Group "Administrators" -Member $KioskUsername
}

# --- 2. Configure AutoAdminLogon (D-15) -----------------------------------

$wl = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty -Path $wl -Name "AutoAdminLogon"  -Value "1"           -Type String
Set-ItemProperty -Path $wl -Name "DefaultUserName" -Value $KioskUsername -Type String
Set-ItemProperty -Path $wl -Name "DefaultPassword" -Value $KioskPassword -Type String
Set-ItemProperty -Path $wl -Name "DefaultDomainName" -Value $env:COMPUTERNAME -Type String
# Prevent the "click to sign in" lock screen after logout
Set-ItemProperty -Path $wl -Name "ForceAutoLogon" -Value "1" -Type String -ErrorAction SilentlyContinue

Write-Host "AutoAdminLogon configured for '$KioskUsername'." -ForegroundColor Green
Write-Host "DefaultPassword is stored plaintext per D-15 tradeoff." -ForegroundColor Yellow

Write-Host "`nNext: run 02-registry-hardening.reg, then 03-custom-shell-winlogon.reg, then 04-gpo-hardening.ps1." -ForegroundColor Cyan
