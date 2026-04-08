---
phase: 01-locked-down-shell-os-hardening
plan: 06
subsystem: verification
tags: [acceptance, qa, verification, documentation, phase-gate]

requires:
  - 01-01 (Electron project skeleton + logger + brand assets)
  - 01-02 (main.js createMainWindow + host.html splash)
  - 01-03 (keyboardLockdown + single-instance + runtime auto-start)
  - 01-04 (electron-builder NSIS + Startup shortcut)
  - 01-05 (OS hardening runbook)
provides:
  - docs/runbook/PHASE-01-ACCEPTANCE.md — structural + static-inspection acceptance evidence for SHELL-01..06
  - Baseline record of electron-builder warnings for Phase 5 BRAND-01 to silence
  - Explicit PENDING-HUMAN demarcation of the 4 interactive checks deferred to the 01-06 owner checkpoints
  - Explicit DEFERRED marker for SHELL-05 target-device execution (on-site maintenance visit)
affects:
  - Phase 5 BRAND-01 (warning baseline + default Electron icon noted)
  - On-site maintenance visit (BREAKOUT-CHECKLIST.md + 05-verify-lockdown.ps1 runs)

tech-stack:
  added: []
  patterns:
    - "Acceptance docs live at docs/runbook/PHASE-NN-ACCEPTANCE.md — one per phase, co-located with operator runbooks so a maintenance visitor finds verification evidence next to the scripts"
    - "PENDING-HUMAN marker for items the GSD executor cannot verify non-interactively, distinct from FAIL — preserves the 'no fabricated passes' contract from T-06-01"

key-files:
  created:
    - "docs/runbook/PHASE-01-ACCEPTANCE.md — 227 lines; pass/fail per SHELL-01..06, live canonical() probe output, electron-builder warning baseline, open-issues section, human-checkpoint item list"
  modified: []

key-decisions:
  - "Marked SHELL-01/02/06 as PENDING-HUMAN rather than fabricating a PASS: the executor session has no display and cannot actually observe a running window or double-launch race. Static code inspection is captured as evidence but does not substitute for the owner's visual checkpoint."
  - "SHELL-04 reported PASS based on live canonical()/SUPPRESS_LIST probe output for all six required combos (Alt+F4, Alt+Tab, F11, Escape, Ctrl+W, bare Meta) — this is non-interactive unit verification of the exact same data structure the production before-input-event handler consults."
  - "Documented the Ctrl+Shift+W 'LEAK' explicitly as NOT a SHELL-04 regression (Ctrl+W is the SHELL-04 requirement and it is SUPPRESSED; Ctrl+Shift+W is a separate Chromium re-open-closed-tab chord). Captured as an 'informational' open issue to close the trust gap for the human reviewer."
  - "SHELL-03 split into two layers with independent evidence: runtime (plan 03, static inspection) + install-time (plan 04, dist/win-unpacked artifact already built). Both must exist; neither alone is sufficient per D-04 belt-and-suspenders."
  - "SHELL-05 target-device execution deferred explicitly rather than attempted on the dev machine — we do not want the developer's PC locked into kiosk mode per T-06-02."

patterns-established:
  - "Phase-acceptance docs surface the electron-builder warning baseline so Phase 5 BRAND-01 has a concrete target to reach zero warnings from"
  - "Every PENDING-HUMAN line in an acceptance doc lists exactly what the human must do — no hand-wavy 'TBD' markers"

requirements-completed: []

duration: ~3 min
completed: 2026-04-08
---

# Phase 01 Plan 06: Phase 1 Acceptance Verification Summary

**Wrote `docs/runbook/PHASE-01-ACCEPTANCE.md` — the structural + static-inspection acceptance evidence for SHELL-01..06. Ran the keyboardLockdown `canonical()` probe live and confirmed all SHELL-04 required combos are SUPPRESSED. Captured the electron-builder warning baseline from the plan-04 `--dir` build. Explicitly marked the 4 interactive visual/chord checks as PENDING-HUMAN for the 01-06 owner checkpoints, rather than fabricating pass results.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-08T20:05:00Z
- **Completed:** 2026-04-08T20:08:00Z
- **Tasks:** 1 (the second "human visual verification" task is an out-of-band owner checkpoint, not an executor-authored artifact)
- **Files modified:** 1 (created)

## Accomplishments

