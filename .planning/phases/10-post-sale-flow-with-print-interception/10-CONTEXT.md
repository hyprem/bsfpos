# Phase 10: Post-Sale Flow with Print Interception — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver branded `#post-sale-overlay` that appears immediately after a successful Magicline sale, triggered by Electron print-event interception (with cart-empty-after-payment DOM-mutation fallback), counts down 10 seconds, and auto-returns the kiosk to a fresh welcome session via `sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})`. Microsoft Print to PDF is pre-configured as the default printer for the `bsfkiosk` Windows user so Chrome's print preview never reaches the member.

**Explicit non-goals:**
- Receipt PDF archiving to `%AppData%/Bee Strong POS/receipts/...` (deferred to v1.2, per REQUIREMENTS.md + source todo "locked" decisions)
- Real (paper) receipt printer integration — Print to PDF driver is intentionally no-op
- Any changes to existing `onPostReset` → `updateGate` wiring beyond adding `sale-completed` as a reason that still fires the hook
- Migration of the existing `BSK_AUDIT_SALE_COMPLETED` sentinel in `inject.js` (fires on the "Jetzt verkaufen" click for audit logging) — it runs orthogonally before payment confirmation and is preserved as-is
- Separate v1.1 UX for sale-cancelled-at-payment-modal — no print fires, cash register stays as-is, existing idle-timer path covers it (source todo edge cases)

</domain>

<decisions>
## Implementation Decisions

### Dismiss UX

- **D-01:** `#post-sale-overlay` dismiss is **button-only**. Only the "Nächster Kunde" button fires `post-sale:next-customer`. Tap-anywhere is explicitly rejected — a touchscreen kiosk with a member still operating the adjacent card terminal could register an accidental brush that both (a) dismisses the thank-you overlay they haven't read yet and (b) leaves Magicline session warm for the next member. Consistent with how `#idle-overlay` requires a deliberate "Weiter" button press.
- **D-02:** Hardware Esc does **NOT** dismiss the post-sale overlay. Esc is reserved as an admin-only affordance (Phase 08 D-01 admin menu close). Post-sale is a customer-facing flow; keyboardless touchscreen means a member cannot reach Esc anyway. Keeps customer UX predictable and deterministic.

### Countdown

