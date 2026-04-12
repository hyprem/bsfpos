---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed
last_updated: "2026-04-12T13:01:04.651Z"
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 32
  completed_plans: 32
  percent: 100
---

# Project State: Bee Strong POS Kiosk

**Last updated:** 2026-04-10

## Project Reference

**Core value:** A gym member can walk up, scan their badge, have a product scanned (or self-selected), pay, and walk away — without staff interaction and without being able to break out of the locked Magicline cash register page.

**Current focus:** Phase 05 — admin-exit-logging-auto-update-branded-polish

## Current Position

Phase: 05
Plan: Not started

- **Milestone:** v1.0
- **Phase 01** (locked-down-shell-os-hardening): ✓ COMPLETE (6/6 plans; visual debt in next-visit batch)
- **Phase 02** (magicline-embed-injection-layer): ✓ COMPLETE (5/5 plans)
- **Phase 03** (credentials-auto-login-state-machine): ✓ COMPLETE (10/10 plans; TabTip soft re-check in next-visit batch)
- **Phase 04** (nfc-input-idle-session-lifecycle): ✓ COMPLETE (5/5 plans; 13 physical rows deferred to next-visit batch)
- **Phase 05** (admin-exit-logging-auto-update-branded-polish): ✓ COMPLETE (6/6 plans)
- **Status:** v1.0 milestone complete
- **Progress:** [██████████] 100%
- **Last completed:** Plan 05-06 (log migration + verification) at 2026-04-10 — commits a7604de, 93b2f7e, 10b9a5f. 265/265 tests green. ADMIN-04 / ADMIN-05 / BRAND-02 closed.

## Performance Metrics

- Phases complete: 4 / 5
- Plans complete: 26 / 26 (within planned phases; Phase 5 still TBD)
- Phase 04 landed 5 plans as planned; Phase 5 `Plans: TBD` until `/gsd-plan-phase 5` runs

## Accumulated Context

### Decisions

See PROJECT.md "Key Decisions" table for the full list. Roadmap-level highlights:

- Collapsed to 5 phases per coarse granularity; NFC + idle + reset combined into one phase because they share the main-process idle-timer / badge-arbiter state.
- Phase ordering strictly follows the research dependency chain: OS hardening → embed → auth-login → idle/reset → admin/update/branding.
- **Phase 01:** main.js split with ORCHESTRATION marker so plan 03 can replace only the bottom orchestration block while keeping createMainWindow intact; preload.js exposes only callback-shaped APIs; D-14 realized as Win11 Pro per-user Winlogon Shell override via 04-gpo-hardening.ps1; D-15 AutoAdminLogon plaintext DefaultPassword accepted tradeoff mitigated by standard user + BitLocker + physical location; attachLockdown + reservedShortcuts exported from src/main/keyboardLockdown.js.
- **Phase 02:** Fragile MUI selectors isolated to `src/inject/fragile-selectors.js`; stable + fragile selector audit log fires on every boot; drift isolation is single-file-patchable.
- **Phase 03:** Credentials encrypted via Electron `safeStorage` (DPAPI); authFlow is a pure reducer + executor split with atomic persist (D-11); reCAPTCHA on failed login forces recovery via admin PIN + manual re-entry; D-17 TabTip verified manual-button strategy on proxy box (03-09 2026-04-10).
- [Phase 04]: 04-03: wire-up plan adds start-idle-timer side-effect from CASH_REGISTER_READY reducer (both branches) — idleTimer arms automatically regardless of cookie-session vs login path
- [Phase 04]: 04-05: deferred-close posture — automated 102/102 green (including 100-cycle sessionReset harness as IDLE-04 literal acceptance); all 13 physical human-verification rows consolidated into the Phase 1 next-visit batch because kiosk hardware + Deka reader were unavailable on close date. Does NOT block Phase 5.
- [Phase 05]: Flipped electron-log pin tilde->caret to align with CLAUDE.md rule (05-01)
- [Phase 05]: log.audit uses field-name allowlist redactor, not value scanning (D-25, 05-01)
- [Phase 05]: Plan 02: adminPinLockout is a pure wrapper — adminPin.js (Phase 3 D-10) preserved with zero diff
- [Phase 05]: Plan 03: updateGate.js is pure DI module (no electron import) — Plan 05-04 owns NsisUpdater wiring via injected installFn
- [Phase 05]: Plan 03: sessionReset.onPostReset uses local succeeded flag inside try to guarantee no fire on throws or short-circuits (T-05-17)
- [Phase 05]: Plan 05-05: context-aware PIN modal (pinModalContext) routes admin hotkey to verifyAdminPin and reset-loop to legacy verifyPin
- [Phase 05]: Plan 05-05: update-failed variant uses dual cleanup (10s timeout + once pointerdown), hideMagiclineError clears both
- [Phase 05]: Plan 06: sale-completed bridge uses console.log sentinel -> console-message -> ipcMain.emit because inject.js has no preload access
- [Phase 05]: Plan 06: non-sensitive lifecycle log.info lines deliberately left as-is (migration scope = sensitive fields only)

