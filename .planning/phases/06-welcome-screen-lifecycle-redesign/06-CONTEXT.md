# Phase 6 — Welcome-Screen Lifecycle Redesign: Context

**Phase goal:** Replace the register-as-resting-state model with a welcome-as-resting-state model. Lifecycle becomes `cold-boot → welcome → tap → login → register → 10s "Noch da?" warning → logout → welcome`. Eliminates the third-cycle re-login failure observed during hardware testing by resetting Magicline session state from scratch on every cycle.

**Phase boundary (fixed):** Replace idle reset / in-place re-login flow with a welcome-screen bookended lifecycle. No new capabilities beyond that.

## Motivation (for downstream agents)

Hardware testing on 2026-04-12 surfaced a reproducible failure: after two successful idle-reset cycles, the third cycle's auto-login landed on a Magicline "Du bist nicht berechtigt… Zugang abgelaufen" retry page that `inject.js` selectors did not match. Root cause was stale server-side session state bleeding across in-place re-logins. A self-heal path was added (`authFlow.cookieRetryUsed` + `clearCookiesAndReload`) as a last-resort backstop, but the real fix is to stop trying to reuse the Magicline session at all — full logout + fresh login on every cycle. Framing the kiosk around a welcome screen makes the logout→login loop feel intentional rather than jarring, because the perceived "idle cost" becomes a single tap on the branded landing view.

## Decisions (locked)

### D-01: Logout mechanism — full storage wipe + view rebuild

- **Choice:** Option 1b from discussion — `session.clearStorageData()` on `persist:magicline` with full storage set (no preservation), followed by Magicline view teardown. Magicline view stays destroyed until next tap on welcome.
- **Storage set:** `['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'cachestorage', 'serviceworkers']` — fully clean. Phase 4's register-selection cookie preservation is DROPPED for welcome logouts (see D-05).
- **Rejected:** Clicking the hidden Abmelden `<span>` inside Magicline's context-menu DOM. That leaves in-memory React state intact and does not address the 3rd-cycle failure mode, which is the whole point of the phase.

### D-02: Welcome view — new host.html layer with German CTA

- **Placement:** New layer `#welcome-screen` at z-index **150** (above `#magicline-mount` at 0, below `#idle-overlay` at 200). Toggled via `display` from `host.js`, consistent with the existing layer-stack discipline in `host.html`.
- **Copy:** "Zum Kassieren tippen" (primary CTA), logo, no secondary text. Full-viewport touch target — tap anywhere dismisses welcome and triggers login. No dedicated button.
- **Trigger events host.js emits to main:** `welcome:tap` IPC. Main responds by starting the login flow (recreate Magicline view + `authFlow.start()`).
- **No badge-scan shortcut:** Badge scans on the welcome screen do NOT behave like a tap — deferred to a future milestone. During welcome, the badge reader's keystrokes should be ignored or consumed without triggering login. Magicline cash register can operate without a member loaded (confirmed by user), so first-tap-then-scan is a valid happy path.

### D-03: Cold boot lands on welcome (no pre-warm)

- **Choice:** On app launch, after splash/updates/credential availability checks, main.js lands directly on the welcome view. No background Magicline view creation, no pre-warmed login. First tap pays the full ~3–5s login latency.
- **UX during first tap:** Welcome layer hides and a loading indicator (reuse the existing splash or a subset of it) shows until `cash-register-ready` fires, then the register is revealed. Host.js owns this transition; Plan will specify exact layers used.
- **Rejected:** Pre-warming Magicline in a hidden view behind welcome. Adds race complexity (what if pre-warm fails silently? what if user taps mid-pre-warm?) for a one-time-per-cycle 3-second saving. Not worth it for v1.0.

### D-04: Idle warning — keep "Noch da?", shortened to 10s

