---
created: 2026-04-14T09:35:00.000Z
title: Add a close-admin-menu button (Zurück / X) without destructive action
area: general
files:
  - src/host/host.html
  - src/host/host.css
  - src/host/host.js
  - src/main/preload.js
  - src/main/main.js
---

## Problem

Observed during the 0.1.2 kiosk visit on 2026-04-14: the admin menu has no way to dismiss itself without taking an action. The 6 buttons currently are:

- Updates prüfen — stays in admin
- Protokolle anzeigen — opens Explorer, stays in admin
- Kasse nachladen — reloads Magicline, exits admin (but see related todo: this can wedge the kiosk if opened from welcome state)
- Anmeldedaten ändern — goes to credentials overlay
- Auto-Update einrichten — goes to PAT entry overlay
- Beenden — exits the kiosk app entirely (destructive — only useful for full maintenance exits)

If an admin opens the menu just to read the diagnostic header (Version, Letztes Update, Status, Letzter Reset, Auto-Update) and wants to leave without changing anything, the only paths are: (a) tap "Kasse nachladen" (which reloads the Magicline view and may wedge if the view doesn't exist, see related todo), or (b) tap "Beenden" (exits the kiosk entirely, requires AutoAdminLogon to recover). Neither is appropriate for a "I just wanted to check the version" interaction.

There is also no `Esc`-key handler, no overlay-click-outside handler, and no second-press of `Ctrl+Shift+F12` that toggles the menu off (the hotkey is one-way: open).

## Solution

Add a **discreet close button** to the admin menu that simply hides the admin overlay and returns to whatever was rendered behind it (welcome layer OR cash register, depending on the prior state). No reload, no exit, no IPC to main beyond `admin:close`.

### UI

- A small "X" or "Zurück" button in the top-right corner of the admin overlay. Tap target ≥ 44×44 px per BRAND-02. Branded yellow-on-dark or a discreet outlined style — should not look like a primary action.
- Position: top-right, above the diagnostic header.

### IPC

- New IPC: `admin:close` from host → main. Main acknowledges by sending `admin:menu-hide` back to host (or host can hide the layer locally — main only needs to know for audit logging).
- Audit log: `admin.action: action=close-menu at=...` (matches existing `event=admin.action` pattern from `event=admin.action action=check-updates`).

### Edge cases

- **Pressing close while in PAT lockout.** During the lockout panel (P5-07/P5-08), the close button should still work — closing dismisses the lockout panel WITHOUT resetting or extending the lockout countdown. Re-opening admin with `Ctrl+Shift+F12` should resume the existing countdown (the lockout state is persisted in electron-store and survives admin-menu open/close cycles).
- **Pressing close on a nested screen** (Anmeldedaten ändern overlay, Auto-Update einrichten overlay). The close button on the *root* admin menu doesn't apply to nested screens — those screens have their own back/cancel paths. Don't add a global close that bypasses unsaved input on credential or PAT entry screens.
- **Hardware keyboard `Esc` key.** Reuse the same `admin:close` handler. `Esc` is currently swallowed by the keyboard lockdown in production mode, so the host-side handler needs to listen via JavaScript `keydown` while the admin layer is visible (NOT via the OS-level lockdown). Test that `Esc` from the credentials overlay does NOT cascade up and close the admin layer too.
- **Second press of `Ctrl+Shift+F12`.** Optional polish: pressing the admin hotkey while admin is already open should toggle it closed via the same `admin:close` path. Lower priority than the explicit button.

### Tests

- Extend `test/host.test.js` (or whichever host-side test file exists) with a unit test for the `admin:close` handler returning to the prior layer.
- Manual: open admin → tap close → verify return to welcome OR cash register. Open admin → enter wrong PIN x4 → tap close → reopen → countdown still showing.

**Practical impact:** medium. The kiosk is unattended most of the time and admin interactions are rare, but every time an admin opens the menu just to read a diagnostic value, the current UX forces them to take a destructive-ish action to dismiss it. Captured for v1.1 polish.

**Related work:** Related to the v1.1 todo `2026-04-14-kasse-nachladen-from-welcome-leaves-kiosk-stuck-on-splash` — having a working close button reduces the impact of the Kasse-nachladen bug because admins have an alternative dismiss path.
