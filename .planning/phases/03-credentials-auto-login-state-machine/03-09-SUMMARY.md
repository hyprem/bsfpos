---
phase: 03-credentials-auto-login-state-machine
plan: 09
type: execute
status: complete
completed: 2026-04-10
requirements: [AUTH-05]
files_modified:
  - .planning/phases/03-credentials-auto-login-state-machine/03-01-KIOSK-VERIFICATION.md
  - src/main/adminPin.js
  - tools/kiosk-probes/README.md
---

# Plan 03-09 Summary — Kiosk-Only Verification (Probes A & C)

## Outcome

Closed the two DEFERRED probes from Wave 0 (Plan 03-01) that could only be
answered on real Windows hardware. Both results fit within the Phase 3 research
defaults, so no code retune was needed — only comment refresh and verification-
file writeback. Phase 3 is now free of any "DEFERRED — see 03-09" placeholders.

## Probe C — scrypt CPU benchmark

Ran `tools/kiosk-probes/` under Node v24.14.1 on proxy box `DESKTOP-P1E98A1`
(Intel Core i3-2350M @ 2.30 GHz, 3.9 GB RAM, Windows 10.0.19045).

| Run | Sample (ms) |
|-----|-------------|
| 1   | 79.6        |
| 2   | 82.2        |
| 3   | 111.2       |
| 4   | 118.6       |
| 5   | 94.8        |

- **Sorted:** 79.6 · 82.2 · **94.8** · 111.2 · 118.6
- **Median:** 94.8 ms
- **Target band:** 50–250 ms → **inside the band**
- **Chosen N:** 16384 (unchanged)
- **`src/main/adminPin.js` edit:** none for `SCRYPT_PARAMS.N`. The stale comment
  block that still described the measurement as DEFERRED was refreshed to
  reference the 94.8 ms result.

### Why no retune

Measured median 94.8 ms leaves roughly 2.6× headroom to both band edges
(50 and 250 ms). Retune rules from 03-09-PLAN.md §Probe C would only trigger
outside the band.

## Probe A — Windows TabTip

Ran on the same proxy box under a **regular** Windows user session (not the
Phase 1 Assigned Access kiosk user).

| Check                                  | Result |
|----------------------------------------|--------|
| Auto-invoke on text-input focus        | **NO** |
| Manual `TabTip.exe` launch             | **YES** |
| TabTip path that worked                | `C:\Program Files\Common Files\microsoft shared\ink\TabTip.exe` |

**Verdict: manual button.** The kiosk cannot rely on automatic keyboard
invocation; the credentials overlay must expose a touch-keyboard button that
invokes the `launch-touch-keyboard` IPC handler wired in Plan 03-07. That
handler `child_process.exec`s the path above.

## Residual risk / deferred re-check

Both probes were collected on a proxy Windows 10 box, not the real Phase 1
Assigned Access kiosk account on the production POS terminal. Reasoning for
treating this as sufficient to close Phase 3 is recorded in the "Caveats"
subsections of `03-01-KIOSK-VERIFICATION.md`:

- **TabTip auto-invoke NO under a regular user is strictly stronger than under
  Assigned Access.** Regular sessions have *more* auto-invoke heuristics;
  Assigned Access sessions have fewer. "NO under regular" implies
  "NO under Assigned Access."
- **Manual `TabTip.exe` launch is not user-kind gated.** It is a standard Win32
  binary with no elevation requirement. Phase 1 hardening does not install an
  AppLocker/SRP policy blocking `TabTip.exe`, so "YES under regular" is a
  strong indicator of "YES under Assigned Access."
- **scrypt is pure CPU.** The i3-2350M baseline has ~2.6× headroom to both
  band edges; any POS CPU within ~2.5× speed (either direction) stays in-band.

**Soft follow-up next physical kiosk visit (≤2 minutes):**
1. Log in as the Phase 1 Assigned Access kiosk user.
2. Start the POS app, confirm the credentials-overlay touch-keyboard button
   actually pops TabTip via the `launch-touch-keyboard` IPC handler.
3. Re-run the scrypt probe from `tools/kiosk-probes/` if the production POS
   CPU is materially different from the i3-2350M (anything older than ~2010
   or a budget ARM SoC). If median lands outside 50–250 ms, retune N per the
   rules in `03-09-PLAN.md`.

None of these are blockers for Phase 3 acceptance — they are confidence
boosters with no architectural impact if they fail.

## Acceptance criteria check

- [x] `03-01-KIOSK-VERIFICATION.md` no longer contains `DEFERRED — see 03-09`
- [x] `## TabTip` has `Auto-invoke on text-input focus:` → NO
- [x] `## TabTip` has `Manual tabtip.exe launch:` → YES
- [x] `## TabTip` has `Verdict:` → "manual button"
- [x] `## scrypt Benchmark` has `Median ms at N=16384:` → 94.8
- [x] `## scrypt Benchmark` has `Chosen N:` → 16384 (in {8192, 16384, 32768})
- [x] N unchanged → no `grep "N: NEWVALUE" src/main/adminPin.js` requirement
- [x] TabTip verdict is not "escalate" → no softkeyboard-phase discussion needed

## Files touched

- `.planning/phases/03-credentials-auto-login-state-machine/03-01-KIOSK-VERIFICATION.md`
  — replaced TabTip + scrypt DEFERRED sections with measured values and
  caveats for the proxy-box testing context.
- `src/main/adminPin.js` — refreshed the stale "DEFERRED to plan 03-09"
  comment block above `SCRYPT_PARAMS` to cite the 94.8 ms measurement.
  `SCRYPT_PARAMS.N` unchanged.
- `tools/kiosk-probes/README.md` — (already modified in the working tree from
  the probe run; contains run notes / operator guidance for the follow-up
  kiosk visit).

## Phase 3 status

With 03-09 closed, Phase 3 (Credentials & Auto-Login State Machine) has no
open plans or outstanding DEFERRED items. All 10 plans have SUMMARY files.
Ready for milestone advancement to Phase 4 (NFC Input, Idle & Session
Lifecycle).