- **Choice:** Keep the existing Phase 4 idle overlay as a **10-second** pre-logout warning (down from 30s). Protects mid-checkout members against accidental cart loss on brief hesitation.
- **Timing:** Activity-idle window stays 60s (IDLE-01 / `IDLE_TIMEOUT_MS`). On timeout: show "Noch da?" overlay with 10s countdown. Tap → `idleTimer.dismiss()` resumes the session (existing path, no changes). Countdown expiry → logout to welcome (new path, D-06).
- **Change:** `OVERLAY_TIMEOUT_MS` in `idleTimer.js` goes from 30_000 to 10_000. Host.js countdown text stays "10" instead of "30".
- **Rejected:** Dropping the warning entirely. A member pausing mid-transaction for 30s (counting cash, reading product label) would lose their cart with no signal — UX regression.

### D-05: Reuse `sessionReset.hardReset` with a mode flag

- **Choice:** Extend `sessionReset.hardReset({ reason })` to accept a new `mode` parameter: `'reset'` (current Phase 4 behavior — preserves register-selection cookies, recreates Magicline view immediately) or `'welcome'` (new Phase 6 behavior — full storage wipe, view stays destroyed, host.js shows welcome layer).
- **New call site:** `idleTimer.expired()` now calls `sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' })`.
- **Register selection:** `mode: 'welcome'` does NOT preserve the register-selection cookie. Re-selection runs on every login via the existing `inject.js` auto-select path (bug fix #7 from hardware testing). Adds ~1s to login; acceptable.
- **New post-reset hook:** After successful hardReset in welcome mode, main emits `welcome:show` IPC to host.js. Host.js displays `#welcome-screen`. Magicline view stays destroyed until `welcome:tap`.
- **Preserved behaviors:** Reset-in-flight mutex, pre-reset subscribers (WR-08), `lastResetAt` tracking, Phase 5 updateGate post-reset listener — all still fire for both modes.

### D-06: Reset-loop detection — exclude welcome-logouts from counter

- **Choice:** 4a from discussion. The rolling 60s / 3-reset window in `sessionReset.js` only counts resets where `reason !== 'idle-expired'` OR `mode !== 'welcome'`. Welcome logouts are expected user behavior (a bored member tapping welcome → waiting → tapping again within 60s should not trip a fatal error), not symptom of a bug.
- **Still counted:** Render-process-gone crashes, admin-requested resets, self-heal-triggered resets (`boot-watchdog-expired-self-heal`). These remain bounded at 3/60s.
- **Implementation note:** The existing `resetTimestamps` array stores `{ t, reason }`. Extend to `{ t, reason, mode }` and filter on the count check. Preserve the existing `log.audit('idle.reset', ...)` for observability on all resets including welcome-excluded ones.

### D-07: Cart persistence — fully clean on welcome logout

- **Choice:** Option 5 from discussion. `mode: 'welcome'` clears the full storage set including `localstorage`. No register-selection preservation, no cart preservation, no "optimize the 2nd cycle" shortcuts. The whole point is a fully fresh Magicline session.
- **Implication:** We do NOT need a kiosk probe to verify cart persistence — full storage wipe is definitional. If Magicline somehow still remembers cart after this, it would be server-side (tied to auth session), which is also eliminated by the full logout.
- **Phase 4 `mode: 'reset'` behavior:** Unchanged — still preserves persistent cookies per the Phase 4 contract. This is only the welcome path being fully clean.

### D-08: Self-heal path interaction

- **Choice:** The existing self-heal on `boot-watchdog-expired-self-heal` (authFlow.js, post-2026-04-12) stays as-is. It fires on the *first* login attempt failing, not on idle-reset cycles, so it runs orthogonally to the welcome flow.
- **Under welcome:** First tap triggers login. If the 8s post-submit watchdog expires, self-heal clears partition and retries exactly as today. If self-heal also fails, the fallthrough is `CREDENTIALS_UNAVAILABLE` error → admin PIN recovery. No welcome-specific retry logic.
- **Follow-up not in scope:** The Phase 3 contingency "post-login navigation guard in inject.js that detects non-cash-register route and forces `location.hash = '#/cash-register'`" is NOT required under welcome flow, because welcome-logouts now fully wipe localStorage, removing the SPA-last-route source of that bug. If the self-heal path is ever triggered, it also clears localStorage (already fixed).

## Specifics the user said

- "Welcome screen → on tap → loads cash register → if idle for 30 seconds → (maybe logs out) → shows welcome screen again" — original framing of the loop.
- "No badge scan at this time, will add later in another milestone. Cash register can work with no member loaded." — defers NFC-as-welcome-trigger to v1.1+.
- "Keep 'Noch da?' but to 10 seconds." — D-04 timing.
- "Reuse with a mode flag." — D-05.
- "4a" — exclude welcome logouts from loop counter, D-06.
- "Go fully clean for welcome logout." — D-07.

## Requirements touched

Primary (behavior changes):

- **IDLE-01** — idle timeout window unchanged at 60s, but the post-timeout path now ends at welcome, not at a re-logged-in register.
- **IDLE-02** — "Noch da?" overlay countdown reduced from 30s to 10s.
- **AUTH-01, AUTH-02, AUTH-03, AUTH-04** — auto-login is no longer "on boot"; it is "on tap" from welcome. The login *procedure* itself is unchanged; only the trigger moves.
- **NFC-05** — badge-scan-during-welcome is explicitly out of scope; welcome ignores keystrokes. Needs to be documented so the verifier does not flag missing functionality.

Secondary (no behavior change, but touched during wiring):

- **IDLE-03** — hard reset still funnels through `sessionReset.hardReset`, just with a new mode.
- **IDLE-04** — 100-cycle sessionReset harness must still pass; may need a second harness variant for the welcome path.
- **IDLE-05** — reset-loop detection semantics change per D-06.

## Scope guardrails (deferred, not in scope)

- **Badge scan on welcome** — defer to v1.1 / next milestone. Would pre-fill customer field after auto-login.
- **Pre-warm login** — defer indefinitely unless perceived tap-to-register latency becomes a complaint.
- **Welcome analytics** — no counting of taps-without-purchase, session duration, etc. Not a requirement.
- **Multi-language welcome copy** — single-device, German-only. No i18n scaffold.

## Canonical refs

- `.planning/ROADMAP.md` — Phase 6 entry (added 2026-04-13)
- `.planning/phases/04-nfc-input-idle-session-lifecycle/04-CONTEXT.md` — idle state machine decisions (D-07..D-12) that Phase 6 extends
- `.planning/phases/04-nfc-input-idle-session-lifecycle/04-VERIFICATION.md` — IDLE-01..07 authoritative spec
- `.planning/STATE.md` — session continuity entry for 2026-04-12 (hardware testing, self-heal, 3rd-cycle bug)
- `src/main/idleTimer.js` — idle state machine (IDLE / OVERLAY_SHOWING / RESETTING)
- `src/main/sessionReset.js` — hardReset entry point, cookie preservation, loop detection
- `src/main/authFlow.js` — auto-login state machine, self-heal path
- `src/main/magiclineView.js` — view create/destroy/visibility
- `src/host/host.html` — layer stack (welcome goes at z-index 150)
- `src/host/host.js` — layer toggling, countdown owner
- `src/inject/inject.js` — register auto-select, drift detection

## Open questions for the planner / researcher (not for the user)

- Exact IPC channel names for `welcome:show` / `welcome:tap` (follow Phase 1 colon-separated convention).
- Whether `mode: 'welcome'` needs a separate entry in the Phase 5 audit taxonomy (`idle.reset` vs new `welcome.logout`?) — consult Phase 5 CONTEXT for the taxonomy rules.
- Whether the existing `show-idle-overlay` IPC + host countdown can be reused verbatim for the 10s window, or if a new channel is cleaner.
- Reset-loop filter: does the `loopActive` latch get cleared when a welcome-logout fires, or does it persist across mode boundaries? (Lean: persist — a latched loop is still a latched loop.)
- Plan 06-01 should include a kiosk-visit verification item: run ≥5 consecutive welcome→tap→register→idle→logout cycles without tripping any error and confirm cart does not persist across cycles.
