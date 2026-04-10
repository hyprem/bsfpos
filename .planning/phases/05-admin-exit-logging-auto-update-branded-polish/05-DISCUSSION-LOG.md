# Phase 5: Admin Exit, Logging, Auto-Update & Branded Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-10
**Phase:** 05-admin-exit-logging-auto-update-branded-polish
**Areas discussed:** Admin Menu UI & Items, PIN Lockout UX, Auto-Update Safe-Window Policy, GitHub PAT Distribution, Log Redaction Scheme, Update Failure & Rollback, Branded Polish Scope, Updating Cover Behavior

---

## Admin Menu UI & Items

### Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Vertical button stack (Recommended) | Full-width buttons top-to-bottom, matches existing card style | ✓ |
| 2-column button grid | Icon + label tiles, 2 per row | |
| List with chevrons | iOS-style list rows | |

### Order

| Option | Description | Selected |
|--------|-------------|----------|
| Safe → destructive (Recommended) | Updates, Logs, Reload, Re-enter creds, Exit | ✓ |
| Frequency-ordered | Reload first, Exit last | |
| Grouped sections | Diagnostics / Recovery / Exit | |

### Diagnostics Header

| Option | Description | Selected |
|--------|-------------|----------|
| Version + kiosk state (Recommended) | Version, last update check, authFlow state, last idle reset | ✓ |
| Version only | Just app version | |
| Nothing | Pure action menu | |

### View Logs Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Open logs folder in Explorer (Recommended) | `shell.openPath(app.getPath('logs'))` | ✓ |
| In-app scrolling log viewer | Branded in-kiosk panel | |
| Tail of last 50 lines + Open folder | Middle ground | |

**Notes:** All recommended picks. Vertical stack + safe-to-destructive order + diagnostic header + Explorer-based log viewing. Zero new UI beyond the admin menu itself.

---

## PIN Lockout UX

### Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| electron-store (Recommended) | Persist attempts + lockedUntil in config.json, survives restart | ✓ |
| In-memory only | Wiped on restart — trivially bypassed | |
| electron-log only | Forensics only, no enforcement | |

### Lockout UI

| Option | Description | Selected |
|--------|-------------|----------|
| Live countdown 'Wait 4:57' (Recommended) | Keypad replaced with ticking mm:ss | ✓ |
| Static 'Locked — try again later' | No countdown | |
| Modal closes, hotkey ignored | Silent suppression | |

### Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Only PIN submit (Recommended) | Hotkey still opens modal, submit disabled | ✓ |
| Hotkey suppressed entirely | No-op Ctrl+Shift+F12 during lockout | |

### Reset Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Full reset on success (Recommended) | Clear attempts + lockedUntil | ✓ |
| Rolling 60s window only | Don't reset on success | |

**Notes:** All recommended picks. Persistent lockout + visible countdown + hotkey-still-opens-modal + clean-slate-on-success. Wrapper module approach keeps `adminPin.js` unchanged per Phase 3 contract.

---

## Auto-Update Safe-Window Policy

### Check Frequency

| Option | Description | Selected |
|--------|-------------|----------|
| On boot + every 6 hours (Recommended) | setInterval on 6h cadence | ✓ |
| On boot only | Missed days if kiosk stays up | |
| On boot + every idle reset | Bursty, tied to Phase 4 signal | |

### Install Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Next idle reset OR 03–05 window (Recommended) | Whichever comes first after download | ✓ |
| 03–05 window only | Guaranteed quiet, slow rollout | |
| Next idle reset only | Fastest, but no 03–05 fallback on quiet days | |

### Manual Check-For-Updates

| Option | Description | Selected |
|--------|-------------|----------|
| Check + show result, still gated (Recommended) | No force-install path | ✓ |
| Check + force install now | With confirmation dialog | |
| Both via long-press | Hidden force path | |

### Idle Signal Definition

| Option | Description | Selected |
|--------|-------------|----------|
| Just after sessionReset completes (Recommended) | Phase 4 canonical clean-slate | ✓ |
| Idle overlay dismissed by timeout | More frequent but dirtier state | |
| Both signals accepted | Most permissive | |

**Notes:** All recommended picks. 6-hour check + sessionReset-or-03-05 gate + no admin force-install. `sessionReset.js` gets a new `post-reset` event emission.

---

## GitHub PAT Distribution

### Bootstrap

| Option | Description | Selected |
|--------|-------------|----------|
| Public repo, no PAT needed (Recommended) | Simplest, zero bootstrap problem | |
| Private repo, PAT via admin menu on first boot | Preserves source privacy | ✓ |
| Private repo, PAT baked into installer | electron-builder #2314 warns against | |

### Public-Repo Contingent (moot given private choice)

| Option | Description | Selected |
|--------|-------------|----------|
| Audit repo for secrets, then go public (Recommended) | Hygiene recommendation | ✓ |
| Skip the audit | | |
| Public mirror, keep main private | | |

**User's choice:** Private repo + PAT-via-admin-menu. The "audit for secrets" answer is recorded as ongoing hygiene guidance (D-21), not a Phase 5 deliverable, since the repo stays private.

### Pre-PAT Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-update silently disabled until PAT set (Recommended) | Non-blocking, admin menu shows state | ✓ |
| Block startup until PAT entered | Bricks on RDP failure | |
| Daily reminder overlay | Annoying | |

### PAT Entry Location

| Option | Description | Selected |
|--------|-------------|----------|
| Inside admin menu as 'Configure auto-update' (Recommended) | Reuses admin gating | ✓ |
| Separate first-run wizard | New code path | |

