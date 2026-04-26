# Phase 11: POS Close — Immediate Welcome Reset - Context

**Gathered:** 2026-04-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Closing the POS from the admin menu immediately triggers a background `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})`, so the closed-welcome layer surfaces as soon as the admin menu dismisses — without waiting for the 60 s idle timeout. Reverses Phase 09 D-06 ("no mid-checkout interruption") in favor of the admin's intent being a strong, immediate signal.

Out of scope:
- Cash-register banner for `posOpen=false` mid-session (still deferred per Phase 09 deferred-ideas list).
- Any change to the open direction (`POS öffnen` keeps the existing in-place welcome update).
- Any change to `updateGate` `admin-closed-window` trigger logic — that gating is independent of this reset.

</domain>

<decisions>
## Implementation Decisions

### Toggle handler integration

- **D-01:** When `case 'toggle-pos-open'` flips `posOpen` to `false`, the handler calls `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` AFTER `store.set('posOpen', false)` AND AFTER the existing `pos-state-changed` webContents.send. Order rationale: the host needs the closed-state IPC delivered FIRST so the welcome layer DOM is in closed-state markup when `welcome:show` (fired by hardReset) makes it visible. Inverting the order produces a one-frame "open" flash before the closed-state IPC arrives.
- **D-02:** Toggle-to-open path (`next === true`) does NOT call hardReset. The existing `pos-state-changed` IPC is sufficient — opening from closed state means the welcome layer is already foregrounded (admin tapped through nothing to reach the menu since taps were suppressed). No reset needed.
- **D-03:** Lazy `require('./sessionReset')` inside the toggle-pos-open handler body (NOT hoisted to module scope). Matches the Phase 10 D-10-05-04 convention for IPC-handler sessionReset access — avoids circular-dep load-time crashes.

### Failure handling (gray-area decision)

- **D-04:** If `sessionReset.hardReset` throws, the handler:
  1. Does NOT roll back `posOpen` — the store already shows `false` and stays that way.
  2. Emits a `log.audit('pos.state-changed.reset-failed', { error: err.message })` audit line.
  3. Still returns `{ ok: true, posOpen: false }` to the renderer (admin-side success — the state intent landed).
  4. The closed-welcome layer will render at the next natural reset trigger (idle timeout, sale-completed). The user's admin intent is preserved even if the immediate reset path fails.

  Rationale: hardReset failure is near-impossible (the Phase 5 + Phase 10 reset paths are well-exercised), but if it does fail rolling back posOpen would mask the admin's intent. The audit line captures the deviation for post-mortem.

### sessionReset filter exclusion

- **D-05:** Extend the countable filter in `sessionReset.js` to include `|| reason === 'pos-closed'` inside the existing `!(...)` negation, alongside the Phase 10 `'sale-completed'` clause. Single-line OR addition. No `mode` check — `mode:'welcome'` is canonical for pos-closed and matches the sale-completed pattern.

  Pattern lifted verbatim from Phase 10 D-10-01-01.

### onPostReset behavior

- **D-06:** No code change needed for `onPostReset` to fire on `pos-closed`. The existing `succeeded && postResetListener` gate at `sessionReset.js` already covers welcome-mode resets (welcome-mode branch sets `succeeded=true`). This means `updateGate` will see `pos-closed` resets identically to `sale-completed` and `idle-expired` resets — first-trigger-wins semantics preserved.

  Verified-by-pattern: matches Phase 10 D-10-01-02. A test will document this behavior (D-09 below).

### Test placement (gray-area decision)

- **D-07:** All new tests go into `test/sessionReset.test.js`. Two new cases:
  1. `'pos-closed' is excluded from the countable reset-loop counter` — mirrors Phase 10 D-17 test for `'sale-completed'` exclusion.
  2. `'pos-closed' welcome-mode reset fires onPostReset` — mirrors Phase 10 D-18 test for sale-completed onPostReset firing.

- **D-08:** The toggle-pos-open handler's hardReset call is NOT directly unit-tested (no new posClose.test.js, no main.js handler test extension). Rationale: the handler is two new lines (lazy require + conditional call); the meaningful behavior — that 'pos-closed' is filter-excluded and triggers onPostReset — lives in sessionReset, which D-07 covers. Mirrors how Phase 10 covers the post-sale handler logic via postSale.test.js (state-machine level) without unit-testing the main.js relay glue.

  If the toggle integration drifts in a future phase, a regression test can be added then.

### Audit ordering

- **D-09:** Audit line order on close-toggle:
  1. `pos.state-changed open=false reason=admin` (existing — fires inside toggle-pos-open handler, before hardReset).
  2. `session.reset reason=pos-closed mode=welcome` (existing sessionReset audit — fires from hardReset internals).
  3. On failure: `pos.state-changed.reset-failed error=<msg>` (new — see D-04).

  No new audit-event names beyond #3.

### Phase 09 D-06 supersede note (gray-area decision)

