---
created: 2026-04-14T11:00:00.000Z
title: "Anmeldedaten ändern" admin button shows first-run mode with editable PIN fields
area: general
files:
  - src/main/main.js
  - src/host/host.js
  - src/host/host.html
  - src/main/preload.js
  - src/main/credentialsStore.js
---

## Problem

Discovered during the 0.1.2 kiosk visit on 2026-04-14, runbook row P5-06.

When the admin menu's **"Anmeldedaten ändern"** button is tapped, the credentials overlay appears in **first-time-run mode** instead of the expected **re-entry mode**. The first-time-run variant exposes the PIN setup fields as **editable**, in addition to the Magicline username and password fields.

**Per spec (P5-06 in `01-VERIFICATION.md` and `05-VERIFICATION.md`):**

> Tap "Anmeldedaten ändern" → Credentials overlay appears in re-entry mode (no PIN setup fields)

The intent is that this button is for updating Magicline credentials only — the kiosk admin PIN should be unchangeable from this entry point.

## Why this is bad

Three issues, ordered by severity:

### 1. Mislabeled scope (UX bug)

The button label "Anmeldedaten ändern" implies "change Magicline credentials" — username + password for the kiosk's Magicline staff account. An admin tapping this button does NOT expect to be presented with PIN reset fields. Showing them is a UX bug regardless of security implications.

### 2. Fat-finger risk (operational)

An admin updating only the Magicline password could accidentally type into the PIN reset field, change the kiosk's admin PIN to a value they then forget, and lock themselves out of the admin menu. Recovery would require a full reinstall or registry-level intervention.

### 3. Quiet PIN takeover by maintenance access (medium-severity threat)

A maintenance technician given temporary admin PIN access (to update credentials, fix a stuck state, etc.) could tap "Anmeldedaten ändern" and quietly reset the PIN to a known value. The gym owner, returning later, would discover their original PIN no longer works. There is currently no audit signal distinguishing "credentials changed" from "PIN changed" — both flow through the same handler.

This is **NOT a P0 escalation** because:
- The threat actor must already have current admin PIN (they got into the menu)
- The same actor could already cause damage (Beenden → manipulate kiosk via Windows desktop, change config.json, etc.)
- BUT the current behavior makes the attack *trivial and quiet*, vs requiring deliberate effort

## Solution

Three-part fix:

### Part 1 — Split the credentials overlay into two distinct modes

`src/host/host.html` already has the credentials overlay markup. Split the IPC contract so:

- **Mode `'first-run'`** (existing first-boot path): Magicline username + Magicline password + PIN setup (new PIN + confirm new PIN)
- **Mode `'re-entry'`** (NEW — invoked from admin menu "Anmeldedaten ändern"): Magicline username + Magicline password ONLY. PIN setup fields are NOT rendered. The form submission updates only the Magicline credentials in `safeStorage`.

The mode is set via the IPC payload from main → host. Main's existing first-run logic passes `'first-run'`; the new admin-button handler passes `'re-entry'`.

### Part 2 — Add a separate "PIN ändern" admin button (optional but recommended)

If admins legitimately need to change the PIN, give them an explicit, unambiguous path:

- New admin menu button: **"PIN ändern"** (between "Anmeldedaten ändern" and "Auto-Update einrichten" or similar)
- Tapping it opens a focused PIN-change overlay: "Aktuelle PIN" → "Neue PIN" → "PIN bestätigen" → Speichern
- Requires re-entry of the **current** PIN before allowing the change (defense in depth — even an admin already in the menu must re-prove they know the current PIN)
- Emits a distinct audit event: `admin.pin-changed at=...` (vs the existing `admin.credentials-changed`)

This is optional — if PIN changes should require a full reinstall instead, just remove the editable PIN fields from re-entry mode and don't add a new path. But "PIN can never be changed except by reinstall" is a usability cliff; some explicit path is probably better.

### Part 3 — Audit log differentiation

Even if PIN changes stay possible (via the new "PIN ändern" button or otherwise), the audit log should distinguish them from credential changes:

- `admin.action: action=credentials-changed` → Magicline username/password updated
- `admin.action: action=pin-changed` → kiosk admin PIN updated (with `requires_current_pin: true` confirmation)

Both events should write to `audit.log` (not just `main.log`) so they're picked up by future log-grep audits.

### Tests

- Extend `test/host.test.js` (or create one if absent) for the credentials overlay mode parameter:
  - `mode='first-run'` → all 4 fields rendered (username, password, new-PIN, confirm-PIN)
  - `mode='re-entry'` → only 2 fields (username, password); PIN fields absent from DOM
- Extend `test/main.test.js` (or wherever the IPC handler lives):
  - `admin:change-credentials` IPC handler dispatches credentials overlay with `mode='re-entry'`, NOT `'first-run'`
  - First-boot path still dispatches `mode='first-run'`
- Manual: full visit row P5-06 — open admin menu → tap "Anmeldedaten ändern" → verify only username + password fields appear → cancel → verify return to admin menu cleanly

### Doc updates

- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` — clarify P5-06 expected behavior (no PIN fields in re-entry mode)
- `docs/runbook/v1.0-KIOSK-VISIT.md` — same, plus add a new row "P5-06b: PIN setup fields are absent from re-entry credentials overlay"
- `.planning/PROJECT.md` — if Part 2 is accepted, add a Key Decision row for the separate "PIN ändern" admin path

**Practical impact:** medium. UX bug + operational risk, not a critical security hole. Should land in v1.1 — no rush for a v1.0.x patch unless field operation surfaces an actual incident.

**Related work:**
- `2026-04-14-admin-menu-close-button.md` — both touch the admin menu UI; consider a single PR if doing v1.1 admin-menu polish in one pass
- `2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md` — ditto, all admin menu changes
