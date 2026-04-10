# Phase 4 Verification: NFC Input, Idle & Session Lifecycle

**Phase:** 04-nfc-input-idle-session-lifecycle
**Plan:** 04-05 (acceptance)
**Status:** Pending human checkpoint
**Tester:** _______________
**Date:** _______________
**Device:** [ ] Production kiosk  [ ] Proxy box (DESKTOP-P1E98A1)  [ ] Other: _______________

---

## Automated Verification Summary

Run all suites from the repo root on a build host with Node 20 LTS and record results in the Result column. The harness is the IDLE-04 acceptance artifact — it runs the literal 100-iteration loop called out in the requirement spec.

| # | Command | Tests | Result | Notes |
|---|---------|-------|--------|-------|
| 1 | `node --test test/idleTimer.test.js` | 10 | [ ] PASS [ ] FAIL | |
| 2 | `node --test test/badgeInput.test.js` | 16 | [ ] PASS [ ] FAIL | |
| 3 | `node --test test/sessionReset.test.js` | 16 | [ ] PASS [ ] FAIL | |
| 4 | `node --test test/authFlow.test.js` | existing + 3 new Phase 4 reducer cases | [ ] PASS [ ] FAIL | |
| 5 | `node --test test/sessionReset.harness.js` | 4 (case 1 runs 100 cycles) | [ ] PASS [ ] FAIL | IDLE-04 100-cycle harness |
| 6 | `node --test test/phase4-integration.test.js` | 9 | [ ] PASS [ ] FAIL | |
| 7 | `node --test test/phase3-integration.test.js` | 82+ | [ ] PASS [ ] FAIL | Regression guard |
| 8 | `node --check src/main/idleTimer.js` | syntax | [ ] PASS [ ] FAIL | |
| 9 | `node --check src/main/badgeInput.js` | syntax | [ ] PASS [ ] FAIL | |
| 10 | `node --check src/main/sessionReset.js` | syntax | [ ] PASS [ ] FAIL | |
| 11 | `node --check src/main/authFlow.js` | syntax | [ ] PASS [ ] FAIL | |
| 12 | `node --check src/main/magiclineView.js` | syntax | [ ] PASS [ ] FAIL | |
| 13 | `node --check src/main/preload.js` | syntax | [ ] PASS [ ] FAIL | |
| 14 | `node --check src/inject/inject.js` | syntax | [ ] PASS [ ] FAIL | |
| 15 | `node --check src/inject/fragile-selectors.js` | syntax | [ ] PASS [ ] FAIL | |

Combined expected count across Phase 4 suites (1–6): **102 tests** (10 + 16 + 16 + 51 authFlow full suite + 4 harness + 9 integration). All must pass; any FAIL blocks the human checkpoint.

---

## Human Verification Checklist

For each row: perform the action on the physical kiosk (or proxy box), observe the expected outcome, and mark PASS / FAIL / N/A with tester initials and date. Note: use a TEST BADGE tied to a STAGING MEMBER — never a real member's badge. Redact any real names from failure notes.

### NFC Badge Input

#### [NFC-01] First-scan after boot captures leading character

- **Setup:** Plug in Deka reader. Cold-boot the kiosk Windows user so the app auto-launches.
- **Action:** On the very first key-capture opportunity after the splash lifts, hold a test badge to the reader.
- **Expected PASS:** Member name appears in the Magicline customer-search field within 1 second. Badge string committed with all characters intact.
- **FAIL condition:** First character is dropped (the latent prototype bug — e.g. badge `1234567` lands as `234567`). Any truncation, any delay > 1s, or no commit at all.
- **Verify in log:** `%AppData%\Bee Strong POS\logs\main.log` contains `badgeInput.commit: length=N` where N matches the full badge length (never the content).

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [NFC-02] Rapid 5-badge burst — all commit

- **Setup:** From idle cash-register state, scan 5 different test badges in quick succession (~2 seconds apart).
- **Action:** Observe the customer-search field after each scan.
- **Expected PASS:** All 5 scans commit and update the customer field. No scan is lost, coalesced, or duplicated.
- **FAIL condition:** Any scan does not update the customer field, or any two scans merge into one buffer.
- **Verify in log:** 5 `badgeInput.commit: length=N` lines.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [NFC-03] First-scan-after-reset regression (sentinel-null fix)

