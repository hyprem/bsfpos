# Phase 3 Acceptance Record

**Date:** 2026-04-09
**Tester:** nico (dev machine, Windows 11 Education)
**Git commit at verification:** `4cc7d80` (Phase 3 UAT fixes landed)

## Verdict: **PASS** (with non-blocking follow-ups)

All four success criteria and all AUTH-01..AUTH-06 requirements verified on the
dev machine via `npm start`. Kiosk-only hardware probes remain deferred to Plan
03-09 (TabTip + scrypt measurement on the physical kiosk CPU).

---

## Automated Pre-Checks (Plan 03-08 Tasks 1 & 2)

These gates are green before UAT begins:

- [x] `node --check test/plaintextAudit.js` exits 0 (syntax valid)
- [x] `test/plaintextAudit.js` contains usage header + fake-credential fragments
      (`bsk-audit-USER`, `bsk-audit-PASS`, `MAGICLINE_`, `BSF_CREDENTIALS`)
- [x] `node --test test/phase3-integration.test.js` exits 0 — **79/79 tests pass**
  - 9 adminPin tests
  - 10 credentialsStore tests
  - 59 authFlow reducer + executor tests (per Plan 03-04 scope growth)
  - 1 invariant doc test
- [x] Zero failures, zero errors, zero skipped

---

## Roadmap Phase 3 Success Criteria

- [x] **SC-1:** First-run credentials entry → next cold boot reaches cash register with zero human input — **verified 14:14 run**, cold boot to cash register in ~2.2s
- [x] **SC-2:** Plaintext audit passes (no plaintext in `config.json` or logs) — **verified**, `node test/plaintextAudit.js` exits 0 after audit script was fixed to read the correct app name from `package.json` (commit `e9cb44e`). Independent spot-check grep for `password|passwort` shows zero credential leaks (only `hasPassword:true/false` DOM-probe booleans and the literal `"PASSWORT VERGESSEN?"` link text from Magicline HTML). `config.json` contains a `credentialsCiphertext` DPAPI blob only.
- [x] **SC-3:** State transition log sequence observed
      (`BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY`) — **verified 14:14 and 14:45 runs**, full sequence in ~1.6s
- [x] **SC-4:** safeStorage-unavailable simulation shows branded error overlay; PIN recovery works end-to-end — **verified 14:27 run**, `decrypt-failed → CREDENTIALS_UNAVAILABLE → pin-ok → NEEDS_CREDENTIALS → credentials-submitted → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY`

---

## AUTH-01..AUTH-06 Checklist

- [x] **AUTH-01:** `node test/plaintextAudit.js` exits 0; no plaintext in `%AppData%/bee-strong-pos/` (corrected path — Electron uses `name` from `package.json`, not `productName`)
- [x] **AUTH-02:** Credentials overlay submits; values persisted as `credentialsCiphertext` in `config.json` (DPAPI blob observed)
- [x] **AUTH-03:** Magicline auto-fill observed — `login-submitted` log line fires ~250ms after `login-detected`, Magicline accepts the submit and transitions to cash register
- [x] **AUTH-04:** Full transition sequence in `main.log` — see SC-3 verification lines
- [x] **AUTH-05:** `CREDENTIALS_UNAVAILABLE → PIN → NEEDS_CREDENTIALS → BOOTING` recovery path observed — see SC-4 verification lines
- [x] **AUTH-06:** `03-07-AUTH06-RUNBOOK.md` exists and covers the DPAPI-rotation runbook

---

## Decision Coverage Matrix (D-01..D-21)

Each Phase 3 design decision is cross-checked against the plan/summary that implements it.
Any row without a citation blocks Phase 3 acceptance.

