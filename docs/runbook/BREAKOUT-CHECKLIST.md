# Bee Strong POS Kiosk — Breakout Verification Checklist

Manual verification checklist. Walk through on the **live kiosk device**
after running the hardening scripts and rebooting. Every item must fail to
escape (i.e. nothing should work).

Source for vectors: `github.com/ikarus23/kiosk-mode-breakout` + Electron
issue #40159 + `.planning/phases/01-locked-down-shell-os-hardening/01-RESEARCH.md`
§What CANNOT be suppressed from Electron userspace.

## Keyboard chords (user is a standing member with physical keyboard/touchscreen)

- [ ] **Alt+F4** — does NOT close the window
- [ ] **Alt+Tab** — does NOT show the window switcher
- [ ] **Alt+Esc** — does NOT cycle windows
- [ ] **F11** — does NOT unfullscreen
- [ ] **Escape** — does NOT exit fullscreen, does NOT dismiss splash
- [ ] **Ctrl+W** — does NOT close the window
- [ ] **Ctrl+R / F5** — does NOT reload Magicline (Phase 2 context — test after embed works)
- [ ] **Ctrl+Shift+I / F12** — does NOT open DevTools (in prod build)
- [ ] **Ctrl+P** — does NOT open print dialog
- [ ] **Win key** (bare) — does NOT open Start menu
- [ ] **Win+D** — does NOT show desktop
- [ ] **Win+R** — does NOT open Run dialog (blocked by NoRun reg policy)
- [ ] **Win+L** — does NOT lock the workstation (blocked by DisableLockWorkstation)
- [ ] **Win+Tab** — does NOT open Task View
- [ ] **Win+E** — does NOT open Explorer
- [ ] **Win+I** — does NOT open Settings
- [ ] **Win+G** — does NOT open Game Bar (blocked by GameBar reg policy)
- [ ] **Ctrl+Shift+Esc** — does NOT open Task Manager (blocked by DisableTaskMgr)
- [ ] **Ctrl+Alt+Del** — opens the secure attention screen, BUT only "Sign out" (or nothing) is available; Task Manager, Change Password, Lock are all missing

## Touchscreen gestures

- [ ] **Left edge swipe** — does NOT open Task View (blocked by AllowEdgeSwipe=0)
- [ ] **Right edge swipe** — does NOT open Action Center (blocked by NoNotificationCenter)
- [ ] **Top edge swipe** — does NOT reveal title bar
- [ ] **Bottom edge swipe** — does NOT reveal taskbar
- [ ] **Four-finger tap** / accessibility gestures — no effect

## Mouse / Pointer

- [ ] **Right-click on taskbar area** — no context menu
- [ ] **Right-click on desktop area** (if taskbar momentarily visible) — no context menu
- [ ] **Moving pointer to hot corners** — no Cortana, no charms, no Task View preview

## OS integration

- [ ] **Unplugging and replugging the NFC reader** — the app recovers (Phase 4 will formalize)
- [ ] **Plugging in a USB drive** — no autorun dialog, no Explorer window opens
- [ ] **Connecting to Wi-Fi while kiosk is running** — no system tray icon visible

## Double-launch

- [ ] **Double-click the Startup shortcut manually while the app is already running** — no second window appears
- [ ] **Run the exe from an admin Command Prompt while the kiosk is already running** — second process exits immediately (silently); only one window on screen
- [ ] **Windows Fast User Switching → switch to admin → switch back** — kiosk is still running and focused

## Recovery

- [ ] **Admin PIN hotkey (Phase 5 — Ctrl+Shift+F12)** — opens the admin PIN prompt (this is the ONLY intended exit path)
- [ ] **Remote Desktop from the admin LAN workstation** — login succeeds and admin can reach a PowerShell prompt for maintenance
- [ ] **`05-verify-lockdown.ps1` run via RDP** — reports all PASS

## Post-Windows-Update re-verification

After every Windows cumulative update:

- [ ] Re-import `02-registry-hardening.reg`
- [ ] Re-run `04-gpo-hardening.ps1`
- [ ] Re-run `05-verify-lockdown.ps1`
- [ ] Re-walk this checklist
- [ ] Confirm the kiosk still boots into the Bee Strong POS shell and NOT the Windows desktop

## Known limitations (accepted)

- **Ctrl+Alt+Del secure attention sequence** is a kernel-level Windows security feature and cannot be trapped by any userspace program. Mitigation is to remove all options from the CAD screen (handled by the registry hardening). This is documented as accepted per research.
- **Physical power button** cannot be trapped. A long press will always force-shutdown the device. This is acceptable — the next boot reaches the kiosk state automatically.
- **External monitor attach** via RDP or hot-plug may reveal the secondary desktop. Policy: do not attach external monitors while the kiosk is running; use the admin exit + RDP for maintenance.
