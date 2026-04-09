# Phase 3 Acceptance Record

**Date:** _pending UAT_
**Tester:** _pending UAT_
**Git commit at verification:** `dd30962` (plan 03-08 autonomous work complete — plaintext audit + integration aggregator)

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

- [ ] **SC-1:** First-run credentials entry → next cold boot reaches cash register with zero human input
- [ ] **SC-2:** Plaintext audit passes (no plaintext in `config.json` or logs)
- [ ] **SC-3:** State transition log sequence observed
      (`BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY`)
- [ ] **SC-4:** safeStorage-unavailable simulation shows branded error overlay; PIN recovery works end-to-end

---

## AUTH-01..AUTH-06 Checklist

- [ ] **AUTH-01:** `node test/plaintextAudit.js` exits 0; no plaintext in `%AppData%/Bee Strong POS/`
- [ ] **AUTH-02:** Credentials overlay submits; values persisted as `credentialsCiphertext` in `config.json`
- [ ] **AUTH-03:** Magicline auto-fill observed (log line `login-submitted` event or video of form fill)
- [ ] **AUTH-04:** Full transition sequence in `main.log`
- [ ] **AUTH-05:** `CREDENTIALS_UNAVAILABLE → PIN → NEEDS_CREDENTIALS → BOOTING` recovery path observed
- [ ] **AUTH-06:** `03-07-AUTH06-RUNBOOK.md` exists and covers the DPAPI-rotation runbook (already verified present on disk)

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

## Log Excerpt (paste after Test 3)

```
<pending UAT>
```

---

## Results (pending UAT)

```
<pending UAT>
```

---

## Verdict

**PENDING UAT** — awaiting manual verification on Windows dev machine.
Orchestrator will re-enter this plan with the UAT results and mark PASS / FAIL + sign-off.

## Sign-off

_pending_
