---
created: 2026-04-14T09:15:00.000Z
title: Admin POS open/close toggle gating updates to a daytime window
area: general
files:
  - src/main/updateGate.js
  - src/main/main.js
  - src/host/host.js
  - src/host/host.html
  - src/host/host.css
  - src/main/preload.js
  - test/updateGate.test.js
---

## Problem

The Phase 5 auto-update safe-window is hard-coded to 03:00–05:00 (`MAINTENANCE_HOUR_START = 3` / `_END = 5` in `src/main/updateGate.js`). This was the right default for a typical retail POS that's open during the day and idle overnight, but it does not match Bee Strong:

- The gym is **open 24/7** with night use being a real share of traffic.
- The right "safe to update" window is during the day (09:00–12:00 quieter morning hours), not overnight.

A constant flip to 9/12 is a one-line patch (planned to be bundled with the next 0.1.x patch — see end of this todo). But a static time window is fragile by itself: if a member is mid-purchase at 09:30 and the kiosk decides to install an update because the welcome-logout cycle hits the safe window, that's still a degraded experience even if the welcome cycle "looks" idle.

The desired model is a **two-condition gate**:

1. **POS state is "closed"** — set explicitly by an admin via the admin menu, persisted in electron-store, surfaced on the welcome screen as a "geschlossen" message and on the cash register as a banner so members and staff can see it.
2. **Time is in the daytime maintenance window** (currently 09:00–12:00, but the moment the toggle exists the time gate becomes secondary — `posOpen=false` is the strong signal, the time window is just a fail-safe to prevent a forgotten "closed" state from cascading into an unattended install at peak hour).

When BOTH conditions are true, `updateGate.fireWith('admin-closed-window')` is allowed. The existing `post-reset` and `maintenance-window` triggers stay as fall-throughs but become subordinate to the explicit POS state.

## Solution

### State

- New persisted key in electron-store: `posOpen` (boolean, default `true`). Survives kiosk restarts.
- New IPC: `admin:set-pos-open` from host → main (sets the boolean, writes through to electron-store, broadcasts `pos-state-changed` to all renderers).
- New IPC: `pos-state-changed` (main → host) — host updates the welcome layer + (optional) a discreet banner on the cash register.

### Admin menu

- New button in the admin menu (between "Anmeldedaten ändern" and "Protokolle anzeigen", or wherever the safe→destructive ordering puts it):
  - When `posOpen=true`: button label "POS schließen" (yellow). Tapping → confirmation modal "POS wirklich schließen? Mitglieder sehen einen geschlossen-Hinweis." → confirm → `posOpen=false`, log `pos.state-changed: open=false reason=admin`.
  - When `posOpen=false`: button label "POS öffnen" (green). Tapping → no confirmation → `posOpen=true`, log `pos.state-changed: open=true reason=admin`.

### Welcome layer

- When `posOpen=true`: existing "Zum Kassieren tippen" CTA, full-viewport touch.
- When `posOpen=false`: replace the CTA with a branded "POS derzeit geschlossen" message + "Bitte Studio-Personal verständigen" subtext. **Tap is suppressed** (no `welcome:tap` IPC) — the screen is informational only.

### Cash-register banner (optional polish)

- If `posOpen=false` is set while a session is mid-checkout, the cash register stays usable for that one transaction, but a small fixed banner appears at the top of the welcome layer reminder once the session ends.
- Lower priority — can defer to a follow-up todo if scope creeps.

### updateGate changes

- New trigger source: `admin-closed-window`.
- New armed condition checked alongside the existing `post-reset` listener and the maintenance-window interval: when `posOpen=false` AND time is within the daytime window, fire `installFn('admin-closed-window')`.
- The existing two trigger paths stay as fail-safes:
  - `post-reset` still fires after a welcome logout if `posOpen=true` AND the time happens to be in the maintenance window — keeps the original behavior available.
  - `maintenance-window` interval still fires inside the time window even with `posOpen=true` — strictly worse than the `admin-closed-window` path but keeps a non-zero update path if the toggle is forgotten.
- "First trigger wins" semantics preserved.
- Audit log line `update.install trigger=admin-closed-window posOpen=false hour=N` for the new path.

### Tests

- Extend `test/updateGate.test.js`:
  - `posOpen=false` + hour in window → `admin-closed-window` trigger fires
  - `posOpen=false` + hour outside window → no fire
  - `posOpen=true` + hour in window → falls through to existing `maintenance-window` path
  - First-trigger-wins between `admin-closed-window` and `post-reset`

### Doc updates (when this lands)

- `.planning/PROJECT.md` — add a new Key Decision row referencing the open/close model, link this todo
- `docs/runbook/v1.0-KIOSK-VISIT.md` (or its v1.1 successor) — add a P5-31-style row exercising the new path: tap admin, close POS, wait for daytime window, observe `update.install trigger=admin-closed-window`
- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` — add the new trigger to the ADMIN-07 row

## Bundled with this work (not a separate todo)

> **Update 2026-04-14 (quick 260414-iiv, shipped in 0.1.3):** the constant
> flip portion below is **DONE**. `MAINTENANCE_HOUR_START=9` /
> `MAINTENANCE_HOUR_END=12` are live in `src/main/updateGate.js`, the test
> fixture in `test/updateGate.test.js` was updated, and the four
> `05-VERIFICATION.md` references + the `v1.0-KIOSK-VISIT.md` P5-20 row are
> flipped to 09:00–12:00. The full POS open/close admin toggle remains as
> the v1.1 scope of this todo. Treat the section below as historical.

**Flip the safe-window constant from 03:00–05:00 → 09:00–12:00.** Do this AS PART OF this todo's first plan task, not as a separate one-line patch. Two constants in `src/main/updateGate.js`, one test fixture in `test/updateGate.test.js`, four doc references in `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md`, one in `docs/runbook/v1.0-KIOSK-VISIT.md`. The constant flip alone (without the open/close toggle) is acceptable as a stop-gap if this todo is not picked up immediately — the user has agreed to bundle it with whatever next 0.1.x patch ships, so it can land before the toggle work without invalidating this todo.

**Practical impact:** medium-high. The kiosk is unattended 24/7 and Bee Strong has real night traffic — installing an update during peak night hours is a real user-facing risk. The constant flip alone gives you a daytime window. The full open/close toggle is the right v1.1 polish so that updates only fire when an admin has explicitly confirmed the POS is closed.
