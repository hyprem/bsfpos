# Phase 07: Locale Hardening & Splash Auto-Selection Race - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 07

<domain>
## Phase Boundary

Two coupled fixes surfaced during the 2026-04-14 hardware visit:

1. **Locale hardening** — Magicline must serve its cash-register UI in German (de-DE) regardless of the host Windows display language, so the German-text auto-selection click chain (`Kasse auswählen` → `Self-Checkout` → `Speichern`) works on any Windows install.

2. **Splash / auto-selection race** — On the welcome tap path, the splash currently hides on `cash-register-ready`, leaving a ~1–2 s window in which the member's finger can derail the visible auto-selection click chain. The splash must stay up (and block host-level pointer events) until the chain finishes, with a bounded safety timeout.

**Explicit non-goals (stay inside this fence):**
- No detection of the English "expired session" error page in inject.js — locale fix removes that page.
- No changes to cold-boot or idle-recovery splash paths — welcome path only.
- No NFC routing considerations — arbiter is descoped.
- No new `admin.*` IPC, PIN changes, or post-sale overlay work — those are Phases 08–10.

</domain>

<decisions>
## Implementation Decisions

### Locale Enforcement (LOCALE-01)

- **Belt-and-suspenders, both layers.** Ship both mechanisms; either alone is considered insufficient:
  1. `app.commandLine.appendSwitch('lang', 'de-DE')` in `src/main/main.js` BEFORE `app.whenReady()`.
  2. Override `Accept-Language: de-DE,de;q=0.9` on the magicline session via `session.fromPartition('persist:magicline').webRequest.onBeforeSendHeaders(...)`.
- **Verification gate:** manual kiosk visit with Windows set to English-US must render Magicline UI in German AND successfully complete the auto-selection chain on first welcome tap. Structured log line `auto-select.result=ok` must appear in the audit log for that run.

### Auto-Select Selector Strategy

- **Hybrid: stable selectors where Magicline exposes them, locale text table for the rest.**
- **Survey first.** Before writing selectors, survey the Magicline DOM on the live kiosk for stable hooks (`data-role`, `id`, `aria-*`) on each of: `Kasse auswählen`, the autocomplete `Self-Checkout` option, and the `Speichern` submit. Use whatever stable hook exists; fall back to text match.
- **Locale strings live in `src/inject/fragile-selectors.js`** in a new `LOCALE_STRINGS.de` (or equivalent) block alongside `JETZT_VERKAUFEN_TEXT`. Exactly one place to patch when Magicline copy drifts. No other file in the codebase may hard-code `'Kasse auswählen'`, `'Self-Checkout'`, or `'Speichern'`.
- **Structured log line on every chain run:** emit `auto-select.result=ok|fail|timeout` with a `step` field indicating which step succeeded last (so kiosk-visit inspectors can grep which selector drifted).

### Splash Gate on Welcome Path (SPLASH-01)

- **New IPC signal.** Introduce `splash:hide-final` as the welcome-path splash hide signal. The existing `cash-register-ready → splash:hide` path remains unchanged as the cold-boot and idle-recovery code path.
- **Bridge.** inject.js emits a sentinel (same pattern as `BSK_AUDIT_SALE_COMPLETED`) from a single `markRegisterReady({degraded})` function called from:
  - the successful end of the auto-select chain (after `Speichern` click resolves),
  - the "already on cash register, no selection needed" branch (so non-selecting boots still hide the splash),
  - the bounded-retry failure branch (`degraded:true`, still hides splash so the user sees the manual picker rather than stuck splash).
- **Safety timeout: 5 seconds** from welcome tap. If `splash:hide-final` has not arrived in that window, host falls back to the existing `cash-register-ready → splash:hide` path and the audit log gains `auto-select.result=timeout`.
- **Welcome-only scope.** The `splash:hide-final` gate applies ONLY to the welcome-tap path. `src/host/host.js` splits the existing handler accordingly; cold-boot and idle-recovery continue to respond to `splash:hide` unchanged.