- **D-03:** Countdown renders as **text-only**, reusing the `#idle-overlay` pattern: big numeric display + "SEKUNDEN" label in brand yellow on the dark branded card. No ring, no linear bar, no SVG animation. Zero new animation code. Pattern precedent: `host.html` lines 59–62 (`#idle-countdown-number` / `.bsk-idle-seconds-label`) and `host.css` `.bsk-idle-number` styles.
- **D-04:** Countdown DOM id: `#post-sale-countdown-number`. CSS class reuse: `.bsk-idle-number` + `.bsk-idle-seconds-label` (or new `.bsk-post-sale-*` aliases if the palette or sizing needs to diverge — Claude's discretion). Countdown ticks once per second via `setInterval(1000)` in host.js, same cadence as idle overlay.

### Idle Timer Behavior While Overlay Visible

- **D-05:** On `post-sale:show` IPC, main.js calls `idleTimer.stop()` to clear the current 60 s window. No new pause/resume API — source todo says "paused" informally, but the companion behavior ("Nächster Kunde rearms a fresh 60 s window") is fresh-start semantics, so `stop()` + later `start()` fully satisfies the requirement.
- **D-06:** On `post-sale:next-customer` IPC (button tap), main.js calls `idleTimer.start()` to arm a fresh 60 s window immediately. The Magicline view stays visible; cart stays as-is (member stays logged in for multi-purchase).
- **D-07:** On countdown auto-expiry (10 s), main.js calls `sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})`. Welcome-mode reset already stops the idle timer internally (step 4 of the D-15 sequence in `sessionReset.js`), then welcome layer takes over. No idle timer start needed on the welcome path — welcome has no idle.

### First-Trigger-Wins Race Guard

- **D-08:** Single module-scoped flag `postSaleResolved` in host.js (pattern precedent: `welcomeTapPending` in main.js for Phase 07 SPLASH-01). Set to `false` when overlay shows; latched to `true` by the FIRST of {button tap, countdown-expiry}. The second attempt becomes a no-op (logged as `info`, not `warn`). Eliminates the "tap at second 9.95 while auto-dismiss is about to fire" race without timing-dependent UI changes.
- **D-09:** The flag is owned by host.js (renderer) because both trigger paths originate there — button click handler and `setInterval` tick. Main.js receives only the resolved outcome via one of two IPC channels (`post-sale:next-customer` or `post-sale:auto-logout`).

### Print Interception (Claude's Discretion with recommendation)

- **D-10:** Primary trigger: Electron `webContents.on('-print', ...)` on the Magicline child view's `webContents` (set up in `magiclineView.js` alongside the existing `console-message` listener). Call `event.preventDefault()` to suppress the Chrome print preview, then `ipcMain.emit('post-sale:show')` (or forward via a new `ipcMain.handle` binding). Research must confirm the exact Electron 41 event signature and whether `-print` fires on `window.print()` calls inside the Magicline view — Electron historically ships `-print` as an internal/undocumented event.
- **D-11:** Fallback trigger: cart-empty-after-payment DOM mutation observer in `inject.js`. Observes the cart summary container; fires `BSK_POST_SALE_FALLBACK` console sentinel when (a) a payment modal was recently confirmed AND (b) cart count transitions from non-zero → zero. `magiclineView.js` console-message listener translates the sentinel into `post-sale:show` emit. Debounce ~500 ms so a React re-render glitch doesn't double-fire.
- **D-12:** Both triggers are gated by a single module-scoped `postSaleShown` flag in main.js that resets on every `hardReset({mode:'welcome'})` and on every `post-sale:next-customer`. Prevents double-show when both print-event and fallback fire within the same sale (common race if Magicline's print happens after cart-clears).

### Overlay Subtext Copy (Claude's Discretion with recommendation)

- **D-13:** Single fixed subtext: **"Vielen Dank für Ihren Einkauf!"** (member-facing, thank-you style — not system-facing "Einkauf bestätigt"). Conditional "Ihr Beleg wurde gedruckt" vs "Ihr Einkauf wurde bestätigt" is rejected because (a) Print to PDF always "prints" (silent, to disk or discard) so the distinction is invisible to the member; (b) branching copy couples the overlay design to which trigger fired, which the member cannot observe and does not care about.

### Print-to-PDF Default Printer Setup (Claude's Discretion with recommendation)

- **D-14:** Ship an **NSIS post-install PowerShell snippet** that sets Microsoft Print to PDF as the default printer for the current Windows user. Falls back to a documented admin runbook step if the installer can't be re-run (existing 0.1.x installs). Rationale: single-device kiosk installs via `electron-builder` NSIS; adding a post-install command is the least-ceremony way to make the behavior deterministic. App-startup PowerShell is rejected because it runs on every boot (wasteful) and a member-facing print dialog during startup would be catastrophic. Admin-runbook-only is rejected because a forgotten step yields the exact failure mode the phase is meant to eliminate (Chrome print preview shown to a member).
- **D-15:** If the NSIS path requires code-signing hoops beyond the v1.1 budget (research must check), fall back to a one-time PowerShell command documented in the runbook AND verified by an admin-menu diagnostic ("Standarddrucker: Microsoft Print to PDF" row in the diagnostics block). Verification is the backstop, not prevention.

### Fallback Trigger Scope (Claude's Discretion with recommendation)

- **D-16:** Ship BOTH triggers in Phase 10 (print-event primary + cart-empty fallback) per source todo. Research must spike `-print` behavior against a live Magicline sale first; if Magicline's print fires reliably for every Kartenzahlung, the fallback becomes defense-in-depth (cheap, ~30 lines in inject.js). If Magicline's print is inconsistent (e.g. only when "Beleg drucken" toggle is enabled), fallback is the primary path. Splitting the fallback into a follow-up v1.2 phase risks shipping a phase that only works in some sale configurations — unacceptable for the "hands-off" v1.1 goal.

### sessionReset / Loop Counter Extension

- **D-17:** Extend the reset-loop counter filter in `sessionReset.js` from the current `!(reason === 'idle-expired' && mode === 'welcome')` to ALSO exclude `reason === 'sale-completed'`. Rationale: REQ SALE-01 explicitly requires `'sale-completed'` excluded from the 3-in-60 s counter (source todo: "A member doing 4 quick sales in a minute should not trip the reset-loop guard"). `mode` will always be `'welcome'` for sale-completed, so the filter can be `(reason === 'idle-expired' && mode === 'welcome') || reason === 'sale-completed'` — welcome-mode semantics unchanged.
- **D-18:** `onPostReset` still fires for `sale-completed` welcome cycles. `updateGate`'s first-trigger-wins semantics (Phase 05 D-15/D-16, Phase 09 D-08/D-09) already handle the "install after sale" path correctly — no `updateGate.js` changes required by Phase 10. Unit test must verify sale-completed → post-reset → updateGate install path end-to-end.

### IPC Channel Naming

- **D-19:** New main → host IPCs: `post-sale:show`, `post-sale:hide`. New host → main IPCs: `post-sale:next-customer`, `post-sale:auto-logout`. Colon-separated convention matches Phase 06 D-02 / `welcome:show` / `welcome:tap`. Preload exposes `onShowPostSale`, `onHidePostSale`, `notifyPostSaleNextCustomer`, `notifyPostSaleAutoLogout`.
- **D-20:** `post-sale:auto-logout` handler in main.js is a thin adapter that calls `sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})`. Not `'sale-complete-logout'` or any other variant — the reason string is canonical per REQ SALE-01.

### Claude's Discretion

- Exact CSS palette for the branded yellow "Vielen Dank!" headline — aim for visual parity with existing `.bsk-btn--primary` yellow (`#F5C518` per source todo background note).
- Whether `#post-sale-overlay` uses its own CSS class or extends `bsk-layer--idle` for shared card styling.
- The exact `MutationObserver` DOM root for the cart-empty fallback — `inject.js` implementer picks the most stable container via `fragile-selectors.js`.
- Unit test granularity: separate `test/postSale.test.js` for the state machine vs extending `test/sessionReset.test.js` + `test/updateGate.test.js` for the cross-module wiring — planner decides.
- Whether `admin-menu` diagnostics row for "Standarddrucker" is added in Phase 10 or deferred as polish (D-15 backstop).

### Folded Todos

- **`2026-04-14-post-sale-vielen-dank-overlay-with-print-interception.md`** — Source todo for SALE-01. Full problem analysis, state machine, IPC contract, edge cases, and test plan. Locked decisions (from the "Decision" block at bottom of todo): "Nächster Kunde" keeps Magicline session alive; receipt PDFs NOT archived in v1.1; print interception is primary trigger with cart-empty as fallback.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — SALE-01 acceptance criteria (§Post-Sale Flow)
- `.planning/ROADMAP.md` — Phase 10 goal, success criteria, dependency on Phase 09
- `.planning/todos/pending/2026-04-14-post-sale-vielen-dank-overlay-with-print-interception.md` — Source problem report with full solution design, state machine, IPC contracts, edge cases, locked decisions, and test plan

### Prior Phase Contracts
- `.planning/phases/04-nfc-input-idle-session-lifecycle/04-CONTEXT.md` — D-07..D-12 idle state machine (idleTimer.start/stop semantics that D-05/D-06 consume)
- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md` — D-15/D-16 `onPostReset` single-slot listener contract, D-17 updateGate first-trigger-wins semantics, audit taxonomy (`sale.completed` is already canonical)
- `.planning/phases/06-welcome-screen-lifecycle-redesign/06-CONTEXT.md` — D-01 welcome logout mechanism, D-05 `mode:'welcome'` on `sessionReset.hardReset`, D-06 loop-counter exclusion pattern (extended in this phase's D-17), D-07 full storage wipe
- `.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` — D-07/D-08/D-09 updateGate `admin-closed-window` + first-trigger-wins — Phase 10 does NOT change updateGate, but sale-completed → onPostReset must still compose correctly with the Phase 09 trigger set

### Existing Source Files Phase 10 Modifies
- `src/main/sessionReset.js` — Extend loop-counter filter (D-17). No structural changes beyond the filter predicate.
- `src/main/magiclineView.js` — Add `webContents.on('-print', ...)` handler on the child view (D-10). Add console-message match for `BSK_POST_SALE_FALLBACK` sentinel (D-11).
- `src/main/main.js` — Register new IPC handlers (`post-sale:show` source, `post-sale:next-customer`, `post-sale:auto-logout`). Add `postSaleShown` dedupe flag (D-12). Wire idle timer stop/start around overlay (D-05/D-06/D-07).
- `src/main/preload.js` — Expose post-sale IPC surface (D-19).
- `src/main/idleTimer.js` — No code changes expected; existing `stop()`/`start()` suffice per D-05/D-06.
- `src/main/updateGate.js` — **NO changes.** `onPostReset` already handles sale-completed welcome cycles (D-18).
- `src/host/host.html` — Add `#post-sale-overlay` layer at z-index 180, countdown span, "Nächster Kunde" button (reuse `.bsk-btn--primary`).
- `src/host/host.css` — Styles for `#post-sale-overlay` (likely reuses `.bsk-layer--idle` card + own headline color).
- `src/host/host.js` — Overlay show/hide, countdown setInterval, `postSaleResolved` first-wins flag (D-08), button click handler, countdown-expiry auto-logout.
- `src/inject/inject.js` — Cart-empty-after-payment MutationObserver + `BSK_POST_SALE_FALLBACK` sentinel (D-11). Keep existing `BSK_AUDIT_SALE_COMPLETED` sentinel intact — different purpose, different trigger point.
- `src/inject/fragile-selectors.js` — Add selectors/labels needed for the cart-empty observer (if new ones are required beyond existing cart selectors).
- `test/postSale.test.js` (new) — State machine: show, countdown tick, auto-dismiss, button dismiss, first-wins race, dedupe against double-trigger.
- `test/sessionReset.test.js` — Extend with `'sale-completed'` reason excluded from loop counter + `onPostReset` still fires for it.
- `test/updateGate.test.js` — Extend with sale-completed → post-reset → install path (no new updateGate code, but end-to-end coverage).

### Build / Ops
- `build/` (NSIS installer config, electron-builder `nsis` target) — Add post-install PowerShell to set Microsoft Print to PDF as default printer per D-14. Research must check current `build/` scripts and confirm `electron-builder` NSIS hook points.
- `docs/runbook/` — Add post-install verification step for the default printer (D-14 + D-15 backstop).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`sessionReset.hardReset({reason, mode:'welcome'})`** — Already wipes storage + destroys view + emits `welcome:show`. Phase 10 only adds a new `reason` value; filter-extension in D-17 is the entire sessionReset touch.
- **`onPostReset` single-slot listener** (Phase 5 D-15/D-16) — Already wired to updateGate. A sale-completed welcome cycle composes with it for free (D-18).
- **`#idle-overlay` countdown pattern** — `#idle-countdown-number` span + `setInterval` in host.js + corresponding CSS. Direct template for the post-sale countdown (D-03/D-04).
- **`.bsk-btn--primary` branded button** — Yellow pill pattern reused across overlays; direct fit for "Nächster Kunde".
- **`webContents.on('console-message', ...)` listener** in `magiclineView.js` — Already parses `BSK_*` sentinels. Adding a new `BSK_POST_SALE_FALLBACK` match is a 4-line insert next to the existing `BSK_AUDIT_SALE_COMPLETED` branch.
- **Colon-separated IPC naming convention** — `splash:show`, `splash:hide-final`, `welcome:show`, `welcome:tap`. Phase 10's `post-sale:show` / `post-sale:next-customer` extends the same convention (D-19).
- **`welcomeTapPending` first-wins flag** — Pattern precedent in main.js for Phase 07 SPLASH-01. Host-side `postSaleResolved` (D-08) mirrors the pattern.

### Established Patterns
- **Layer-stack z-index discipline** — Documented in `host.html` header comment. `#post-sale-overlay` takes 180 (between welcome 150 and idle 200). No new tier required; no existing occupant at 180.
- **Main sends, host renders** — Post-sale overlay lifecycle follows this: `magiclineView` detects → `main.js` gates/dedupes → `post-sale:show` → host renders.
- **Lazy requires to break circular deps** — `sessionReset.js` already lazy-requires `idleTimer` and `magiclineView`. Phase 10 idle timer calls from main.js can use direct require; no new cycles introduced.
- **Audit taxonomy** (Phase 05 D-27) — `sale.completed` is already a canonical event (Phase 05 Plan 06 D-27). `log.audit('sale.completed', {})` already fires on "Jetzt verkaufen" click. Consider adding `log.audit('post-sale.shown', {trigger: 'print-event' | 'cart-empty-fallback'})` and `log.audit('post-sale.dismissed', {via: 'next-customer' | 'auto-logout'})` for observability.

### Integration Points
- **`magiclineView.createMagiclineView()`** — Add `webContents.on('-print', ...)` after existing `console-message` listener attach. Same lifecycle; same re-attach on sessionReset-driven view recreation.
- **`main.js` after Phase 09 IPC block** — Add post-sale IPC handlers alongside `toggle-pos-open`. Wire `startPostSaleFlow()` helper to encapsulate idle-timer stop + `post-sale:show` send + dedupe-flag set.
- **`host.js` wireIpcListeners()`** — Register `onShowPostSale`, `onHidePostSale`. Add a `postSaleResolved` module var + button click handler.
- **`preload.js` `kiosk` object** — Add the four new post-sale channels (D-19).
- **`sessionReset.js` countable filter** — Single line change per D-17.

### Known Fragility
- `'-print'` is historically undocumented in Electron and ships behavior differences across major versions. Research MUST confirm Electron 41 behavior on Windows against a live Magicline Kartenzahlung before committing to it as primary trigger. If `-print` does NOT fire reliably, the cart-empty fallback becomes primary and D-11 wording reverses (the observer stops being "fallback").
- Microsoft Print to PDF prompts for a filename by default. For silent operation we need the `Prompt` REG_DWORD set to 0 (or the Windows API silent-print path). Research must verify per-user vs per-printer registry scoping and confirm the NSIS install path can write it.

</code_context>

<specifics>
## Specific Ideas

- "Nächster Kunde" is intentionally safer-than-sorry: button-only dismiss, no tap-anywhere. The post-sale overlay is the ONLY visible thank-you signal the member gets — accidental brush-dismiss would erase the receipt of that signal.
- Single fixed "Vielen Dank für Ihren Einkauf!" subtext (D-13) — the member cannot observe which trigger fired (print-event vs cart-empty), so branching copy leaks implementation state that adds no value.
- NSIS post-install for default printer (D-14) is the "set once, never think about it" path. Every alternative fails open (a forgotten admin-runbook step → Chrome print preview leaks to a member → exactly the failure this phase is meant to fix).
- Ship both triggers in-phase (D-16). Splitting would leave the kiosk partially-working for some Magicline sale configurations; unacceptable for v1.1's "hands-off" goal.

</specifics>

<deferred>
## Deferred Ideas

- **Receipt PDF archiving** to `%AppData%/Bee Strong POS/receipts/YYYY-MM-DD/receipt-HHMMSS.pdf` — explicitly deferred to v1.2 per REQUIREMENTS.md and source todo. Print-to-PDF driver discards by default; capture as separate v1.2 todo if accounting needs an audit trail.
- **Tap-anywhere dismiss** — rejected in D-01 for the accidental-brush failure mode. If field UAT shows members complain about finding the button, revisit in a v1.2 polish item.
- **Ring / linear countdown visualization** — rejected in D-03 for zero-new-code reuse. Visual polish candidate for v1.2 if the text-only feels utilitarian in field use.
- **Conditional subtext by trigger** — rejected in D-13 as leaking implementation state to the member.
- **Separate PIN-ändern-mode within post-sale** (unrelated, mentioned in adjacent todos) — out of scope for Phase 10.

</deferred>

---

*Phase: 10-post-sale-flow-with-print-interception*
*Context gathered: 2026-04-23*
