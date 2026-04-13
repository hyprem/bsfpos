# Phase 6 — Welcome-Screen Lifecycle Redesign: Verification

**Phase:** 06-welcome-screen-lifecycle-redesign
**Plans:** 06-01 (host layer + preload IPC + 10s countdown), 06-02 (idleTimer + sessionReset welcome branch), 06-03 (main.js cold-boot-to-welcome + welcome:tap handler), 06-04 (this plan — harness + verification docs)
**Status:** code-complete + automated-green, physical verification DEFERRED to next kiosk visit
**Phase goal:** Replace in-place idle-reset re-login with a welcome-screen bookended lifecycle. Eliminates the 3rd-cycle stale-session failure observed during hardware testing on 2026-04-12 by fully wiping Magicline state on every logout.

---

## Acceptance Matrix

Every requirement touched by Phase 6 maps to an automated test, a physical check, or both.

| Req | Truth | Automated | Physical |
|-----|-------|-----------|----------|
| IDLE-01 | 60s activity-idle timer unchanged (`IDLE_TIMEOUT_MS = 60_000`) | `test/idleTimer.test.js` | Phase 1 next-visit batch — Phase 6 row (step 3) |
| IDLE-02 | "Noch da?" overlay countdown is 10s (D-04 — down from 30s) | `test/idleTimer.test.js` Phase 6 describe block (`OVERLAY_TIMEOUT_MS === 10_000`) + `src/host/host.js` countdown literal = 10 | Phase 1 next-visit batch — Phase 6 row (step 3) |
| IDLE-03 | Welcome-mode `hardReset` clears all 6 storages incl. localstorage, destroys view, emits `welcome:show`, does NOT recreate view | `test/sessionReset.test.js` Phase 6 Tests 1–12 + `test/sessionReset.welcome-harness.test.js` | Phase 1 next-visit batch — Phase 6 row (steps 2, 4, 5) |
| IDLE-04 | ≥5 consecutive welcome cycles survive without bleed-through or loop-guard trip | `test/sessionReset.welcome-harness.test.js` (this plan — 5-cycle harness, 6 assertions) | Phase 1 next-visit batch — Phase 6 row (step 6 — ≥5 cycles) |
| IDLE-05 | Welcome idle-expired resets excluded from the 3-in-60s loop counter; non-welcome resets still counted (D-06) | `test/sessionReset.test.js` Phase 6 Tests 6, 7, 8a, 8b, 8c (filter cases) + `test/sessionReset.welcome-harness.test.js` Assertion 4 | N/A — fully covered by automated tests |
| AUTH-01..04 | Auto-login fires on `welcome:tap` (not on cold boot) against a freshly-created Magicline view | Existing `test/authFlow.test.js` coverage — login *procedure* unchanged, only the trigger moved. `main.js` integration is manually smoke-tested via `npm start`. | Phase 1 next-visit batch — Phase 6 row (steps 2, 5) |
| NFC-05 | Badge keystrokes during welcome are intentionally ignored (no dismiss, no IPC). Deferral documented. | Code review — `src/host/host.js` `handleWelcomeTap` binds only `pointerdown` + `touchstart`, never `keydown`. Badge wedge keystrokes do not have a path to welcome:tap. | Phase 1 next-visit batch — Phase 6 row (step 7) |

---

## Automated Test Inventory

| Test file | Coverage | Tests | Result |
|-----------|----------|-------|--------|
| `test/idleTimer.test.js` | Phase 6 `OVERLAY_TIMEOUT_MS = 10_000` + `expired()` forwards `{reason:'idle-expired', mode:'welcome'}` | 12 (2 new in Phase 6) | PASS |
| `test/sessionReset.test.js` | Phase 4 baseline + Phase 6 welcome-mode describe block (Tests 1–12: storage wipe shape, view lifecycle, `welcome:show` IPC, no cookie save/restore, timestamp mode tagging, loop-counter exclusion single + mixed, audit mode field, pre/post listeners, default-mode regression, in-flight mutex) | 26+ | PASS |
| `test/sessionReset.welcome-harness.test.js` | **This plan** — 5-cycle welcome-mode harness, 6 assertions (storage shape per cycle, view destroy count / never recreate, welcome:show IPC per cycle, loopActive stays false, resetTimestamps all tagged mode=welcome, pre/post listeners fire per cycle) | 1 test × 6 assertions | PASS |
| `test/phase4-integration.test.js` | Cross-module wiring; payload shape matches Phase 6 `{reason,mode}` contract | 9 | PASS |
| Full suite | `node --test test/*.test.js` | **286/286** | PASS |

Canonical runner: `node --test test/*.test.js`. `package.json` has no `test` script — Phase 6 plans use the node built-in runner directly (documented in 06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md).

---

## Physical Verification (Deferred to Next Kiosk Visit)