- **Setup:** Let the kiosk sit idle for 90 seconds to trigger the full idle overlay + expiry + hard reset cycle. Wait for the clean cash register to re-appear.
- **Action:** Immediately scan a test badge on the FIRST keystroke after the reset completes.
- **Expected PASS:** All characters captured. Member name appears intact in the customer field.
- **FAIL condition:** First character dropped — the sentinel-null fix regressed.
- **Verify in log:** `sessionReset.hardReset: reason=idle-expired count=1` followed by `badgeInput.commit: length=N` with N equal to full badge length.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [NFC-04] Badge routes to customer-search field via React-native setter

- **Setup:** On a clean cash register, inspect the customer-search field visually.
- **Action:** Scan a test badge tied to a known staging member.
- **Expected PASS:** The customer-search field populates with the member name / badge ID and Magicline's React state updates (the member card / detail panel renders as if typed manually).
- **FAIL condition:** Field shows raw text but Magicline does not react (indicates the React-native value setter failed and the input/change dispatch did not fire).

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [NFC-05] Idle-overlay scan absorbs as dismiss, not forwarded to Magicline

- **Setup:** Let the kiosk sit idle for 60 seconds until the idle overlay appears.
- **Action:** While the overlay is visible with its 30s countdown, scan a test badge.
- **Expected PASS:** Overlay dismisses immediately, 60s idle timer restarts, and the customer-search field in Magicline is NOT populated with the scanned badge. The badge scan is absorbed as dismiss input.
- **FAIL condition:** Badge content leaks into Magicline customer field under the overlay.
- **Verify in log:** `idleTimer.state: OVERLAY_SHOWING -> IDLE reason=dismissed` fires; no `badgeInput.commit` line follows the overlay dismiss.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [NFC-06] Product-search focus pass-through

- **Setup:** From a clean cash register, tap the Magicline product-search input to give it focus.
- **Action:** Scan a product barcode (or simulate keystrokes that look like one).
- **Expected PASS:** The keystrokes type into the product-search field normally. Magicline product lookup fires. The customer-search field is NOT touched.
- **FAIL condition:** Keystrokes are hijacked into the customer-search buffer instead of going to product-search.
- **Verify in log:** Expect a `product-search-focused` event in the inject event drain around the time of focus; the scan itself is not committed to customer-search.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

### Idle, Reset & Recovery

#### [IDLE-01] 60s idle triggers branded overlay with 30s countdown

- **Setup:** Clean cash register, no input.
- **Action:** Do not touch anything for 60 seconds. Wait.
- **Expected PASS (per 04-UI-SPEC):**
  - Opaque dark overlay (`#1A1A1A`) at z-index 200 covers Magicline fully (no bleed-through of prior member data).
  - German title "Noch da?" visible.
  - Large yellow 80px countdown starts at 30 and ticks down.
  - "SEKUNDEN" label beneath the countdown.
  - Subtext "Tippe irgendwo, um fortzufahren." visible.
  - "Weiter" button visible and tappable.
- **FAIL condition:** Overlay fails to appear within ~62s; transparent overlay letting Magicline show through; missing countdown; wrong copy; wrong colors.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [IDLE-02] Overlay dismiss restores same cart

- **Setup:** Add a product to the cart. Let the overlay appear after 60s idle.
- **Action:** During the 30s countdown, tap anywhere on the overlay.
- **Expected PASS:** Overlay disappears, cart and customer state are unchanged, 60s idle timer restarts fresh.
- **FAIL condition:** Cart cleared, customer lost, or overlay not dismissible by tap.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [IDLE-03] Countdown expiry triggers clean hard reset