### Open TODOs (surfaced during planning)

- **Phase 04:** fix latent HID first-character-drop bug from the Android prototype's `BADGE_SPEED_MS` check during the port.
- **Phase 04:** build a 100-cycle test harness for `clearStorageData` + `flushStore` ordering on Electron 41.
- **Phase 05:** make the code-signing / PAT-embedding decision before touching `electron-updater` wiring.

### Verification Debt

**All deferred human verification lives in `.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md` → "Human Verification Required (Next Kiosk Visit — consolidated batch)".** One document, three sections:

- **Phase 1 — Original deferred items (5):** fresh-boot visual, splash permanence, double-launch race, prod-sim chord test, on-device runbook walk-through.
- **Phase 3 — Deferred soft re-check (1):** TabTip manual-button path re-verified on the actual kiosk terminal (03-09 confirmed on proxy box only).
- **Phase 4 — Deferred Physical Verification (13):** NFC-01..06 (Deka reader + test badge) + IDLE-01..07 (touchscreen + Task Manager). Authoritative per-requirement spec in `.planning/phases/04-nfc-input-idle-session-lifecycle/04-VERIFICATION.md`. IDLE-05 must run LAST (destructive).

**Total next-visit items: 19.** All have automated backstops in the test suite; this is physical-only validation debt, not functional gaps.

### Blockers

None. Phase 04 is unblocked — Phase 03's idempotent auto-login is the dependency and it is complete.

## Session Continuity

### Last session summary (2026-04-12 evening — continued)

Hardware testing session on new Win 11 Pro kiosk PC (replaced China OEM). Built out a debugging toolkit (admin "Dev-Modus" toggle), traced multiple symptoms of the idle-reset-then-auth-failure cycle, and landed a principled self-heal path.

**What was committed this session (on top of the 9 earlier hardware bug fixes — still uncommitted until the end of this session):**

1. **`feat(admin): add dev mode toggle for on-device debugging`** (`09195a7`) — Dev-Modus button in admin menu that exits kiosk, opens DevTools on host + Magicline, fades host overlays. Used heavily to diagnose the issues below.
2. **Dev mode improvements (iterative, uncommitted with bug fixes):**
   - Dev mode state persists across view recreations (new view skips `HIDE_UNTIL_READY_CSS`, DevTools re-opens post-idle-reset)
   - Removed window resize (kept full-size, just `setKiosk(false)`)
   - Error overlay fades too