- Created `docs/runbook/PHASE-01-ACCEPTANCE.md` (227 lines) with a dedicated section for every SHELL-01..06 requirement.
- Ran the `canonical()` + `SUPPRESS_LIST` probe from `src/main/keyboardLockdown.js` directly via `node -e` and captured the live output for Alt+F4, Alt+Tab, F11, Escape, Ctrl+w, Ctrl+Shift+W, bare Meta, Ctrl+r, F5, F12, Ctrl+Shift+I — eleven rows total, all SHELL-04 required combos SUPPRESSED.
- Caught one probe row (`Ctrl+Shift+W` → LEAKED) that is NOT a SHELL-04 requirement but warranted explanation. Documented it in the acceptance doc's SHELL-04 section and Open Issues as an informational defense-in-depth nice-to-have rather than misleading the reader into thinking Ctrl+W is broken.
- Captured the electron-builder warning baseline verbatim from plan 01-04's existing `dist/win-unpacked/` artifact (no re-build required — `Bee Strong POS.exe` already exists, 222 MB, mtime 2026-04-08 19:54). Two warnings: default Electron icon, DEP0190 from upstream electron-builder. Phase 5 BRAND-01 owns silencing both.
- Verified `node --check` passes on `src/main/main.js`, `src/main/keyboardLockdown.js`, and `src/main/preload.js`.
- Confirmed all 8 runbook files from plan 01-05 are present in `docs/runbook/`.
- Ran the plan's structural grep: `node -e` confirmed every SHELL-01..06 ID appears in the acceptance doc.
- Marked the 4 interactive items (SHELL-01 live window, SHELL-02 double-launch race, SHELL-06 first-paint no-flash, SHELL-04 live chord test) as PENDING-HUMAN with explicit instructions for the owner checkpoint.

## Task Commits

1. **Task 1: Create docs/runbook/PHASE-01-ACCEPTANCE.md with evidence** — `a692fd2` (docs)

The plan's Task 2 ("Human visual verification of dev-mode splash") is a checkpoint gate, not an executor-authored artifact — no commit. The checkpoint is recorded in this summary as PENDING at hand-off time.

## Files Created/Modified

- `docs/runbook/PHASE-01-ACCEPTANCE.md` — created, 227 lines, pass/fail per requirement, live probe output, warning baseline, open issues, human-checkpoint item list

## Decisions Made

- **PENDING-HUMAN is not FAIL.** The plan is explicit: `autonomous: false`, and the plan objective warns the executor not to fabricate passes for items that require observing a real window or firing interactive chords. The acceptance doc uses three labels: PASS (mechanically verified), PENDING-HUMAN (requires owner checkpoint), and DEFERRED (requires physical maintenance visit). This preserves the T-06-01 "no fabricated PASS" contract.
- **SHELL-04 reported PASS despite the Ctrl+Shift+W row:** Ctrl+W is the SHELL-04 requirement and it is SUPPRESSED (`Ctrl+w` and `Ctrl+W` both in SUPPRESS_LIST). Ctrl+Shift+W is a different chord (Chromium re-open closed tab) and is neither in SHELL-04 nor a common kiosk breakout vector. Documented as informational open issue.
- **Did not re-build `dist/win-unpacked/`:** the artifact from plan 01-04 already exists on disk with an mtime from earlier today. Re-running `npx electron-builder --win --dir` would take ~2 min and produce identical output; the existing artifact is authoritative evidence and the warnings captured by plan 04 are the correct baseline.
- **Did not run `npm start` to generate a real main.log excerpt:** the GSD executor runs without a display, and `npm start` would attempt to spawn a windowed Electron process that would either fail or block the session. Explicitly called out as PENDING-HUMAN so the owner fills it in during the 01-06 checkpoint.

## Deviations from Plan

**[Rule 3 — Blocking] Plan instruction to run `npm start` and capture screenshots during executor session skipped in favour of PENDING-HUMAN markers.**

The plan's Task 1 action block asks the executor to run `npm start` in background, take a screenshot, double-launch to exercise the single-instance lock, and run `npx cross-env NODE_ENV= electron .` for prod-sim chord testing. None of these are possible non-interactively from a headless tool session on Windows:

- `npm start` spawns a GUI Electron process; the executor has no display and can't capture the window.
- The prod-sim chord test locks the developer out of their own PC per the plan's own T-06-02 note.
- Screenshot automation via `Add-Type -AssemblyName System.Windows.Forms` is flagged as "too fragile" in the plan itself.