- **D-10:** Phase 09's `09-CONTEXT.md` D-06 entry is updated by APPENDING a one-line supersede note to the existing text. Original text is NOT modified. Append:

  > **SUPERSEDED by Phase 11 (2026-04-26):** D-06 reversed — closing POS now immediately triggers `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` regardless of the layer foregrounded when admin opens the menu. Rationale: UAT on 2026-04-26 surfaced that admins tapping the welcome layer to reach the menu (so they could close POS) land on the cash register after dismiss, contradicting the admin's mental model of "closing the POS = closing the kiosk." See `11-CONTEXT.md`.

  Append-only preserves the original-decision audit trail. The `09-DECISION-LOG.md` rationale ("no mid-checkout interruption") remains valid context for why D-06 originally landed that way.

### Claude's Discretion

- Exact wording of new audit event names (`pos.state-changed.reset-failed`) — open to renaming if the planner finds a more consistent convention in the existing audit surface.
- Whether to add a one-line code comment near the toggle-pos-open handler citing 11-CONTEXT D-01/D-04, or rely on commit message + CONTEXT cross-ref. Default: minimal comment per project comment-discipline conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 11 ground truth
- `.planning/ROADMAP.md` — Phase 11 detail block (lines ~110+); 7 success criteria locked here.
- `.planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md` — this file (D-01..D-10).

### Reversed prior decision
- `.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` D-06 — original "no mid-checkout interruption" decision being reversed by D-10. Read for reversal rationale.

### Pattern precedents (Phase 10 sale-completed)
- `.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md` D-17/D-18 — sessionReset filter exclusion + onPostReset firing pattern. Phase 11 D-05/D-06 are byte-mirror equivalents for `pos-closed`.
- `.planning/phases/10-post-sale-flow-with-print-interception/10-01-sessionreset-loop-filter-PLAN.md` — concrete plan that landed the sale-completed filter; 11-01 (forthcoming) follows the same shape.
- `.planning/phases/10-post-sale-flow-with-print-interception/10-09-updategate-composition-test-PLAN.md` — the D-18 composition test pattern for onPostReset firing on a new reason.

### Code touchpoints (read before planning)
- `src/main/main.js` `case 'toggle-pos-open':` (current implementation around lines 994–1003 per pre-Phase-11 layout) — the handler being extended.
- `src/main/sessionReset.js` countable filter (around line 249-256 per Phase 10 D-10-01-02 reference) — the OR-extension site.
- `src/main/sessionReset.js` `hardReset` entry — confirms `{reason, mode}` payload contract.
- `test/sessionReset.test.js` — existing 'sale-completed' tests (D-17/D-18) provide the template for new 'pos-closed' tests.

### Project context
- `.planning/STATE.md` "Roadmap Evolution" section — captures the 2026-04-26 UAT trigger for this phase.
- `CLAUDE.md` Tech Stack — Electron 41 + electron-log audit pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`sessionReset.hardReset({reason, mode})`** — already accepts arbitrary reason strings; the only contract surface is the countable-filter check + audit payload.
- **`sessionReset.onPostReset` listener** — already wired to `updateGate`; will fire for `pos-closed` welcome-mode resets without modification.
- **`pos-state-changed` IPC + `applyPosState(posOpen)` host handler** — already updates the welcome layer DOM to closed-state markup on the renderer. D-01 leverages this by sending pos-state-changed BEFORE hardReset.
- **electron-log audit transport** — `log.audit(event, payload)` is the canonical audit-write entry; D-04 and D-09 reuse it.

### Established Patterns
- **Lazy require inside handler bodies** (Phase 10 D-10-05-04) — `require('./sessionReset')` inside the case body to avoid circular-dep load-time crashes. D-03 enforces this.
- **Filter-exclusion via OR-extension** (Phase 10 D-10-01-01) — single-line addition to existing `!(...)` negation. D-05 mirrors.
- **Test mirror for new reset reasons** (Phase 10 sessionReset.test.js D-17/D-18) — two tests per new reason: filter exclusion + onPostReset firing. D-07 mirrors.

### Integration Points
- `case 'toggle-pos-open'` in `admin-menu-action` IPC handler — single insertion point for the new hardReset call.
- `sessionReset.js` countable filter — single insertion point for the new OR clause.
- `test/sessionReset.test.js` EOF — append two new tests in the `'sale-completed'` test block neighborhood.

</code_context>

<specifics>
## Specific Ideas

- The "background reset while admin menu is open" mental model came directly from UAT on 2026-04-26: admin tapped through welcome → cash-register page (incidentally, just to reach the menu) → opened admin menu → closed POS → dismissed menu → expected closed-welcome but landed on cash-register. The fix matches the user's intuition: closing POS is itself a reset event.

- Admin menu auto-close on POS toggle is NOT in scope. The menu stays open after the toggle confirms; the user dismisses it explicitly. The reset runs in parallel — the welcome layer (now closed-state) is what they see on dismiss.

</specifics>

<deferred>
## Deferred Ideas

- **Cash-register banner for `posOpen=false` mid-session** — Still deferred. Phase 11 doesn't address mid-checkout closes (where a real member transaction is in progress). If this becomes a real complaint, plan a follow-up phase that detects cart non-empty and either (a) defers the reset until cart-empty, or (b) shows a confirm-with-warning modal.

- **Auto-close admin menu on toggle** — Not requested in this UAT round. Could simplify the dismiss → see-closed-state flow into one tap. Captured here in case it surfaces later.

</deferred>

---

*Phase: 11-pos-close-immediate-welcome-reset*
*Context gathered: 2026-04-26*