### Pointer Blocking During Auto-Select Window

- **Splash blocks host-level pointer events** while in `auto-select-pending` state (welcome path only, from welcome tap until `splash:hide-final` or timeout).
- **Rationale:** inject.js synthesizes all click-chain events inside the Magicline DOM via `element.click()`, not via host-level pointer events. Blocking host-level pointer events on the splash layer therefore closes the derail window completely without breaking the synthetic clicks.
- **Verification step during execution:** manual kiosk test must confirm that tapping anywhere on the splash during auto-select is swallowed and does NOT reach the underlying Magicline view.

### Claude's Discretion

- Exact CSS mechanism for the pointer block (a new `.auto-select-pending` class on the splash vs. a state attribute vs. toggling `pointer-events` inline) — implementation detail, pick what fits `host.css` conventions.
- Exact retry/backoff strategy for `detectAndSelectRegister()` failures before emitting `degraded:true` — must be bounded and must always emit eventually.
- The internal shape of the `LOCALE_STRINGS` table (flat constants vs. nested by page) — one-file cost either way.
- Exact name of the per-step log field (`step=kasse-auswaehlen` vs. `step=1` etc.) — needs to be greppable from kiosk-visit logs.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — LOCALE-01 and SPLASH-01 acceptance criteria
- `.planning/ROADMAP.md` — Phase 07 goal and success criteria
- `.planning/todos/pending/2026-04-14-lock-magicline-ui-to-de-de-regardless-of-windows-language.md` — LOCALE-01 source problem report
- `.planning/todos/pending/2026-04-14-keep-splash-visible-until-auto-selection-completes.md` — SPLASH-01 source problem report

### Existing code Phase 07 modifies
- `src/main/main.js` — app.commandLine / session header override land here; also hosts `welcome:tap` and existing `splash:hide` sender
- `src/main/preload.js` — `onHideSplash` bridge; add a new `onHideSplashFinal` (or equivalent) here
- `src/inject/inject.js` §261–346 — current `detectAndSelectRegister()` chain and `cash-register-ready` emission
- `src/inject/fragile-selectors.js` — home for the new `LOCALE_STRINGS` block (D-21 single-file drift pattern, modeled on `JETZT_VERKAUFEN_TEXT`)
- `src/host/host.js` §45 — welcome-layer pointer handler and existing splash logic
- `src/main/magiclineView.js` — loads fragile-selectors.js + inject.js into the partition; owns the magicline session

### Prior-phase context
- `.planning/phases/06-welcome-screen-lifecycle-redesign/06-CONTEXT.md` — welcome lifecycle and `welcome:tap`/`cash-register-ready` contracts this phase extends
- Decision log entry D-21 (fragile drift-patch blast-radius rule) — enforces the single-file locale table

</canonical_refs>

<specifics>
## Specific Ideas

- Use the existing inject→main sentinel bridge (same pattern as `BSK_AUDIT_SALE_COMPLETED`) for `register-selected`; do not invent a new transport.
- Model the `markRegisterReady()` helper on `emit('cash-register-ready', …)` in inject.js so the existing one-shot/idempotency semantics carry over.
- Verify on the kiosk with Windows display language set to English-US (not just German) — the bug only reproduces when host locale ≠ de-DE. See reference memory: kiosk is the new Win 11 Pro PC on home network, RDP accessible, so this test is doable remotely.

</specifics>

<deferred>
## Deferred Ideas

- Detecting the English "expired session" error page in inject.js — explicitly out of scope because the locale fix removes the page.
- Any broader i18n table beyond the auto-select chain strings (e.g. login error text) — not part of Phase 07; raise if a second drift incident proves it needed.
- A "drift-incident grep" audit log query helper — nice-to-have tooling, not blocking.

</deferred>

---

*Phase: 07-locale-hardening-splash-auto-selection-race*
*Context gathered: 2026-04-14 via /gsd-discuss-phase*
