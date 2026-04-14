---
phase: 07-locale-hardening-splash-auto-selection-race
verified: 2026-04-14T00:00:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "L1 — Locale on English-US Windows: set Windows display language to English-US, reboot kiosk, tap welcome, complete login, confirm Magicline renders in German. Check navigator.language === 'de-DE', Accept-Language header on first Magicline request, and audit log event=startup.locale lang=de."
    expected: "Magicline UI in German regardless of Windows display language. navigator.language=de-DE. Accept-Language: de-DE,de;q=0.9 on first request. Audit log shows startup.locale lang=de."
    why_human: "Requires live kiosk with Windows display language set to English-US. Cannot verify programmatically. User-approved deferral (2026-04-14) — kiosk stays on German Windows for current deployment. Tracked in 07-HUMAN-UAT.md check #1 (L1)."
  - test: "L2 — 5 consecutive auto-select cycles: complete 5 welcome→tap→register→idle→welcome cycles. Each should emit exactly one event=auto-select.result result=ok audit line. Zero fail or timeout results. Splash never stuck."
    expected: "5/5 cycles emit result=ok. Zero fail/timeout. Splash always clears."
    why_human: "Requires live kiosk session with running Magicline SPA and actual register-selection click chain executing against live DOM. Tracked in 07-HUMAN-UAT.md check #2 (L2)."
  - test: "S1 — Splash pointer block: during the ~1-2 s auto-select pending window, deliberately tap random positions on the splash. Confirm .bsk-layer--splash has auto-select-pending class. Confirm no tap reaches underlying Magicline view."
    expected: "Zero taps reach Magicline during auto-select window. auto-select-pending class visible in DevTools. Chain still completes with result=ok."
    why_human: "Requires live touch interaction against the physical kiosk touchscreen. Tracked in 07-HUMAN-UAT.md check #3 (S1)."
  - test: "S2 — Forced failure degrades cleanly: in DevTools, remove the Self-Checkout option element before Step 3 fires. Confirm audit log emits result=fail step=step3-self-checkout within 1.5 s. Splash hides within 5500 ms of welcome:tap."
    expected: "result=fail step=step3-self-checkout within 1.5 s. Splash hides via degraded path within ≤5500 ms. Kiosk lands on manual register picker."
    why_human: "Requires live DevTools manipulation against running Magicline SPA. Tracked in 07-HUMAN-UAT.md check #4 (S2)."
  - test: "S3 — Admin PIN reachable during pending state: press Ctrl+Shift+F12 during the auto-select pending window. Confirm admin PIN modal appears above splash and accepts input."
    expected: "Admin PIN modal opens and accepts input while splash has auto-select-pending class. Modal not blocked."
    why_human: "Requires live kiosk interaction to observe z-index layering and touch behavior. Tracked in 07-HUMAN-UAT.md check #5 (S3)."
  - test: "R1 — Cold-boot regression: full kiosk reboot. Welcome layer renders immediately after boot. Splash is NOT stuck pending. Splash:hide fires normally. event=startup.complete in audit log."
    expected: "Cold-boot welcome path unchanged. No stale pending state on boot."
    why_human: "Requires full kiosk reboot and observation of boot sequence. Tracked in 07-HUMAN-UAT.md check #6 (R1)."
  - test: "R2 — Idle-recovery regression: from cash register, wait for 60 s idle to fire. Tap idle overlay. Confirm sessionReset.hardReset reason=idle-expired fires. New welcome cycle runs cleanly."
    expected: "Idle-recovery path unchanged. Splash gate re-arms normally on subsequent welcome tap."
    why_human: "Requires live kiosk idle timeout to expire and observation of recovery sequence. Tracked in 07-HUMAN-UAT.md check #7 (R2)."
  - test: "DOM survey — record Magicline fragile selector attributes for the 3 auto-select buttons (data-*, aria-*, id, role) and location.hash on register-selection and cash-register pages. Fill in docs/runbook/v1.1-KIOSK-VISIT.md Phase 07 DOM survey block."
    expected: "Conclusion box checked (stable/unstable). All attribute rows filled. Both location.hash values recorded."
    why_human: "Requires live DevTools inspection of Magicline SPA DOM. Deferred from Plan 07-01. Tracked in 07-HUMAN-UAT.md check #8 (DOM survey)."