| Decision | Scope                                                      | Plan / Summary         | Status |
| -------- | ---------------------------------------------------------- | ---------------------- | ------ |
| D-01     | `src/main/authFlow.js` state machine ownership             | 03-04-SUMMARY          | [x]    |
| D-02     | Reuse Phase 2 250 ms drain queue (no new poll)             | 03-05-SUMMARY          | [x]    |
| D-03     | `login-detected` + `login-submitted` in KNOWN_EVENT_TYPES  | 03-05-SUMMARY          | [x]    |
| D-04     | `detectLogin` + `fillAndSubmitLogin` in inject.js          | 03-05-SUMMARY          | [x]    |
| D-05     | 3 stable `[data-role=...]` entries in fragile-selectors.js | 03-05-SUMMARY          | [x]    |
| D-06     | BOOTING branches on `safeStorage.isEncryptionAvailable()`  | 03-04-SUMMARY          | [x]    |
| D-07     | `login-detected` → fill-and-submit → watchdog              | 03-04-SUMMARY          | [x]    |
| D-08     | Retry policy (SUPERSEDED by D-21 — no retry)               | 03-04-SUMMARY + D-21   | [x]    |
| D-09     | One error overlay, 3 variants via IPC payload              | 03-06-SUMMARY          | [x]    |
| D-10     | Minimal PIN gate — scrypt, `adminPin.js`, 3x4 keypad       | 03-02 + 03-06 SUMMARY  | [x]    |
| D-11     | First-run overlay captures PIN + creds, single atomic set  | 03-04 + 03-06 SUMMARY  | [x]    |
| D-12     | `safeStorage.encryptString(JSON.stringify({user,pass}))`   | 03-03-SUMMARY          | [x]    |
| D-13     | AUTH-01 plaintext audit test                               | 03-08 (THIS PLAN)      | [x]    |
| D-14     | `#credentials-overlay` as host.html sibling, layer 400     | 03-06-SUMMARY          | [x]    |
| D-15     | Overlay field list (first-run + re-entry)                  | 03-06-SUMMARY          | [x]    |
| D-16     | Synchronous submit → IPC → main encrypts → rerun-boot      | 03-04 + 03-06 SUMMARY  | [x]    |
| D-17     | Windows TabTip keyboard strategy (research gate)           | 03-01-KIOSK-VERIFICATION | [x]  |
| D-18     | Every transition logs `auth.state: prev -> next reason=`   | 03-04-SUMMARY          | [x]    |
| D-19     | Stateless across reboots; every boot starts at BOOTING     | 03-04-SUMMARY          | [x]    |
| D-20     | `authFlow` idempotent under re-injection                   | 03-04 + 03-05 SUMMARY  | [x]    |
| D-21     | No auto-retry; login-failed → CREDENTIALS_UNAVAILABLE      | 03-04 + 03-05 SUMMARY  | [x]    |

**Coverage verdict:** 21 / 21 decisions implemented across Plans 03-01..03-07 + 03-10.
Plan 03-08 (this plan) owns D-13 (plaintext audit) directly.

Additional plan mapping for traceability:

| Plan  | Scope                                             |
| ----- | ------------------------------------------------- |
| 03-01 | Kiosk verification (D-17 TabTip research)         |
| 03-02 | adminPin scrypt gate (D-10)                       |
| 03-03 | credentialsStore safeStorage round-trip (D-12)    |
| 03-04 | authFlow reducer + executor (D-01, D-06–D-08, D-11, D-16, D-18–D-21) |
| 03-05 | inject.js detectLogin + fillAndSubmitLogin (D-02–D-05, D-20, D-21) |
| 03-06 | host credentials overlay + PIN modal + reCAPTCHA UX (D-09–D-11, D-14–D-16, D-21) |
| 03-07 | AUTH-06 operator runbook (DPAPI rotation)         |
| 03-08 | Acceptance (D-13 + UAT sign-off)                  |
| 03-10 | Phase 3 wiring / final integration (preload, main.js wiring) |

---

## Manual UAT Instructions (for tester on Windows dev machine)

> **Read before running:** This is the only human-gated step in Phase 3. The automation
> is all green; what is being verified here is real-world behavior in the running
> Electron process that cannot be observed from unit tests alone.

### Preparation

1. Make sure this repo is on commit `dd30962` or newer:
   ```sh
   git rev-parse --short HEAD
   ```
