# docs/runbook/05-verify-lockdown.ps1
#
# Probes the current system state and reports on each lockdown criterion.
# Safe to run at any time (read-only). Must report PASS on every line before
# handing the device to members.

param(
    [string]$KioskUsername = "bsfkiosk"
)

$results = @()

function Test-Criterion {
    param([string]$Name, [scriptblock]$Test)
    try {
        $ok = & $Test
        $status = if ($ok) { "PASS" } else { "FAIL" }
    } catch {
        $status = "ERROR"
    }
    $script:results += [PSCustomObject]@{ Criterion = $Name; Status = $status }
    $color = switch ($status) { "PASS" { "Green" } "FAIL" { "Red" } default { "Yellow" } }
    Write-Host ("{0,-60} {1}" -f $Name, $status) -ForegroundColor $color
}

Write-Host "=== Bee Strong POS Kiosk — Lockdown Verification ===" -ForegroundColor Cyan

Test-Criterion "Local user '$KioskUsername' exists" {
    [bool](Get-LocalUser -Name $KioskUsername -ErrorAction SilentlyContinue)
}

Test-Criterion "AutoAdminLogon is enabled" {
    (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "AutoAdminLogon").AutoAdminLogon -eq "1"
}

Test-Criterion "DefaultUserName = $KioskUsername" {
    (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "DefaultUserName").DefaultUserName -eq $KioskUsername
}

Test-Criterion "Edge swipes disabled (AllowEdgeSwipe = 0)" {
    (Get-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" -Name "AllowEdgeSwipe" -ErrorAction SilentlyContinue).AllowEdgeSwipe -eq 0
}

Test-Criterion "NoWinKeys = 1 for current user" {
    (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" -Name "NoWinKeys" -ErrorAction SilentlyContinue).NoWinKeys -eq 1
}

Test-Criterion "Task Manager disabled (DisableTaskMgr = 1)" {
    (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name "DisableTaskMgr" -ErrorAction SilentlyContinue).DisableTaskMgr -eq 1
}

Test-Criterion "Action Center hidden (NoNotificationCenter = 1)" {
    (Get-ItemProperty "HKCU:\Software\Policies\Microsoft\Windows\Explorer" -Name "NoNotificationCenter" -ErrorAction SilentlyContinue).NoNotificationCenter -eq 1
}

Test-Criterion "Bee Strong POS exe installed" {
    Test-Path "C:\Users\$KioskUsername\AppData\Local\Programs\Bee Strong POS\Bee Strong POS.exe"
}

Test-Criterion "Startup shortcut exists for kiosk user" {
    Test-Path "C:\Users\$KioskUsername\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Bee Strong POS.lnk"
}

Write-Host "`nSummary:"
$results | Format-Table -AutoSize

$fails = ($results | Where-Object { $_.Status -ne "PASS" }).Count
if ($fails -gt 0) {
    Write-Host "$fails check(s) failed. Review BREAKOUT-CHECKLIST.md and re-run the relevant scripts." -ForegroundColor Red
    exit 1
} else {
    Write-Host "All checks passed. Proceed to BREAKOUT-CHECKLIST.md manual vectors." -ForegroundColor Green
    exit 0
}
