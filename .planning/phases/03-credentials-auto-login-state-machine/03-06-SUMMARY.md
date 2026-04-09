---
phase: 03-credentials-auto-login-state-machine
plan: 06
subsystem: host-ui
tags: [ui, overlay, ipc, preload, pin-modal, credentials, keypad]
requires:
  - 03-04 (auth state machine IPC contract: show/hide credentials-overlay, show/hide pin-modal, show-magicline-error variants)
provides:
  - window.kiosk surface extended with 7 Phase 3 methods (4 listeners + 3 invokers + 1 launcher)
  - #credentials-overlay layer 400 with first-run/re-entry modes
  - #pin-modal layer 400 with custom 3x4 numeric keypad (zero TabTip dependency)
  - Variant-aware #magicline-error (drift / credentials-unavailable / login-failed) with recovery PIN button
affects:
  - src/main/preload.js
  - src/host/host.html
  - src/host/host.css
  - src/host/host.js
tech-stack:
  patterns:
    - contextBridge minimal-surface IPC (Phase 1 pattern extended)
    - CSP-strict wiring via addEventListener + data-* attributes (no inline scripts/handlers)
    - Closure-scoped pinBuffer cleared on modal hide and after OK submit (T-03-06 mitigation)
    - Variant-tagged overlay reuse instead of multiple error layers (D-09)
key-files:
  modified:
    - src/main/preload.js
    - src/host/host.html
    - src/host/host.css
    - src/host/host.js
  created: []
decisions:
  - D-21 realized in host.js: no retry branch — credentials-unavailable and login-failed both offer PIN recovery, never auto-retry
  - Custom 3x4 numeric keypad is authoritative PIN input — never depend on Windows TabTip
  - Tastatur launch buttons on text fields are a soft fallback for physical keyboard / TabTip when admins want to type
  - Variant-tagged single #magicline-error overlay (drift / credentials-unavailable / login-failed) instead of three separate layers
metrics:
  tasks: 4
  files: 4
  duration: single-session
  completed: 2026-04-09
---

# Phase 03 Plan 06: Host UI (credentials overlay, PIN modal, variant error) Summary

Wired the host.html renderer for Phase 3: credentials overlay with first-run PIN setup, custom 3x4 numeric PIN modal with zero TabTip dependency, variant-aware Magicline error overlay with PIN recovery button, and the extended preload.js contextBridge surface.

## Outcome

All 4 tasks executed in sequence, each committed atomically on the worktree branch:

| Task | Name                                                      | Commit  | Files                     |
| ---- | --------------------------------------------------------- | ------- | ------------------------- |
| 1    | Extend preload.js contextBridge with Phase 3 methods      | 9244ec3 | src/main/preload.js       |
| 2    | Add credentials overlay + PIN modal + error PIN button    | a6f90d9 | src/host/host.html        |
| 3    | Append Phase 3 styles (overlay, card, keypad, buttons)    | b1d8701 | src/host/host.css         |
| 4    | Implement host.js wiring for all Phase 3 UI surfaces      | cc3dd2d | src/host/host.js          |

## Exported surface — window.kiosk (preload.js)

```js
// Phase 1 (preserved)
isDev, onHideSplash, onShowSplash

// Phase 2 (preserved; payload now carries {variant, message?})
onShowMagiclineError, onHideMagiclineError

// Phase 3 — main → renderer listeners
onShowCredentialsOverlay(cb)  // cb({firstRun: boolean})
onHideCredentialsOverlay(cb)
onShowPinModal(cb)
onHidePinModal(cb)

// Phase 3 — renderer → main invokers
submitCredentials({firstRun, pin?, user, pass}) -> {ok, error?}
verifyPin(pin) -> {ok}
requestPinRecovery() -> {ok}
launchTouchKeyboard() -> {ok}
```

13 named methods on `window.kiosk` total. No `ipcRenderer` leakage; no Node APIs.

## Overlay layout (host.html)

Z-index ladder preserved from Phase 1/2 with 400 layer populated:

- `#magicline-mount` — layer 0 (Phase 2 WebContentsView attach)
- `#splash` — layer 100 (Phase 1, untouched)
- `#magicline-error` — layer 300 (Phase 2 base; Phase 3 adds `#error-pin-button`)
- `#credentials-overlay` — **layer 400** (new)
- `#pin-modal` — **layer 400** (new)

`#credentials-overlay` renders two modes keyed off the `firstRun` IPC payload:
- **First-run:** shows `#creds-firstrun-fields` with PIN + PIN-confirm
  (`Admin-PIN (4–6 Ziffern)` / `PIN wiederholen`) plus Benutzername/Passwort.
- **Re-entry:** hides PIN fields; only Benutzername/Passwort visible.

Every text input has a dedicated `Tastatur` button that invokes
`window.kiosk.launchTouchKeyboard()` and focuses the target field. The password
field also has a `Zeigen`/`Verbergen` toggle.

`#pin-modal` is the custom 3x4 numeric keypad per research §PIN Modal Numeric
Input UX — **never depends on TabTip**. Buttons: 1-9, 0, back, OK. Touch targets
are 80x80 px (well above the 44x44 minimum). Display is a dot string
(`•••·`) showing entered-digit count with 4 slots minimum.