3. **`opacity: 0` instead of `visibility: hidden` in HIDE_UNTIL_READY_CSS** + explicit `webContents.setBackgroundThrottling(false)` post-creation — belt-and-suspenders against Chromium throttling the hidden Magicline view (unverified fix; the real root cause turned out to be #4, but this stays as cheap insurance).
4. **Self-heal on stale cookies (`magiclineView.clearCookiesAndReload` + `authFlow` cookieRetryUsed one-shot)** — when the boot watchdog expires once, authFlow clears the magicline partition storage (cookies + localStorage + sessionStorage + indexdb + cachestorage) and reloads. On success, flag resets so next idle-reset cycle gets a fresh retry. Falls through to `CREDENTIALS_UNAVAILABLE` on second expiry.
5. Tests: added two new cases covering `BOOTING + timer-expired(boot)` both paths (self-heal and fallthrough). 268/269 green (1 pre-existing sessionReset localstorage test still fails — unrelated, uncommitted change from earlier bug fix #9).

**The diagnosis journey (for posterity, so it's not repeated):**
- **Symptom 1:** "Anmeldedaten nicht verfügbar" after idle reset. Initially thought it was decrypt-failed → wasn't. Log showed `LOGIN_SUBMITTED → post-submit-watchdog expired → CREDENTIALS_UNAVAILABLE`, meaning credentials submitted fine but `cash-register-ready` never fired.
- **Symptom 2:** In dev mode, the reset cycle worked reliably. Without dev mode, it failed. Hypothesised Chromium throttling of the `visibility: hidden` view (DevTools attachment disables throttling) → pushed fix #3 above.
- **Symptom 3:** The throttling fix didn't help. User eventually saw the actual Magicline page in dev mode: *"Du bist nicht berechtigt dich anzumelden oder dein Zugang ist abgelaufen. Bitte versuche die Anmeldung erneut."* No reCAPTCHA, just an "expired session" error page with a retry prompt — which inject.js's login-form selectors don't match, so `login-detected` never fires for that DOM. The real root cause: **preserved cookies from bug fix #9 were stale server-side, Magicline showed a retry page instead of a clean login form, our inject script had no pattern to detect it**.
- **Fix:** self-heal (#4) — clear the partition on boot watchdog expiry and reload. Two test cycles confirmed it works; the third cycle revealed the localStorage routing bug (Magicline's SPA landed on `#/customermanagement/search` because localStorage remembered the last view) → final tweak: self-heal path now clears localStorage too (the normal idle reset path still preserves it for the register selection optimization).

**Kiosk testing status when session paused:**
- Second run survived successfully
- Third run hit the self-heal + landed on wrong Magicline view (localStorage routing) → fix pushed in new build (`dist2\Bee Strong POS-Setup-0.1.0.exe`)
- **NEXT SESSION:** flash the latest `dist2` installer, clear the Partitions folder manually one more time for a clean baseline, let it run through multiple reset cycles, confirm self-heal lands on `#/cash-register` not `#/customermanagement/search`.

Found and fixed 9 bugs during physical kiosk testing — **all the source-code changes are being committed at the end of this session** (previously all uncommitted across 9 source files + 1 test file). 268/269 tests green on dev machine (1 pre-existing sessionReset localstorage test failure from bug fix #9).

**Bugs fixed:**
1. Splash blocking credentials input (host.js)
2. Magicline WebContentsView stealing all input from host overlays — added setMagiclineViewVisible() (magiclineView.js, authFlow.js, idleTimer.js, main.js)
3. Auto-login not firing after idle reset — CASH_REGISTER_READY now handles login-detected (authFlow.js)
4. Stale webContents reference after view recreation — fill-and-submit uses live wc (authFlow.js)
5. False drift errors blocking working UI — login selectors skipped on cash register page, post-ready drift is informational (fragile-selectors.js, inject.js, magiclineView.js)
6. Appcues staff onboarding popup — hidden via CSS (inject.css)
7. Register auto-selection after login — "Kasse auswählen" → "Self-Checkout" → "Speichern" (inject.js)
8. Post-submit watchdog too aggressive — increased to 30s, retries from BOOTING, no credential deletion on timeout (authFlow.js)
9. Persistent cookie preservation across idle reset (sessionReset.js)

**What works on kiosk:** first boot → auto-login → register auto-select → cash register → idle overlay → reset → auto-login succeeds. **What doesn't:** after idle reset, Magicline's register selection is lost and the auto-selection inject code doesn't find the "Kasse auswählen" button post-reset (no [BSK] log messages). The register UI may render differently for mandatory selection vs the alert-bar variant.

**Last untested change:** removed `localstorage` from `clearStorageData` in `sessionReset.js` to preserve register selection across resets. Needs kiosk testing.

### Next session entry point

1. **Flash** the latest `dist2\Bee Strong POS-Setup-0.1.0.exe` onto the kiosk
2. **Clear the Partitions folder manually** one last time for a clean baseline:
   ```powershell
   Get-Process "Bee Strong POS" -ErrorAction SilentlyContinue | Stop-Process -Force
   Remove-Item -Recurse -Force "C:\Users\bsfkiosk\AppData\Roaming\bee-strong-pos\Partitions" -ErrorAction SilentlyContinue
   ```
3. **Let it cycle through multiple idle resets** (≥3) without intervention. Watch for:
   - Normal path: `cash-register-ready` within 1s of login-submitted
   - Self-heal path: `boot-watchdog-expired-self-heal` → `magicline.self-heal: cookies + localStorage cleared, reloading` → clean login → `cash-register-ready`
   - **Critical**: after self-heal, URL should end with `#/cash-register` (NOT `#/customermanagement/search` like the third cycle last time)
4. If the self-heal path triggers and lands on cash-register correctly → ship it. Proceed with physical verification checklist (`docs/runbook/v1.0-KIOSK-VISIT.md`)
5. Then complete milestone: `/gsd-complete-milestone`

**Contingency if self-heal lands on wrong view again:** add a post-login navigation guard in inject.js that detects a non-cash-register route after login-submitted and forces `location.hash = '#/cash-register'`.

### Stopped At

Kiosk hardware testing — `dist2` installer built with self-heal + localStorage-clear-on-self-heal. Previous cycle (2nd) worked; 3rd cycle hit self-heal but landed on customermanagement due to preserved localStorage. This new build should fix that. All changes being committed at the end of this session (9 earlier bug fixes + dev mode improvements + throttling fix + self-heal + test updates).

---
*State initialized: 2026-04-08 · Last refresh: 2026-04-12*