- **Setup:** Let the overlay appear. Do NOT dismiss it.
- **Action:** Wait through the full 30s countdown expiration (90s total from the last activity).
- **Expected PASS:** Splash shows briefly, then the clean Magicline cash register reappears — no customer selected, no cart, auto-login has fired.
- **FAIL condition:** Half-logged-in state visible (empty cash register with prior member's data still cached); crash; stuck splash; login page re-appears without auto-login.
- **Verify in log:** `idleTimer.state: OVERLAY_SHOWING -> RESETTING reason=expired`, `sessionReset.hardReset: reason=idle-expired count=1`.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [IDLE-04] Multi-reset acceptance (human spot-check + 100-cycle harness)

- **Setup:** The 100-cycle automated harness (`test/sessionReset.harness.js` case 1) is the primary acceptance artifact for this requirement. Confirm row 5 of the Automated Verification Summary PASSED before evaluating this row.
- **Action:** On the kiosk, trigger a second idle reset by letting the device sit idle 90 seconds again (wait at least 90s after the prior reset to avoid the rolling loop guard). Then trigger a third, again spaced by ≥ 90s.
- **Expected PASS:** Both manual resets complete cleanly and the device lands on a clean cash register each time. Main.log shows two `sessionReset.hardReset: reason=idle-expired count=1` lines (count=1 each because the rolling window cleared between them).
- **FAIL condition:** Any reset produces a half-logged-in state; harness failed.
- **Combined pass requires:** automated harness PASS **AND** 2+ manual resets clean.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [IDLE-05] Reset-loop guard — 3 rapid resets trigger branded error + admin PIN recovery

- **IMPORTANT:** Run this item LAST in the checklist. It leaves the device in `loopActive=true` until the admin PIN flow triggers `app.relaunch()`.
- **Setup:** Open Task Manager on the kiosk (via RDP or hidden admin exit). Identify the Bee Strong POS renderer process (Magicline child renderer).
- **Action:** End the renderer task 3 times in quick succession within a 60-second window.
- **Expected PASS:**
  - After the 3rd kill, a branded reset-loop error overlay appears with copy "Kiosk muss neu gestartet werden" and a "PIN eingeben" button.
  - Tapping the PIN button opens the admin PIN modal (Phase 3 flow).
  - Entering the correct admin PIN triggers `app.relaunch(); app.quit()` — the kiosk restarts cleanly into its normal boot flow.
- **FAIL condition:** Reset-loop error does not appear; PIN modal does not open; PIN entry does not restart the device.
- **Verify in log:** `sessionReset.loop-detected: count=3 reasons=["crash","crash","crash"]` (or similar, unified D-18 counter tracks crash reason).

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [IDLE-06] Post-sale 3s customer-search clear

- **Setup:** Scan a member badge, add a product to cart.
- **Action:** Tap the "Jetzt verkaufen" button to complete the sale. Start counting seconds.
- **Expected PASS:** At ~3 seconds after the click, the customer-search field clears automatically. The sale remains in Magicline's history / receipts pane (customer-search clear does NOT drop the sale record).
- **FAIL condition:** Field never clears; clears immediately (timing wrong); or clears AND drops the sale record.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

#### [IDLE-07] Single-crash recovery via render-process-gone listener

- **Setup:** Open Task Manager.
- **Action:** End the Magicline renderer process ONCE.
- **Expected PASS:** `magicline.render-process-gone` log line fires with details payload; splash shows briefly; clean cash register re-appears after auto-login. No reset-loop guard trip on first kill.
- **FAIL condition:** Kiosk does not recover; reset-loop error appears on single kill; splash stuck indefinitely.
- **Verify in log:** `magicline.render-process-gone: {"reason":"killed",...}` followed by `sessionReset.hardReset: reason=crash count=1`.

Result: [ ] PASS   [ ] FAIL   [ ] N/A      Initials: ______    Date: __________
Notes:

---

## Deferred Visual Checks

Fold these into the next physical-kiosk visit alongside Phase 1 visual debt. They do NOT block Phase 4 sign-off but must be closed before v1.0 milestone.

- [ ] Confirm the OPAQUE (#1A1A1A) idle overlay prevents any prior member data bleed-through when triggered on a populated cash register (04-UI-SPEC color contract).
- [ ] Confirm the 80px yellow countdown number is readable at arm's length (~50–80 cm viewing distance).
- [ ] Confirm dismiss-anywhere behavior: a tap at any point ON the overlay surface (not just on the "Weiter" button) dismisses the overlay.
- [ ] Confirm German copy renders with correct umlauts on the real kiosk display (no mojibake).

---

## Sign-off

**Tester Name:** ________________________________________
**Test Date:** __________________________________________
**Device Used:** [ ] Production kiosk  [ ] Proxy box  [ ] Other: ____________________
**Test Badge ID:** __________ (staging member — redact if real)

**Overall Verdict:**
- [ ] PASS — all 13 requirements green; Phase 4 accepted
- [ ] PASS-with-deferred — enumerate deferred items: ____________________
- [ ] PARTIAL — some requirements failed; enumerate: ____________________
- [ ] FAIL — trigger `/gsd-plan-phase --gaps` for gap closure

**Next Action:** _________________________________________________________

**Log Excerpts (redacted of any real badge content):**

```
<paste relevant main.log lines here — badgeInput.commit length, idleTimer.state transitions,
 sessionReset.hardReset reasons, magicline.render-process-gone details, sessionReset.loop-detected>
```

---

*Verification document created by Plan 04-05 executor on 2026-04-10. Human checkpoint pending.*