Consolidated into the Phase 1 next-visit batch — see
[`.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md`](../01-locked-down-shell-os-hardening/01-VERIFICATION.md)
under the new "Phase 6 — Welcome Loop Physical Verification" subsection (added by Plan 06-04).

### Phase 6 row (single consolidated entry)

**Phase 6 welcome-loop smoke:**

1. Cold boot the kiosk. **Expected:** splash → welcome layer with "Zum Kassieren tippen" copy in brand yellow (`#F5C518`) on `#1A1A1A` background; Magicline view NOT pre-warmed.
2. Tap anywhere on the welcome layer. **Expected:** splash loading indicator appears → Magicline cash register renders cleanly within ~5s (first tap pays the full login latency, per D-03).
3. Stand away; wait 60s. **Expected:** "Noch da?" overlay appears with countdown starting at "10" (not "30" — D-04).
4. Let the 10s countdown expire without interaction. **Expected:** overlay dismisses → brief splash → welcome layer reappears (welcome:show emitted by `sessionReset.js` welcome branch, view stays destroyed).
5. Tap welcome again. **Expected:** fresh login flow lands on a clean cash register — no cart bleed from the previous session, no prior customer loaded, no stale-session error page.
6. Repeat steps 2–5 **FIVE times consecutively**. **Expected:** every cycle lands on a clean cash register; the "Kiosk muss neu gestartet werden" reset-loop branded error screen is NEVER shown (D-06 excludes welcome logouts from the 3-in-60s loop counter).
7. During step 1 or step 4 (while the welcome layer is visible), if the Deka NFC reader is connected, scan a staging badge. **Expected:** no effect — welcome only reacts to tap; badge-on-welcome is explicitly deferred to v1.1 (NFC-05 deferral per D-02).

**Pass criteria:** 5 of 5 cycles clean, no error screens, cart never persists across cycles, countdown starts at 10, badge-on-welcome ignored.

---

## Deferred Scope (NOT Phase 6)

The following are explicitly out of scope for v1.0 per `06-CONTEXT.md`:

- **Badge-scan-on-welcome** (deferred to v1.1 / next milestone) — would pre-fill customer field after auto-login.
- **Pre-warm Magicline view behind welcome** (deferred indefinitely) — D-03 rejected as race-prone for a one-time-per-cycle ~3s saving.
- **Welcome analytics** — no counting of taps-without-purchase, session duration, conversion rate.
- **Multi-language welcome copy** — single-device, German-only. No i18n scaffold.

---

## D-XX Coverage

Every locked decision in `06-CONTEXT.md` is realised by at least one plan:

| Decision | Topic | Realised by |
|----------|-------|-------------|
| D-01 | Logout mechanism = full storage wipe + view rebuild (not Magicline's hidden Abmelden span) | 06-02 Task 2 (`sessionReset.js` welcome branch) |
| D-02 | Welcome view = new `#welcome-screen` layer at z-index 150, full-viewport tap target, German CTA | 06-01 Tasks 1–2 (`host.html` / `host.css` / `host.js` / `preload.js`) |
| D-03 | Cold boot lands on welcome; no pre-warmed Magicline view | 06-03 Task 1 (`main.js` — `showWelcomeOnColdBoot` + gated `startLoginFlow`) |
| D-04 | Keep "Noch da?" but shorten to 10s | 06-01 Task 2 (host countdown literal) + 06-02 Task 1 (`OVERLAY_TIMEOUT_MS`) |
| D-05 | Reuse `sessionReset.hardReset` with a `mode` param (`'welcome'` vs `'reset'`) | 06-02 Task 2 (branch) + 06-03 Task 1 (`welcome:tap` handler is the sole entry into login flow) |
| D-06 | Reset-loop counter excludes welcome-idle-expired entries | 06-02 Task 2 (filter) + 06-04 Task 1 (5-cycle harness verifies at scale) |
| D-07 | Welcome logout is fully clean (no cart, no cookie, no register-selection preservation) | 06-02 Task 2 (6-storage wipe including localstorage) |
| D-08 | Self-heal path stays orthogonal (runs on first-login watchdog, not on idle-reset cycles) | No-op — existing `authFlow.js` self-heal path preserved; welcome logouts now independently wipe the same state self-heal used to repair |

---

## Close Posture

Phase 6 is **code-complete + automated-green** as of 2026-04-13. Full test suite is 286/286 (was 285 pre-06-04; this plan added the 1 harness test). Physical verification is folded into the Phase 1 next-visit consolidated batch so the next kiosk visit closes deferred items from Phases 1, 3, 4, 5, and 6 in a single pass.

**Does not block v1.0 milestone** — the welcome lifecycle is fully implemented; the kiosk-visit row is the on-hardware regression check, not a gating gap.