---

# Phase 07: Locale Hardening & Splash Auto-Selection Race — Verification Report

**Phase Goal:** The Magicline UI is always German regardless of Windows display language, and the post-tap splash stays up until the register auto-selection chain finishes so members can't derail it mid-click.
**Verified:** 2026-04-14
**Status:** human_needed
**Re-verification:** No — initial verification

> **Deferral note (2026-04-14):** Kiosk will continue running Windows in German (production default). L1 (English-Windows locale proof) is not needed for current deployment. L2–R2 behavioural checks deferred to the next scheduled kiosk maintenance visit. Tracked in `07-HUMAN-UAT.md` so they surface in `/gsd-progress` and `/gsd-audit-uat`.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | On a kiosk with Windows set to English, Magicline serves the cash register UI in German and the auto-selection click chain completes successfully | VERIFIED (code) / human needed (live) | `appendSwitch('lang', 'de-DE')` at main.js:1030, before app.whenReady() at line 276. `onBeforeSendHeaders` sets `Accept-Language: de-DE,de;q=0.9` on persist:magicline partition. State machine uses LOCALE_STRINGS.de.* for all 3 text matches. Live English-Windows test deferred — see L1 in 07-HUMAN-UAT.md. |
| SC2 | Locale-dependent text matches live in a single lookup table in `src/inject/fragile-selectors.js`; structured `auto-select.result=ok\|fail` log line emitted on every chain run | ✓ VERIFIED | `var LOCALE_STRINGS = { de: { KASSE_AUSWAEHLEN, SELF_CHECKOUT_OPTION, SPEICHERN } }` in fragile-selectors.js. inject.js uses `LOCALE_STRINGS.de.*` — zero hard-coded German strings remain. `log.audit('auto-select.result', parsed)` in magiclineView.js on every `BSK_AUTO_SELECT_RESULT:` sentinel. Shape test 3/3. |
| SC3 | After welcome tap, splash remains visible + blocks pointer events until `splash:hide-final` fires (or ~5 s safety timeout); splash never sticks | VERIFIED (code) / human needed (live) | `enterSplashPendingMode()` adds `.auto-select-pending` class + starts 5500 ms timer. CSS rule `.bsk-layer--splash.auto-select-pending { pointer-events: auto }` confirmed. `hideSplashFinal()` delegates to `hideSplash()` which always clears timer + class. Live tap-block behavior needs human verification — see S1/S2 in 07-HUMAN-UAT.md. |
| SC4 | Cold-boot and idle-recovery splash paths preserve existing behavior; not regressed | VERIFIED (code) / human needed (live) | `hideSplash()` body defensively clears `splashSafetyTimer` + `classList.remove('auto-select-pending')` + `splashPendingMode = false` on every call path (both cold-boot splash:hide and welcome-path splash:hide-final route through it). Live regression tests R1/R2 deferred — see 07-HUMAN-UAT.md. |