2. Fresh-state the kiosk state so you exercise first-run:
   ```sh
   rm -rf "%APPDATA%/Bee Strong POS/config.json"
   rm -rf "%APPDATA%/Bee Strong POS/logs"
   ```
   (Use File Explorer if `rm -rf` isn't available — path is
   `C:\Users\<you>\AppData\Roaming\Bee Strong POS\`.)
3. `npm install` if you haven't already.

### Test 1 — First-run (AUTH-02, SC-1 setup)

```sh
npm start
```

Wait for splash, then credentials overlay (layer 400). Enter **exactly**:

| Field                  | Value                                          |
| ---------------------- | ---------------------------------------------- |
| Admin-PIN              | `1234`                                         |
| PIN wiederholen        | `1234`                                         |
| Magicline Benutzername | `bsk-audit-USER-9f3c2a1d@example.invalid`      |
| Magicline Passwort     | `bsk-audit-PASS-9f3c2a1d-aB%cD!eF`             |

Tap **Speichern & Anmelden**. Observe:

- Overlay disappears
- Magicline login page loads underneath the splash
- authFlow fires `login-detected` → `login-submitted`
- Magicline rejects (fake credentials) → `login-failed` → `CREDENTIALS_UNAVAILABLE`
- Error overlay appears with `credentials-unavailable` variant + "PIN eingeben" button
- reCAPTCHA checkbox is visible in the child view under the overlay (D-21 expected)

Close the app (Alt+F4 or kill process).

### Test 2 — AUTH-01 plaintext audit (SC-2)

```sh
node test/plaintextAudit.js
```

Expected output (last line): `OK — zero plaintext leaks detected. AUTH-01 assertion passes.`
Exit code must be `0`. If it reports any FAIL line, **stop and capture the log.**

### Test 3 — AUTH-04 state transition log (SC-3)

Open `%APPDATA%/Bee Strong POS/logs/main.log`. Find and copy the `auth.state:` lines from
Test 1. You should see an ordered sequence that includes at least:

```
auth.state: BOOTING -> NEEDS_CREDENTIALS reason=creds-loaded  (first boot, no store key)
auth.state: NEEDS_CREDENTIALS -> BOOTING reason=credentials-submitted
auth.state: BOOTING -> LOGIN_DETECTED reason=login-detected
auth.state: LOGIN_DETECTED -> LOGIN_SUBMITTED reason=submit-fired
auth.state: LOGIN_SUBMITTED -> CREDENTIALS_UNAVAILABLE reason=login-failed   (D-21: no retry)
```

Paste the actual lines into the "Log Excerpt" section below.

### Test 4 — AUTH-05 PIN recovery (SC-4, happy path)

Relaunch `npm start` (the error overlay should come back from the stored state, OR you'll
hit first-run again if the submit cleared the ciphertext — either is fine for this test).

1. Tap "PIN eingeben" → PIN modal + 3×4 keypad appears
2. Tap `1 2 3 4 ✓`
3. PIN modal disappears, credentials overlay reappears in **re-entry mode** (no PIN-setup fields)
4. Enter **real** Magicline staff credentials (from your admin account — NOT the fake ones)
5. Tap "Speichern & Anmelden"
6. The child Magicline view will still have reCAPTCHA showing from Test 1's failure — tap
   "I'm not a robot" in the child view per the D-21 yield-UX
7. Observe: log shows `BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY`,
   splash hides, cash register is visible
8. Close the app, relaunch. **Expect zero manual input** — straight to cash register (this
   confirms SC-1).

### Test 5 — Forced safeStorage-unavailable / corrupted ciphertext (SC-4, unhappy path)

Easiest method: edit `%APPDATA%/Bee Strong POS/config.json` in a text editor, change the
`credentialsCiphertext` value to `"GARBAGE_BASE64_BLOB=="`, save.

```sh
npm start
```

Expected:
- Splash appears
- Error overlay with `credentials-unavailable` variant ("Anmeldedaten nicht verfügbar — Administrator erforderlich")
- "PIN eingeben" button present
- Tap it → PIN modal → `1 2 3 4 ✓` → credentials overlay (re-entry mode) → re-enter real creds
- Returns to cash register

### Test 6 — Real kiosk (optional but recommended before Phase 4)

Run the same flow on the actual POS terminal in Assigned Access mode. Verify:
- TabTip invokes on input focus (per 03-01 verdict)
- 3×4 keypad is finger-operable
- Scan cadence unaffected

### What to capture and send back

Copy-paste this block into the "Results" section at the bottom of this file, or reply in
chat and the orchestrator will transcribe:

```
SC-1 (first-run → next cold boot = cash register, zero input): yes / no
SC-2 (plaintext audit exit 0): yes / no — audit output: <last line>
SC-3 (transition log sequence): yes / no — see log excerpt below
SC-4 (safeStorage fail → error overlay → PIN recovery works): yes / no

Log excerpt (Test 3):
<paste auth.state lines here>

Anomalies / deviations from expected flow:
<freeform>

Verdict: PASS / FAIL (reason: ...)
Tester: <name>
Date: <YYYY-MM-DD>
```

---

## Log Excerpt (Test 3 — success path, 14:14 cold-boot run)

```
[2026-04-09 14:14:51.059] auth.state: BOOTING reason=creds-loaded
[2026-04-09 14:14:52.223] auth.state: BOOTING -> LOGIN_DETECTED reason=login-detected
[2026-04-09 14:14:52.225] auth.state: LOGIN_DETECTED reason=login-detected
[2026-04-09 14:14:52.460] auth.state: LOGIN_DETECTED -> LOGIN_SUBMITTED reason=login-submitted
[2026-04-09 14:14:52.462] auth.state: LOGIN_SUBMITTED reason=submit-fired
[2026-04-09 14:14:52.466] auth.state: LOGIN_SUBMITTED reason=login-redetected-ignored
[2026-04-09 14:14:53.204] auth.state: LOGIN_SUBMITTED -> CASH_REGISTER_READY reason=cash-register-ready
[2026-04-09 14:14:53.206] auth.state: CASH_REGISTER_READY reason=cash-register-ready
```

Total cold-boot-to-cash-register time: **2.2 seconds**.

## Log Excerpt (Test 5 — safeStorage failure + recovery, 14:27 run)

```
[2026-04-09 14:27:11.354] auth.state: BOOTING -> CREDENTIALS_UNAVAILABLE reason=decrypt-failed
[2026-04-09 14:27:11.356] auth.state: CREDENTIALS_UNAVAILABLE reason=decrypt-failed
[2026-04-09 14:27:17.666] auth.state: CREDENTIALS_UNAVAILABLE -> NEEDS_CREDENTIALS reason=pin-ok
[2026-04-09 14:27:22.544] auth.state: NEEDS_CREDENTIALS -> BOOTING reason=credentials-submitted
[2026-04-09 14:27:22.572] auth.state: BOOTING -> LOGIN_DETECTED reason=login-detected
[2026-04-09 14:27:22.831] auth.state: LOGIN_DETECTED -> LOGIN_SUBMITTED reason=login-submitted
[2026-04-09 14:27:23.848] auth.state: LOGIN_SUBMITTED -> CASH_REGISTER_READY reason=cash-register-ready
```

---

## Results

```
SC-1 (first-run → next cold boot = cash register, zero input): yes — 2.2s total
SC-2 (plaintext audit exit 0): yes — "OK — zero plaintext leaks detected. AUTH-01 assertion passes."
SC-3 (transition log sequence): yes — see 14:14 log excerpt above
SC-4 (safeStorage fail → error overlay → PIN recovery works): yes — see 14:27 log excerpt above

Anomalies / deviations from expected flow:
- Eight distinct bugs were surfaced and fixed during UAT (see "Bugs found" below). All fixes
  are committed to master as individual atomic commits.
- Plan 03-05's `login-failed` inject-layer watcher was never implemented — the D-21 watchdog
  fallback (post-submit-watchdog) correctly catches failures but the text-match primary
  signal is absent. Treated as a deliverable gap, not a blocker, per D-21 Option A design
  (watchdog is the canonical fallback path anyway because reCAPTCHA suppresses text errors).
- Test 6 (real kiosk under Assigned Access) deferred to Plan 03-09.

Verdict: PASS
Tester: nico
Date: 2026-04-09
```

---

## Bugs Found and Fixed During UAT

| Commit    | File(s)               | Fix |
|-----------|-----------------------|-----|
| `4dd4119` | `main.js`             | Plan 03-07 wired `authFlow.start` with wrong deps key (`magiclineWebContents` instead of `webContents`) and missing `log` dep; `start()` threw silently and the credentials overlay never appeared. |
| `0964592` | `main.js`             | `authFlow.start()` fired `show-credentials-overlay` IPC before the host renderer finished loading — IPC dropped silently. Deferred `start()` until `did-finish-load`. |
| `f3c4ec8` | `inject.js`           | MutationObserver's rAF callback called only `detectReady()`, not `detectLogin()` — login form was rendered asynchronously by React but never detected. |
| `896445c` | `inject.js`           | `detectLogin` used a URL negative gate (`bail if hash matches #/cash-register`), but Magicline keeps the URL at `#/cash-register` while rendering the login form. Switched to DOM-presence signal with a 1-second time dedup. |
| `78b33cb` | `authFlow.js`         | `rerun-boot` passively waited for a fresh `login-detected` event that never came (Magicline DOM was stable by the time the user submitted credentials). Proactive `executeJavaScript('window.__bskiosk_detectLogin()')` after `creds-loaded`. |
| `b4fd2da` | `magiclineView.js`, `inject.js` | Initial attempt: `backgroundThrottling:false` + swap `rAF` for `setTimeout(16)` in `fillAndSubmitLogin`. Partial fix — swap works, throttling flag alone does not. |
| `4cc7d80` | `magiclineView.js`    | **Final fix for the zero-bounds issue.** Chromium throttles layout/JS to ~zero when a `WebContentsView` has `{0,0,0,0}` bounds, even with `backgroundThrottling:false`. Off-screen positioning is clipped the same way. Solution: full bounds from creation + `transparent: true` + `setBackgroundColor('#00000000')` + injected `html, body { visibility: hidden !important; background: transparent }` CSS (removed on `cash-register-ready` via `removeInsertedCSS`). Magicline runs at full speed while the host UI composites through. |
| `e9cb44e` | `test/plaintextAudit.js` | Hardcoded `APP_NAME = 'Bee Strong POS'` (spaces) but Electron uses `package.json` `name` (`bee-strong-pos`, lowercase) for the userData directory. Audit was trivially passing by scanning a nonexistent directory — **false green**. Now reads `name` from `package.json`. |
| `e94ae33` | `authFlow.js`         | `handleCredentialsSubmit` unconditionally called `adminPin.buildRecord(pin)` which threw on the PIN recovery re-entry path (user has already proved PIN possession in the recovery modal and doesn't re-enter it). Two-path persist: atomic dual-set on first run, `credentialsCiphertext`-only update on re-entry. |

## Non-blocking Follow-ups (Phase 4+ backlog)

1. **`login-failed` inject-layer watcher** — not implemented in Plan 03-05. Not blocking (watchdog fallback works), but adds 8-second latency to the failure detection path when reCAPTCHA is not shown.
2. **SelfCheck false-positive drift warnings** for login-only selectors (`[data-role="password"]`) on `cash-register-ready`. Plan 02's `selfCheck` needs page-conditional selector handling.
3. **First-run overlay shows PIN fields even when adminPin already exists in the store.** The reducer emits `show-credentials-overlay firstRun=true` whenever `hasCreds=false`, which re-prompts for PIN setup on creds-replacement cycles. Should distinguish "first-ever run" from "creds cleared, PIN still valid".
4. **Phase 2 "view at zero bounds" assumption** remains documented in code comments that are now out of sync with the CSS-visibility fix. Should be tidied up when the next Phase 2 touches happen.

## Sign-off

**PASS — 2026-04-09, nico**

Phase 3 is functionally complete on the dev machine. Kiosk hardware verification (Plan 03-09 — TabTip + scrypt measurement under Assigned Access) remains the only outstanding item before Phase 3 can be fully closed, and is unblocked on physical kiosk access.
