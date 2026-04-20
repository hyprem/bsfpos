# Phase 09: POS Open/Close Toggle with Update-Window Gating - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 09-pos-open-close-toggle-with-update-window-gating
**Areas discussed:** Button placement & confirm UX, Welcome closed-state design, updateGate wiring, posOpen state lifecycle

---

## Button Placement & Confirm UX

| Option | Description | Selected |
|--------|-------------|----------|
| After PIN andern (Recommended) | Groups all state-changing actions together: Anmeldedaten > PIN andern > POS schliessen. Before utility row. | ✓ |
| Before Beenden (last action) | Near the bottom, just above exit button. | |
| Top of button stack | Most visible position, right after diagnostics header. | |

**User's choice:** After PIN andern
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Inline card overlay (Recommended) | Same pattern as PIN change and credentials overlays — branded dark card at z-400 with Ja/Abbrechen. | ✓ |
| Browser-style confirm dialog | Electron dialog.showMessageBox — breaks branded kiosk feel. | |
| Inline within admin menu | Replace button text with confirm/cancel inline. | |

**User's choice:** Inline card overlay
**Notes:** None

---

## Welcome Closed-State Design

| Option | Description | Selected |
|--------|-------------|----------|
| Same card, different text (Recommended) | Keep branded dark background + logo + card. Replace CTA with geschlossen message. No tap handler. | ✓ |
| Distinct visual treatment | Different background color or accent for across-the-room visibility. | |
| Fullscreen message, no card | Large centered text on dark background, no card frame. | |

**User's choice:** Same card, different text
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| No extra info (Recommended) | Just closed message and subtext. Clean and simple. | ✓ |
| Show a small clock | Display current time so members/staff can judge reopen time. | |
| Show "Admin has closed POS" | Explicit attribution so staff know it was intentional. | |

**User's choice:** No extra info
**Notes:** None

---

## updateGate Wiring

| Option | Description | Selected |
|--------|-------------|----------|
| Pass posOpen getter to updateGate (Recommended) | Add getPosOpen to onUpdateDownloaded opts. Same DI pattern as getHour. Checked in existing polling interval. | ✓ |
| Event-driven push from main.js | main.js calls updateGate.setPosOpen(bool) on toggle. Adds mutable state. | |
| updateGate reads store directly | Breaks DI/pure-testable pattern. | |

**User's choice:** Pass posOpen getter to updateGate
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| No — posOpen=false + time window is enough (Recommended) | Admin explicitly closing POS is the strong signal. Requiring post-reset defeats the purpose. | ✓ |
| Yes — require post-reset too | Triple gate. Maximum safety but admin would have to wait for idle timeout. | |

**User's choice:** No — posOpen=false + time window is enough
**Notes:** None

---

## posOpen State Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| No auto-reopen (Recommended) | posOpen=false persists until admin explicitly reopens. Time-window gate prevents off-hours updates. | ✓ |
| Auto-reopen after 4 hours | Prevents forgotten overnight close. | |
| Auto-reopen at next boot | Safest against forgotten state but requires daily admin action. | |

**User's choice:** No auto-reopen
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Close takes effect after current session ends (Recommended) | Active session continues undisturbed. Closed message shows on next welcome cycle. | ✓ |
| Close takes effect immediately | Force-show closed message, interrupting active session. | |
| Show a banner but let session continue | Deferred polish per REQUIREMENTS.md. | |

**User's choice:** Close takes effect after current session ends
**Notes:** None

---

## Claude's Discretion

- Exact CSS for yellow/green button variants
- Confirm overlay implementation (new div vs generic pattern)
- getPosOpen sync vs function wrapper
- posOpen in admin diagnostics header (nice-to-have)

## Deferred Ideas

- Cash-register banner for posOpen=false mid-session (explicitly deferred in REQUIREMENTS.md)
- Auto-reopen after N hours (discussed and rejected)
