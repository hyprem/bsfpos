---
created: 2026-04-14T09:36:00.000Z
title: Kasse nachladen from welcome state wedges kiosk on BITTE WARTEN splash
area: general
files:
  - src/main/main.js
  - src/main/magiclineView.js
  - src/main/authFlow.js
  - src/host/host.js
---

## Problem

Reproducible bug found during the 0.1.2 kiosk visit on 2026-04-14:

**Repro steps:**
1. Cold boot kiosk → welcome layer appears (Phase 6 D-03 cold-boot-to-welcome path).
2. Without tapping welcome, press `Ctrl+Shift+F12` → admin menu opens over the welcome layer.
3. Tap any non-action button to dismiss admin (currently the only path that doesn't latch destructive state is "Kasse nachladen").
4. **Expected:** admin menu closes, kiosk returns to welcome layer.
5. **Actual:** admin menu closes, kiosk shows splash with "BITTE WARTEN" text and is stuck there indefinitely. No `cash-register-ready` event ever fires. Recovery requires force-killing the kiosk app or rebooting the machine.

**Root cause (probable):** Under Phase 6 D-01 + D-05, when the kiosk is on the welcome layer the Magicline `WebContentsView` is **destroyed** — the view only exists for the duration of an active session (welcome:tap → login → register → idle → logout → welcome → view destroyed). When admin opens from the welcome layer and then taps "Kasse nachladen", the IPC handler `admin:reload-magicline` (or wherever `magiclineView.reload()` lives) is called against a non-existent view. Either:
- `reload()` throws silently and the host stays on splash forever, or
- `reload()` succeeds against `null` (no-op) and the host listens for a `cash-register-ready` event that will never fire because there's no Magicline page loaded.

The result: splash visible, no Magicline view in memory, no event in flight, no recovery path.

**Boot-watchdog behavior:** The 30 s post-submit watchdog from `authFlow.js` does NOT cover this case because `authFlow.start()` was never called — the user took an admin action, not a session start. The 2-minute health watchdog from `main.js` (`HEALTH_WATCHDOG_MS`) might fire eventually but its intent is post-update bad-release detection, not arbitrary stuck-state recovery. Untested whether either watchdog actually rescues this scenario.

**User impact:** medium-high. Any admin who opens the menu from the welcome layer (which is the *resting state* under Phase 6 — so the most likely state) and then taps Kasse nachladen will brick the kiosk for 2 minutes minimum, possibly forever. This is the default "dismiss admin menu" path because there's no close button (see related todo).

## Solution

Two-layer fix:

### Layer 1 — `admin:reload-magicline` becomes welcome-state-aware

In `src/main/main.js` (or wherever the IPC handler lives), the handler must check whether a Magicline view currently exists before calling `reload()`:

```js
ipcMain.handle('admin:reload-magicline', async () => {
  log.audit('admin.action', { action: 'reload-magicline' });
  if (magiclineView.exists()) {
    // Active session: real reload through magicline view
    return magiclineView.reload();
  } else {
    // Welcome state: there's nothing to reload
    // → just close the admin menu and return to the welcome layer
    hostWindow.webContents.send('admin:menu-hide');
    hostWindow.webContents.send('welcome:show');
    return { result: 'welcome-noop' };
  }
});
```

Add `magiclineView.exists()` (or expose the existing internal nullability check) as a public method.

### Layer 2 — Or a real "force fresh session" behavior

Alternative interpretation: if an admin taps "Kasse nachladen" from welcome, the *intent* might be "force-reset the kiosk into a fresh session" — like a hard recovery. In that case the right behavior is:

```js
} else {
  // Welcome state: simulate a welcome:tap to start a fresh session
  return triggerWelcomeTap();  // same handler that fires on user tap
}
```

This puts the kiosk into BOOTING → LOGIN_DETECTED → CASH_REGISTER_READY exactly as if the user had tapped welcome themselves. Probably what the admin wanted anyway.

**Decision needed during planning:** which interpretation? Layer 1 is safer (no surprise side effects); Layer 2 is more useful (admin gets a working session). My recommendation: **Layer 2** — Kasse nachladen from welcome should mean "start a fresh session right now." Document the behavior in 05-VERIFICATION.md.

### Test

- Extend whatever test covers the admin reload IPC handler:
  - Test 1: handler called when view exists → calls `magiclineView.reload()`
  - Test 2: handler called when view does NOT exist → either fires `welcome:show` (Layer 1) or fires `triggerWelcomeTap` (Layer 2)
  - Test 3: handler does NOT throw if view is null

### Doc updates

- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` — update the P5-05 row to specify the welcome-state behavior.
- `docs/runbook/v1.0-KIOSK-VISIT.md` (or successor) — add a row exercising the bug: open admin from welcome, tap Kasse nachladen, expect a fresh session NOT a stuck splash.

**Practical impact:** medium-high. P0-ish if it happens during real operation (admin checks the menu while the gym is closed → kiosk is bricked until staff visit), but mitigated by the fact that admin interactions are rare AND the close-admin-button todo above provides an alternative dismiss path. Capturable as a v1.1 todo unless field operation surfaces a real incident.

**Related work:**
- `2026-04-14-admin-menu-close-button.md` — adding a close button reduces the chance of triggering this bug because admins have a non-Kasse-nachladen dismiss path
- `2026-04-14-keep-splash-visible-until-auto-selection-completes.md` — same splash layer, different cause