`#magicline-error` now renders 3 variants via `showMagiclineError({variant, message?})`:

| Variant                    | Title                              | Sub                                                                    | PIN button |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ---------- |
| `drift`                    | Kasse vorübergehend nicht verfügbar | Bitte wenden Sie sich an das Studio-Personal                           | hidden     |
| `credentials-unavailable`  | Anmeldedaten nicht verfügbar       | Administrator erforderlich — Bitte Studio-Personal verständigen        | shown      |
| `login-failed`             | Anmeldung fehlgeschlagen           | Bitte Studio-Personal verständigen                                      | shown      |

The `PIN eingeben` button invokes `window.kiosk.requestPinRecovery()` which
Plan 07 will route to the auth state machine's `pin-recovery-requested` event.

## PIN keypad UX (host.js)

State machine is a single closure variable `pinBuffer` (string, max 6 digits)
with three operations:

- **digit key** — append if `pinBuffer.length < 6`; update display
- **back key** — slice last char; update display
- **ok key** — if `length < 4` show `Falscher PIN`; otherwise capture buffer,
  clear, invoke `window.kiosk.verifyPin(submitted)`. Buffer is cleared
  immediately after capture so a failed verify never leaves digits on screen.

**T-03-06 mitigation asserted by code:** `pinBuffer` is cleared on
`showPinModal`, on `hidePinModal`, and immediately after OK submit. Never
written to DOM except as `•` / `·` dots.

## CSP compliance

Every interactive element wires via `addEventListener` inside `wireStatic()`:
no `onclick=`, no inline scripts, no `innerHTML` for user input. The host.html
CSP meta `script-src 'self'` is preserved unchanged. Automated grep check in
Task 2's verify confirms no `onclick` substring exists anywhere in host.html.

## D-21 compliance (no retry branch)

Per the D-21 override (reCAPTCHA blocks auto-retry on first failure), host.js
treats both `credentials-unavailable` and `login-failed` as recovery states:
neither branch contains retry logic, both show the `PIN eingeben` button,
both route via `requestPinRecovery` → Plan 07 → auth state machine's
`pin-recovery-requested` event. The retry loop lives nowhere in the host layer.

## Tests & verification

- `node --check src/main/preload.js` — syntax ok
- `node --check src/host/host.js` — syntax ok
- host.html grep suite: all 20 required substrings present; zero `onclick`
- host.css grep suite: all 15 required selectors present, including preserved
  `.bsk-layer--splash` and `.bsk-layer--magicline-error`
- host.js grep suite: 15 required identifiers present including all 3 variant
  branches and all new IPC invocations

No unit tests added for host.js — this is a plain-DOM renderer module that
Phase 3 never put under a test harness (no jsdom configured). Phase 3
acceptance for the overlay flow happens in plan 03-08 via a live-kiosk
walkthrough.

## Deviations from Plan

None. Plan executed exactly as written. Task 3 was applied via `Edit` (append
to existing file) rather than `Write` (full replace) because the file was
already readable and the plan explicitly said "append to the END".

## Files

- `src/main/preload.js` (13 → 34 lines)
- `src/host/host.html` (42 → 113 lines)
- `src/host/host.css` (115 → 321 lines)
- `src/host/host.js` (53 → 332 lines)
- `.planning/phases/03-credentials-auto-login-state-machine/03-06-SUMMARY.md` (this file)

## Follow-ups owned elsewhere

- **Plan 03-07 (main.js wire-up):** register IPC handlers for
  `submit-credentials`, `verify-pin`, `request-pin-recovery`, `launch-touch-keyboard`,
  and wire the state machine's side-effect dispatcher to send
  `show-credentials-overlay`, `hide-credentials-overlay`, `show-pin-modal`,
  `hide-pin-modal`, and the variant-tagged `show-magicline-error` IPCs back
  to the host renderer.
- **Plan 03-08 (phase acceptance):** live-kiosk walkthroughs covering the
  first-run overlay, the re-entry overlay after `DECRYPT_FAILED`, the 3x4
  keypad tap flow with a wrong-then-correct PIN, and the `login-failed`
  variant routing to `PIN eingeben`.
- **Plan 03-09 (kiosk probes):** confirm `launchTouchKeyboard` IPC actually
  spawns TabTip under the Assigned Access user (Probe A), and that touch
  events on the keypad register without any on-screen-keyboard interference.

## Self-Check: PASSED

Files verified on disk:
- FOUND: src/main/preload.js (34 lines, 13 kiosk methods)
- FOUND: src/host/host.html (credentials-overlay, pin-modal, error-pin-button, all German copy)
- FOUND: src/host/host.css (.bsk-layer--credentials, .bsk-layer--pin, .bsk-keypad, z-index:400)
- FOUND: src/host/host.js (showCredentialsOverlay, handleKeypadKey, pinBuffer, 3 variant branches)

Commits verified in git log:
- FOUND: 9244ec3 feat(03-06): extend preload.js with Phase 3 IPC surface
- FOUND: a6f90d9 feat(03-06): add credentials overlay and PIN modal to host.html
- FOUND: b1d8701 feat(03-06): add Phase 3 styles for credentials overlay and PIN keypad
- FOUND: cc3dd2d feat(03-06): wire Phase 3 UI in host.js