**Score:** 4/4 truths code-verified (2/4 also need live-kiosk human confirmation)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/inject/fragile-selectors.js` | LOCALE_STRINGS.de block with 3 keys | ✓ VERIFIED | `var LOCALE_STRINGS = {` present. All 3 keys (KASSE_AUSWAEHLEN, SELF_CHECKOUT_OPTION, SPEICHERN) with correct German values. |
| `test/fragileSelectors.test.js` | Shape assertion for LOCALE_STRINGS.de | ✓ VERIFIED | Exists. 3/3 tests pass. vm.runInContext loads fragile-selectors.js correctly. |
| `src/main/main.js` | appendSwitch('lang','de-DE') + onBeforeSendHeaders + welcomeTapPending flag + splash:hide-final forward | ✓ VERIFIED | All 9 acceptance criteria from Plans 02/03 confirmed present. appendSwitch at pos 1030 < app.whenReady() at char 11580. |
| `src/main/logger.js` | auto-select.result and startup.locale in taxonomy | ✓ VERIFIED | Both strings present in canonical audit taxonomy comment. |
| `src/inject/inject.js` | markRegisterReady helper + sentinel emitters + bounded state machine | ✓ VERIFIED | All Plan 03 helpers present. Plan 04 state machine: CHAIN_STEP_TIMEOUT_MS=1200, chainFinish appears 4 times, LOCALE_STRINGS.de.* used throughout. Zero hard-coded German strings. |
| `src/main/magiclineView.js` | parseAutoSelectSentinel + allowlist parser + sentinel catch | ✓ VERIFIED | PHASE07_ALLOWED_RESULTS, PHASE07_ALLOWED_STEPS, function parseAutoSelectSentinel exported. else-if ordering for DEGRADED/non-DEGRADED confirmed. |
| `test/magiclineView.sentinel.test.js` | 8 allowlist parser tests | ✓ VERIFIED | Exists. 8/8 tests pass including injection attack cases. |
| `src/main/preload.js` | onHideSplashFinal bridge | ✓ VERIFIED | `onHideSplashFinal: (cb) =>` subscribes to `splash:hide-final` IPC. |
| `src/host/host.js` | Welcome-path splash gate + 5500ms safety timer | ✓ VERIFIED | splashPendingMode, SPLASH_SAFETY_TIMEOUT_MS=5500, enterSplashPendingMode, hideSplashFinal, onHideSplashFinal subscriber, splashPendingMode guard in onShowSplash handler — all present. |
| `src/host/host.css` | .bsk-layer--splash.auto-select-pending { pointer-events: auto } | ✓ VERIFIED | Rule present with pointer-events: auto. |
| `docs/runbook/v1.1-KIOSK-VISIT.md` | Phase 07 DOM survey + L1–R2 verification checklist | ✓ VERIFIED | All 9 sections present (Phase 07 DOM survey + L1, L2, S1, S2, S3, R1, R2). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `fragile-selectors.js LOCALE_STRINGS` | inject.js detectAndSelectRegister | string-concat global var | ✓ WIRED | inject.js references `LOCALE_STRINGS.de.KASSE_AUSWAEHLEN`, `.SELF_CHECKOUT_OPTION`, `.SPEICHERN` |
| `inject.js markRegisterReady / emitAutoSelectResult` | magiclineView.js console-message listener | console.log sentinel strings | ✓ WIRED | BSK_REGISTER_SELECTED, BSK_REGISTER_SELECTED_DEGRADED, BSK_AUTO_SELECT_RESULT: all caught with DEGRADED-first else-if ordering |
| `magiclineView.js ipcMain.emit('register-selected')` | `main.js ipcMain.on('register-selected')` | ipcMain fan-out | ✓ WIRED | Handler present; gated by `welcomeTapPending`; forwards to `splash:hide-final` |
| `main.js webContents.send('splash:hide-final')` | `host.js onHideSplashFinal(hideSplashFinal)` | preload contextBridge IPC | ✓ WIRED | preload.js exposes `onHideSplashFinal`; host.js subscribes via `window.kiosk.onHideSplashFinal(hideSplashFinal)` |
| `host.js handleWelcomeTap` | splash element .auto-select-pending class | classList.add on welcome:tap | ✓ WIRED | `enterSplashPendingMode()` called before `notifyWelcomeTap()` in handleWelcomeTap |
| `main.js app.commandLine.appendSwitch('lang','de-DE')` | Chromium --lang switch | top-of-file before app.whenReady() | ✓ WIRED | appendSwitch at char pos 1030; app.whenReady() call at char pos 11580 |
| `main.js session.fromPartition('persist:magicline').webRequest.onBeforeSendHeaders` | Magicline HTTP requests | registered before welcome:tap handler | ✓ WIRED | Listener registered inside app.whenReady().then() before ipcMain.on('welcome:tap') |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| inject.js chainTick | LOCALE_STRINGS.de.* | fragile-selectors.js (string-concat global) | Yes — 3 concrete German string values | ✓ FLOWING |
| magiclineView.js console-message listener | parsed {result, step} | parseAutoSelectSentinel() with Set-based allowlist | Yes — clamped to known-good values | ✓ FLOWING |
| main.js register-selected handler | welcomeTapPending flag | Set in welcome:tap handler; cleared on forward + preReset | Yes — boolean gate functioning | ✓ FLOWING |
| host.js enterSplashPendingMode | splashPendingMode, splashSafetyTimer | Set in handleWelcomeTap; cleared in hideSplash | Yes — live state machine with setTimeout | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit test gate — all 3 test files | `node --test test/fragileSelectors.test.js test/magiclineView.sentinel.test.js test/logger.audit.test.js` | 19/19 pass, exit 0 | ✓ PASS |
| fragile-selectors.js has no hard-coded German in inject.js | grep for 'Kasse auswählen', 'Self-Checkout', 'Speichern' literals in inject.js | zero matches | ✓ PASS |
| appendSwitch before whenReady | byte-offset comparison: appendSwitch pos 1030 < app.whenReady() pos 11580 | confirmed | ✓ PASS |
| chainFinish called on all terminal outcomes | grep count of `chainFinish(` in inject.js | 4 call sites (step timeout × 1, already-on-register × 1, step4 success × 1, chainFinish body × 1) | ✓ PASS |
| Live kiosk auto-select happy path (L2) | Run on live kiosk | — | ? SKIP — deferred to kiosk visit (07-HUMAN-UAT.md) |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LOCALE-01 | 07-01, 07-02, 07-04 | Magicline UI in German regardless of Windows display language; locale-dependent strings in single lookup table; structured log line on chain run | ✓ SATISFIED (code) | LOCALE_STRINGS.de table in fragile-selectors.js; appendSwitch + webRequest in main.js; LOCALE_STRINGS.de.* in inject.js state machine; auto-select.result audit line wired. Live English-Windows test deferred (L1). |
| SPLASH-01 | 07-03, 07-05 | Splash stays visible + blocks pointer events until chain completes; safety timeout prevents stuck splash; cold-boot/idle-recovery paths unchanged | ✓ SATISFIED (code) | welcomeTapPending gate in main.js; enterSplashPendingMode + hideSplashFinal + SPLASH_SAFETY_TIMEOUT_MS=5500 in host.js; .auto-select-pending CSS rule; hideSplash defensive clear. Live behavioral tests (L2, S1–S3, R1, R2) deferred. |

---

### Anti-Patterns Found

No anti-patterns detected across all Phase 07 modified files. No TODOs, FIXMEs, placeholders, empty handlers, or hard-coded stub values found.

---

### Human Verification Required

Live-kiosk behavioral verification is pending — all 8 items are tracked in `07-HUMAN-UAT.md` with status: partial.

#### 1. L1 — Locale de-DE on English-US Windows

**Test:** Set Windows display language to English-US, reboot kiosk, tap welcome layer, complete login, inspect Magicline UI language.
**Expected:** Magicline renders in German. `navigator.language === 'de-DE'` in DevTools console on Magicline view. First Magicline request shows `Accept-Language: de-DE,de;q=0.9`. Audit log `%AppData%\Bee Strong POS\logs\` shows `event=startup.locale lang=de`.
**Why human:** Requires Windows language change + reboot + live Magicline network request inspection.
**Status:** Deferred (user decision 2026-04-14) — production kiosk stays on German Windows; L1 is low priority.

#### 2. L2 — 5 consecutive auto-select happy-path cycles

**Test:** Run 5 complete cycles of welcome tap → auto-select chain → cash register ready → idle timeout → welcome return.
**Expected:** Each of 5 cycles emits exactly one `event=auto-select.result result=ok` audit line. Zero `result=fail` or `result=timeout`. Splash never sticks.
**Why human:** Requires live Magicline SPA, real DOM, and timing observable only on hardware.

#### 3. S1 — Splash pointer block during auto-select window

**Test:** During the ~1-2 s auto-select pending window, deliberately tap random splash positions with a finger. Inspect splash element in DevTools for `auto-select-pending` class.
**Expected:** Zero taps reach underlying Magicline view. Class present during pending window. Chain still completes with `result=ok`.
**Why human:** Requires live touchscreen interaction; pointer-events block can only be confirmed on hardware.

#### 4. S2 — Forced failure degrades cleanly within 5500 ms

**Test:** In DevTools before Step 3, execute `document.querySelectorAll('[role="option"]').forEach(o => { if (o.textContent.trim() === 'Self-Checkout') o.remove(); });`. Observe audit log and splash behavior.
**Expected:** `event=auto-select.result result=fail step=step3-self-checkout` within 1.5 s. Splash hides within ≤5500 ms of welcome:tap. Kiosk lands on manual register picker.
**Why human:** Requires live DevTools manipulation against running Magicline SPA.

#### 5. S3 — Admin PIN reachable during pending state

**Test:** Press Ctrl+Shift+F12 while splash has `auto-select-pending` class applied.
**Expected:** Admin PIN modal opens above the splash and accepts input. Pending state does not block the modal.
**Why human:** Requires live kiosk interaction to verify z-index layering and touch behavior with pending state active.

#### 6. R1 — Cold-boot path unchanged

**Test:** Full kiosk power cycle. Observe boot sequence from welcome layer.
**Expected:** Welcome layer renders immediately. Splash is not stuck pending. Cold-boot `splash:hide` fires (not `splash:hide-final`). `event=startup.complete` in audit log.
**Why human:** Requires full hardware reboot and observation of boot sequence.

#### 7. R2 — Idle-recovery path unchanged

**Test:** From cash register, wait for the 60 s idle timeout to fire. Tap the idle overlay to dismiss.
**Expected:** `sessionReset.hardReset reason=idle-expired` fires. New welcome cycle runs cleanly. Splash gate re-arms for next welcome tap without stale state.
**Why human:** Requires waiting for the 60 s idle timer on live hardware.

#### 8. DOM survey — Live Magicline fragile selector audit

**Test:** Over RDP in dev-mode, inspect DevTools on the Magicline view and record outer HTML attributes (`data-*`, `aria-*`, `id`, `role`, `type`) of the 3 auto-select buttons. Record `location.hash` on both pages. Fill `docs/runbook/v1.1-KIOSK-VISIT.md` Phase 07 DOM survey block and check the stable/unstable conclusion box.
**Expected:** All attribute rows filled. Conclusion box checked. Both hash values recorded.
**Why human:** Requires live Magicline SPA DOM inspection. Deferred from Plan 07-01.

---

### Gaps Summary

No code gaps. All LOCALE-01 and SPLASH-01 implementation must-haves are present and wired end-to-end. The code-side verification is complete with 19/19 unit tests passing.

The 8 pending items in the Human Verification section above are observational live-kiosk checks that cannot be replicated programmatically. They are tracked in `07-HUMAN-UAT.md` with status: partial, and will surface via `/gsd-progress` and `/gsd-audit-uat`.

**Action required:** Run the live-kiosk UAT during the next scheduled maintenance visit using `docs/runbook/v1.1-KIOSK-VISIT.md` → Phase 07 verification section. Fill the `07-VERIFICATION.md` manual kiosk verification table below with pass/fail results. If any check fails, open gap closure via `/gsd-plan-phase 07 --gaps`.

---

## Automated verification (runs on every CI / local `node --test`)

| Test file | Requirement | Expected | Result |
|-----------|-------------|----------|--------|
| test/fragileSelectors.test.js | LOCALE-01 | LOCALE_STRINGS.de shape correct, 3 keys non-empty | 3/3 PASS |
| test/magiclineView.sentinel.test.js | LOCALE-01 / SPLASH-01 | parseAutoSelectSentinel allowlist, 8 cases pass | 8/8 PASS |
| test/logger.audit.test.js | LOCALE-01 | Existing log.audit format regression — auto-select.result emits canonical format | 8/8 PASS |

Run: `node --test test/fragileSelectors.test.js test/magiclineView.sentinel.test.js test/logger.audit.test.js`

---

## Manual kiosk verification

See `docs/runbook/v1.1-KIOSK-VISIT.md` → Phase 07 verification section.

| Check ID | Description | Pass / Fail / Blocked | Date | Notes |
|----------|-------------|-----------------------|------|-------|
| L1 | Locale de-DE on English Windows | | | Deferred — kiosk stays on German Windows per user decision 2026-04-14 |
| L2 | 5 happy-path cycles all emit result=ok | | | |
| S1 | Splash pointer block swallows member taps | | | |
| S2 | Forced failure degrades within 5500 ms | | | |
| S3 | Admin PIN reachable during pending state | | | |
| R1 | Cold-boot path unchanged | | | |
| R2 | Idle-recovery path unchanged | | | |

## Gaps / open items

(filled after kiosk visit)

---

_Verified: 2026-04-14_
_Verifier: Claude (gsd-verifier)_
