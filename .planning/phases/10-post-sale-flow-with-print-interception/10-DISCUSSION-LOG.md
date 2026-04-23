# Phase 10: Post-Sale Flow with Print Interception — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 10-post-sale-flow-with-print-interception
**Areas discussed:** Dismiss UX + Countdown

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Dismiss UX + countdown | Nächster Kunde dismiss (button-only vs tap-anywhere) + countdown visualization (text vs ring vs bar) | ✓ |
| Subtext copy | Single fixed vs conditional ('Ihr Beleg wurde gedruckt' vs 'Einkauf bestätigt') | |
| Print-to-PDF setup strategy | App-startup PowerShell vs NSIS installer step vs manual admin runbook | |
| Fallback trigger scope | Ship print-event only (defer fallback) vs ship both together | |

**User's choice:** Dismiss UX + countdown only. Other areas left to Claude's Discretion with recommendations for the planner.

---

## Dismiss UX + Countdown

### Q1 — Dismiss behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Button-only | Only 'Nächster Kunde' dismisses; no tap-anywhere. Consistent with idle overlay's 'Weiter' button. (Recommended) | ✓ |
| Tap anywhere | Button OR tap anywhere on overlay dismisses. Source todo suggestion. Risk of accidental brush-dismiss. | |
| Tap anywhere but not button area | Button works normally; other taps implicit-dismiss. Same risk. | |

**User's choice:** Button-only.
**Notes:** Accidental brush-dismiss while member completes card-terminal payment would erase the only visible thank-you signal. Safer default matches idle-overlay precedent.

### Q2 — Countdown visualization

| Option | Description | Selected |
|--------|-------------|----------|
| Text-only, reuse idle style | Big number + SEKUNDEN label, identical to #idle-overlay. Zero new animation code. (Recommended) | ✓ |
| Ring / circle progress | SVG circular progress ring behind the number. More branded, more code. | |
| Linear progress bar | Horizontal bar under headline shrinks from full to zero. | |

**User's choice:** Text-only, reuse idle style.
**Notes:** Direct reuse of `#idle-countdown-number` / `.bsk-idle-number` pattern. No new animation code to maintain.

### Q3 — Idle timer behavior while overlay visible

| Option | Description | Selected |
|--------|-------------|----------|
| Stop on show, fresh start on Nächster Kunde | idleTimer.stop() when overlay shows; idleTimer.start() on button dismiss. Auto-dismiss path handled by welcome-mode sessionReset internally. (Recommended) | ✓ |
| New pause/resume API | Add idleTimer.pause()/resume() preserving remaining time. More code, more tests. | |

**User's choice:** Stop on show, fresh start on Nächster Kunde.
**Notes:** Source todo says 'paused' informally; 'rearms with a fresh 60 s window' on Nächster Kunde is fresh-start semantics. Existing API suffices.

### Q4 — Race: button tap at second 9.95 vs auto-dismiss

| Option | Description | Selected |
|--------|-------------|----------|
| First-wins guard | Single module-scoped postSaleResolved flag in host.js. First of {button tap, countdown expiry} latches; second is no-op. (Recommended) | ✓ |
| Disable button at T≤1s | Disable button when countdown ≤1s to avoid race entirely. Timing-dependent visual change; jittery. | |
| Accept race — both fire | Both IPCs fire; host handles idempotent hides. Risk: sessionReset + idle-rearm on dead view. | |

**User's choice:** First-wins guard.
**Notes:** Pattern precedent: `welcomeTapPending` in main.js for Phase 07 SPLASH-01. Clean, deterministic.

### Q5 — Hardware Esc dismiss?

| Option | Description | Selected |
|--------|-------------|----------|
| No — ignore Esc | Post-sale is customer-facing; Esc reserved for admin (Phase 08). Kiosk has no keyboard. (Recommended) | ✓ |
| Yes — Esc = Nächster Kunde | Convenient during maintenance; couples customer UX to admin keys. | |

**User's choice:** No — ignore Esc.
**Notes:** Consistent with welcome layer (Esc doesn't advance welcome). Kiosk member cannot reach Esc anyway.

---

## Claude's Discretion

The following areas were not explicitly discussed but are captured in CONTEXT.md with rationale:
- **Subtext copy** (D-13): single fixed "Vielen Dank für Ihren Einkauf!" — branching on trigger leaks implementation state the member can't observe.
- **Print-to-PDF setup strategy** (D-14/D-15): NSIS post-install PowerShell with admin-runbook + admin-menu-diagnostic backstop. Every alternative fails-open toward a Chrome-preview leak to a member.
- **Fallback trigger scope** (D-16): ship both print-event primary and cart-empty fallback together. Research must verify Electron 41 `-print` behavior against live Magicline before finalizing which is primary.
- Exact CSS palette for the yellow "Vielen Dank!" headline, reuse of `bsk-layer--idle` card styling, MutationObserver DOM root for cart-empty observer, test-file granularity, and admin-menu diagnostics row timing — all decided by researcher/planner.

## Deferred Ideas

Captured in CONTEXT.md `<deferred>`:
- Receipt PDF archiving (v1.2).
- Tap-anywhere dismiss (revisit if field UAT objects).
- Ring / linear countdown visualization (v1.2 polish candidate).
- Conditional subtext by trigger (rejected for info leakage).
