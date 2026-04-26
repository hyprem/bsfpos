# Phase 11: POS Close — Immediate Welcome Reset - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 11-pos-close-immediate-welcome-reset
**Areas discussed:** Failure mode, Test layout, D-06 update style

Phase 11 was added mid-UAT (2026-04-26) after the user found that closing POS while admin had tapped through to the cash-register page lands them on the register after admin-menu dismiss. Three options were surfaced:
1. Keep Phase 09 D-06 as-is (no mid-checkout interruption)
2. Reverse D-06 — close-POS triggers immediate sessionReset
3. Soft compromise — only reset if cart is empty

User picked option 2. Phase 11 was added via `/gsd-add-phase` with the 7-criterion detail block before discuss kicked off. Discussion below covers only the implementation gray areas not already locked in those criteria.

---

## Failure mode

| Option | Description | Selected |
|--------|-------------|----------|
| Persist anyway, audit error | Set `posOpen=false` first, then call `hardReset`. On throw: keep state, audit error, return ok=true. Closed-welcome will appear at next natural reset trigger. | ✓ |
| Atomic — rollback on failure | Either both the store flip and the reset succeed, or neither does. Adds rollback complexity for a near-impossible failure path. | |
| Persist, swallow error silently | Set state, try/catch with no audit. Loses signal entirely — not appropriate for state-changing operations. | |

**User's choice:** Persist anyway, audit error
**Notes:** Resilience over strictness. Admin's intent (close POS) is durable; reset is best-effort with audit fallback. → CONTEXT D-04.

---

## Test layout

| Option | Description | Selected |
|--------|-------------|----------|
| Extend sessionReset.test.js only | Two new tests in existing file, mirroring Phase 10 D-17/D-18 pattern. No new test file. Toggle handler covered indirectly. | ✓ |
| Extend sessionReset.test.js + new posClose.test.js | Filter tests + new file for the IPC handler hardReset assertion. Cleaner separation, more files. | |
| Extend sessionReset.test.js + extend existing main test | Filter tests + augment whatever main-handler tests already exist. Reuse existing patterns. | |

**User's choice:** Extend sessionReset.test.js only
**Notes:** Mirrors Phase 10 sale-completed precedent exactly. Two new tests, no new file. → CONTEXT D-07/D-08.

---

## D-06 update style

| Option | Description | Selected |
|--------|-------------|----------|
| Append SUPERSEDED-BY-PHASE-11 note | Keep original D-06 text, append one-line supersede note + cross-ref to 11-CONTEXT. Preserves audit trail. | ✓ |
| Strikethrough + new D-06 inline | Visual but messy in plain markdown. | |
| Replace D-06 wholesale | Cleanest read but loses the why-we-changed signal. | |

**User's choice:** Append SUPERSEDED-BY-PHASE-11 note
**Notes:** Audit trail wins over readability. Original "no mid-checkout interruption" rationale stays visible for future reference. → CONTEXT D-10.

---

## Claude's Discretion

- Exact audit event names (e.g., `pos.state-changed.reset-failed`) — open to convention-matching during planning.
- Whether to add an inline comment near the toggle-pos-open handler citing 11-CONTEXT, or rely on commit + cross-ref. Default: minimal comment per project conventions.

## Deferred Ideas

- Cash-register banner for `posOpen=false` mid-session (still deferred — Phase 09 deferred-list).
- Auto-close admin menu on POS toggle (not requested this round).