The orchestrator's prompt was explicit: **"Any tasks that require human visual confirmation or running `npm start` interactively should be marked PENDING-HUMAN in the acceptance doc rather than fabricated."** This is exactly what was done.

**Rationale:** Rule 3 (auto-fix blocking issues) applies here — the blocker is the executor's lack of a display, and the unblocking move is documented honest deferral to the human checkpoint rather than fabricating a PASS. This preserves T-06-01 (no fabricated passes) which is the load-bearing gate per the plan's own checkpoint semantics ("the grep is a structural sanity check only; the load-bearing gate is the human review").

No code was changed. No acceptance-criteria line in the plan was falsely marked PASS.

## Issues Encountered

- Git emitted a CRLF line-ending warning on the new file — expected on Windows, same as every other plan in this phase, no impact.
- Initial `canonical()` probe script (copied verbatim from the plan) tested `{control:true, shift:true, key:'W'}` for the "Ctrl+W" row, which is actually `Ctrl+Shift+W` — different chord. Re-ran the probe with the correct `{control:true, key:'w'}` form, confirmed SHELL-04 Ctrl+W is SUPPRESSED, and documented both results in the acceptance doc so the human reviewer understands the distinction.

## Known Stubs

None. The acceptance doc is complete — every requirement has either a mechanically-verified PASS, a PENDING-HUMAN marker with explicit instructions, or a DEFERRED marker pointing to the on-site maintenance visit. PENDING-HUMAN and DEFERRED are not stubs — they are documented scope boundaries.

## User Setup Required

The project owner must perform the 01-06 Task 1 + Task 2 checkpoints on the Windows dev machine:

1. `npm start` → confirm the 420x800 windowed splash matches the UI-SPEC contract, DevTools opens detached, and `%AppData%\Bee Strong POS\logs\main.log` is created with an `app ready (isDev=true)` line.
2. Leave the splash visible for 10+ s to confirm it does NOT auto-lift (D-06 end state).
3. Start a second `npm start` while the first is running. Confirm the second process exits within ~1 s with no second window, and `main.log` contains the literal line `second instance detected — exiting silently (D-05)`.
4. (Optional, awkward on dev machine) `npx electron .` with `NODE_ENV` unset. Confirm fullscreen kiosk, no menu, Alt+F4/F11/Escape/Ctrl+W do not close the window. Exit via Task Manager.
5. Spot-check `docs/runbook/README.md` and `docs/runbook/BREAKOUT-CHECKLIST.md` for operator-readiness.
6. Reply "approved" (or describe any issues) to close Phase 1.

The on-site maintenance visit must additionally run `docs/runbook/05-verify-lockdown.ps1` on the target gym POS terminal and attach the output to `docs/runbook/BREAKOUT-CHECKLIST.md`.

## Next Phase Readiness

- Phase 2 (Magicline embed) can start as soon as the 01-06 human checkpoints are approved. All Phase 2 prerequisites are in place: `createMainWindow` exported, `attachLockdown` exported and ready to attach to the Magicline BrowserView webContents (Pitfall 1), `ipcMain.on('cash-register-ready')` stub ready to receive the post-injection signal, splash will lift exactly once Phase 2 fires that IPC.
- Phase 5 BRAND-01 has the concrete warning baseline (default Electron icon + DEP0190) to target.
- Phase 5 ADMIN-01 has the `reservedShortcuts` Set export ready to receive `.add('Ctrl+Shift+F12')`.

## Self-Check: PASSED

- FOUND: docs/runbook/PHASE-01-ACCEPTANCE.md (227 lines, contains SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06)
- FOUND: commit a692fd2 (Task 1 — docs(01-06): add Phase 1 acceptance evidence document)
- VERIFIED: `node -e` structural grep for all six SHELL-NN IDs in the acceptance doc — exit 0, output "OK"
- VERIFIED: `node --check src/main/main.js`, `src/main/keyboardLockdown.js`, `src/main/preload.js` — all pass
- VERIFIED: live `canonical()` probe output captured (11 rows, all SHELL-04 required combos SUPPRESSED)
- FOUND: all 8 docs/runbook/ files from plan 01-05
- FOUND: dist/win-unpacked/Bee Strong POS.exe (222 MB, mtime 2026-04-08 19:54) — plan 01-04 build artifact still present

---
*Phase: 01-locked-down-shell-os-hardening*
*Completed: 2026-04-08*