**Notes:** Source privacy preserved. Installer ships with no secrets. First-boot admin visit enters PAT once. Pre-PAT kiosk is fully functional just without auto-update.

---

## Log Redaction Scheme

### Badge Redaction

| Option | Description | Selected |
|--------|-------------|----------|
| SHA-256 first 8 hex chars (Recommended) | Enables correlation without storing badge | ✓ |
| First 4 chars prefix only | Leaks format structure, collision-prone | |
| No ID at all | Loses correlation | |

### Sale Events

| Option | Description | Selected |
|--------|-------------|----------|
| Click event + hashed badge, no amount (Recommended) | Matches ADMIN-04 wording | ✓ |
| Click + amount + hashed badge | Fragile selector footgun | |
| Click only | Can't correlate | |

### Retrofit Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Central redactLog() helper (Recommended) | New log.audit() in logger.js, single choke point | ✓ |
| Hand audit, no helper | No guardrail for future phases | |

### File Split

| Option | Description | Selected |
|--------|-------------|----------|
| Single main.log (Recommended) | One rotating file, matches ADMIN-04 wording | ✓ |
| Separate audit.log | Two rotation budgets | |

**Notes:** All recommended picks. Central `log.audit(event, fields)` with field-name-based redactor. Phase 5 migrates prior-phase log lines where sensitive fields are present.

---

## Update Failure & Rollback

### Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Post-update health check on next boot (Recommended) | 2-min watchdog on authFlow → CASH_REGISTER_READY | ✓ |
| NSIS exit code only | Misses runtime-broken releases | |
| Both | Most robust | |

### Rollback Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Manual runbook + auto-disable auto-update (Recommended) | Freeze and alert posture | ✓ |
| Auto-download previous version | Broken kiosk may not execute reliably | |
| Cache previous install folder | Windows locked-file risk | |

### Bad-State Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Boot to branded error + admin PIN (Recommended) | Reuses Phase 2/3 error-overlay pattern | ✓ |
| Keep trying to boot | Crash loop risk | |
| Force OS restart | Nuclear | |

**Notes:** All recommended picks. Health check on boot, `electron-store` flag, new `'bad-release'` error variant, manual runbook recovery on maintenance visit.

---

## Branded Polish Scope

### Existing Surfaces With Polish Debt (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Splash (Phase 1) | Logo sizing, fade, loading indicator | ✓ |
| Idle overlay (Phase 4) | Real-hardware visual check | ✓ |
| Credentials overlay (Phase 3) | Touch targets, TabTip coexistence | ✓ |
| Magicline-error screen (Phase 2/3) | Variant consistency | ✓ |

### Gate

| Option | Description | Selected |
|--------|-------------|----------|
| Only new surfaces (Recommended) | Defer existing to next-visit batch | ✓ |
| Full app polish pass | Scope expansion | |

### Palette

| Option | Description | Selected |
|--------|-------------|----------|
| Lock current palette (Recommended) | #F5C518 yellow on #1A1A1A | ✓ |
| Secondary accent for admin | Red admin surfaces | |

### Touch Audit

| Option | Description | Selected |
|--------|-------------|----------|
| CSS-verified, physical deferred (Recommended) | Computed-size assertion | ✓ |
| Physical audit blocks close | Hardware stall | |

### Clarification (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| New surfaces only, defer 4 existing (Recommended) | Match deferred-close posture | ✓ |
| Include all 4 in Phase 5 | Single consolidated pass | |
| Split: code-heavy in, hardware-dependent deferred | Middle ground | |

**Notes:** User acknowledged polish debt on all 4 existing surfaces but kept Phase 5 scope tight to new surfaces only. The 4 existing surfaces join the next-visit batch already tracked in STATE.md.

---

## Updating Cover Behavior

### Visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Only during install/restart (Recommended) | Silent background download | ✓ |
| Also during download | Blocks members mid-download | |
| Download with dismissible progress | Complex UX | |

### Content

| Option | Description | Selected |
|--------|-------------|----------|
| Logo + 'Aktualisierung läuft' + spinner (Recommended) | Branded moment, no progress bar | ✓ |
| Progress bar | Stuck at 100% | |
| Minimal text only | Misses brand moment | |

### Layer

| Option | Description | Selected |
|--------|-------------|----------|
| Layer 300 shared with #magicline-error (Recommended) | Mutually exclusive states | ✓ |
| New layer 500 above admin | Overkill | |

### Post-Install First Boot

| Option | Description | Selected |
|--------|-------------|----------|
| Normal splash, no toast (Recommended) | Silent upgrade | ✓ |
| 'Updated to vX.Y.Z' toast | Visible to members | |

**Notes:** All recommended picks. Silent background + branded install cover + shared layer 300 + normal splash post-install. Version info lives in the admin menu diagnostic header.

---

## Claude's Discretion

- Exact German copy for admin menu labels and diagnostic header field names (planner picks).
- CSS spinner design for updating cover.
- `archiveLogFn` implementation details for 5-file rotation (researcher determines API).
- Admin menu open/close transition (instant/fade/slide).
- Absolute vs relative timestamps in diagnostic header (Claude picks relative).

## Deferred Ideas

- Polish debt on splash, idle overlay, credentials, magicline-error — routed to next-visit batch.
- Auto-rollback via cached previous install or previous GitHub release — rejected.
- Force-install button in admin menu — rejected.
- Public repo migration — noted as future hygiene consideration only.
- "Updated to vX.Y.Z" post-install toast — rejected.
- In-app log viewer — rejected.
