---
phase: 10-post-sale-flow-with-print-interception
plan: 02
subsystem: infra
tags: [preload, ipc, context-bridge, phase-10, electron, post-sale]

# Dependency graph
requires:
  - phase: 04-nfc-input-idle-session-lifecycle
    provides: Preload IPC pattern for overlay main→renderer subscribers + fire-and-forget renderer→main notifiers (Phase 4 D-12 idle overlay template verbatim)
  - phase: 06-welcome-screen-lifecycle-redesign
    provides: Colon-separated IPC channel naming convention (welcome:show / welcome:tap) extended by post-sale:* channels
provides:
  - Four new methods on window.kiosk context-bridge object (onShowPostSale, onHidePostSale, notifyPostSaleNextCustomer, notifyPostSaleAutoLogout)
  - Renderer-visible IPC surface for the Phase 10 post-sale overlay lifecycle (D-19)
affects:
  - 10-05-main-post-sale-ipc-handlers (consumes post-sale:next-customer / post-sale:auto-logout on ipcMain side)
  - 10-07-host-js-overlay-lifecycle (consumes onShowPostSale / onHidePostSale subscribers + the two notify* senders)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Colon-separated IPC channel naming (post-sale:show, post-sale:hide, post-sale:next-customer, post-sale:auto-logout) — extension of Phase 06 welcome:* convention"
    - "Preload IPC surface: ipcRenderer.on for main→renderer subscriptions, ipcRenderer.send for renderer→main fire-and-forget — never ipcRenderer.invoke for overlay lifecycle channels"

key-files:
  created: []
  modified:
    - src/main/preload.js

key-decisions:
  - "D-19 canonical channel names applied verbatim: post-sale:show / post-sale:hide / post-sale:next-customer / post-sale:auto-logout"
  - "Phase 4 idle-overlay preload pattern followed exactly: ipcRenderer.on + ipcRenderer.send, no invoke (fire-and-forget overlay lifecycle)"
  - "Trailing commas preserved on all four new entries to match existing file style; new block inserted AFTER Phase 09 POS-state block and BEFORE the closing }); of exposeInMainWorld"

patterns-established:
  - "Phase 10 preload surface (D-19): expose all four post-sale channels in a single contiguous block so downstream consumers (host.js, main.js) can grep-locate them by phase marker"

requirements-completed: [SALE-01]

# Metrics
duration: 1m
completed: 2026-04-23
---

# Phase 10 Plan 02: Preload Post-Sale IPC Surface Summary

**Four new post-sale IPC methods exposed on window.kiosk — onShowPostSale / onHidePostSale subscribers plus notifyPostSaleNextCustomer / notifyPostSaleAutoLogout senders — following the Phase 4 idle-overlay template verbatim**

## Performance

- **Duration:** 1 min (~49 seconds)
- **Started:** 2026-04-23T08:04:38Z
- **Completed:** 2026-04-23T08:05:27Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Exposed four new post-sale IPC methods on the `kiosk` context-bridge object:
  - `onShowPostSale(cb)` — subscribes to `post-sale:show` (main → renderer)
  - `onHidePostSale(cb)` — subscribes to `post-sale:hide` (main → renderer)
  - `notifyPostSaleNextCustomer()` — sends on `post-sale:next-customer` (renderer → main, fire-and-forget)
  - `notifyPostSaleAutoLogout()` — sends on `post-sale:auto-logout` (renderer → main, fire-and-forget)
- Unblocked downstream plans 10-05 (main.js IPC handlers) and 10-07 (host.js overlay lifecycle) — both depend on this preload surface existing before their handlers/subscribers can wire up.
- Maintained 100% parity with the established Phase 4 idle-overlay template (lines 40-47 of preload.js): `ipcRenderer.on` for subscribers, `ipcRenderer.send` for notifiers, no `invoke`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Append post-sale IPC surface to the kiosk context-bridge object** — `4b80365` (feat)

## Files Created/Modified

- `src/main/preload.js` — Appended 11 lines (7 code + 4 comment) after the Phase 09 POS-state block and before the closing `});` of `contextBridge.exposeInMainWorld('kiosk', { ... })`. Added:
  - Phase marker comment `// --- Phase 10 — Post-sale overlay (D-19) ---------------------------------`
  - 2 main→renderer subscribers (onShowPostSale, onHidePostSale)
  - Explanatory comment referencing D-20 (auto-logout triggers sessionReset.hardReset with reason:'sale-completed', mode:'welcome') and D-06 (next-customer rearms the 60s idle timer)
  - 2 renderer→main fire-and-forget senders (notifyPostSaleNextCustomer, notifyPostSaleAutoLogout)

**Exact block inserted** (11 lines including leading blank line):

```javascript

  // --- Phase 10 — Post-sale overlay (D-19) ---------------------------------
  // Main → renderer: show / hide the branded "Vielen Dank" overlay.
  onShowPostSale: (cb) => ipcRenderer.on('post-sale:show', (_e) => cb()),
  onHidePostSale: (cb) => ipcRenderer.on('post-sale:hide', (_e) => cb()),
  // Renderer → main (fire-and-forget): button tap vs countdown-expiry
  // outcomes. D-20: auto-logout triggers sessionReset.hardReset with
  // reason:'sale-completed', mode:'welcome'. next-customer keeps the
  // Magicline session alive and rearms the 60s idle timer (D-06).
  notifyPostSaleNextCustomer: () => { ipcRenderer.send('post-sale:next-customer'); },
  notifyPostSaleAutoLogout:   () => { ipcRenderer.send('post-sale:auto-logout');   },
```

**Line count delta:** +11 lines (insertion only; no deletions, no edits to other entries).

**Structural integrity:** Closing `});` of `contextBridge.exposeInMainWorld` is still syntactically intact at line 98. `node --check src/main/preload.js` reports SYNTAX OK.

## Decisions Made

None — plan executed exactly as specified. All four channel names match D-19 canonical naming (`post-sale:show`, `post-sale:hide`, `post-sale:next-customer`, `post-sale:auto-logout`). All four method names match the plan's must-haves (`onShowPostSale`, `onHidePostSale`, `notifyPostSaleNextCustomer`, `notifyPostSaleAutoLogout`). Pattern follows Phase 4 idle-overlay template verbatim (`ipcRenderer.on` for subscribers, `ipcRenderer.send` for notifiers — never `invoke`).

## Deviations from Plan

None — plan executed exactly as written.

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Contains `onShowPostSale: (cb) => ipcRenderer.on('post-sale:show'` | PASSED (line 90) |
| Contains `onHidePostSale: (cb) => ipcRenderer.on('post-sale:hide'` | PASSED (line 91) |
| Contains `notifyPostSaleNextCustomer: () => { ipcRenderer.send('post-sale:next-customer'` | PASSED (line 96) |
| Contains `notifyPostSaleAutoLogout:   () => { ipcRenderer.send('post-sale:auto-logout'` | PASSED (line 97) |
| Phase 10 marker comment present | PASSED (line 88: `// --- Phase 10 — Post-sale overlay (D-19) ---`) |
| `grep -c "post-sale:" src/main/preload.js` returns exactly 4 | PASSED (4) |
| `grep -c "PostSale" src/main/preload.js` returns exactly 4 | PASSED (4) |
| No `ipcRenderer.invoke` for any post-sale channel | PASSED (0 matches for `ipcRenderer.invoke('post-sale:`) |
| File remains syntactically valid | PASSED (`node --check` reports SYNTAX OK) |
| Closing `});` of exposeInMainWorld present after insertion | PASSED (line 98) |
| No other existing method modified | PASSED (git diff shows only +11 additions, no modifications to onShowIdleOverlay / notifyWelcomeTap / etc.) |

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Threat Flags

None — plan 10-02 introduces no new trust boundaries or security-relevant surface beyond what the threat model explicitly enumerated (T-10-02-01 through T-10-02-03, all dispositioned `accept`).

## Self-Check: PASSED

**Created files:** None (plan only modifies existing preload.js)

**Modified files:**
- `src/main/preload.js` — FOUND, modifications present at lines 88-97

**Commits:**
- `4b80365` — FOUND (`git log --oneline --all | grep 4b80365` succeeds)

## Next Plan Readiness

Plan 10-02 unblocks two Wave 2 dependents:

- **Plan 10-05** (main.js IPC handlers) — can now implement `ipcMain.on('post-sale:next-customer')` / `ipcMain.on('post-sale:auto-logout')` handlers knowing the renderer will fire them via the new preload methods.
- **Plan 10-07** (host.js overlay lifecycle) — can now call `window.kiosk.onShowPostSale(cb)` / `window.kiosk.onHidePostSale(cb)` / `window.kiosk.notifyPostSaleNextCustomer()` / `window.kiosk.notifyPostSaleAutoLogout()` from the renderer.

No blockers or concerns. The preload surface is a pure capability exposure — no state, no side effects beyond method installation at contextBridge setup time.

---
*Phase: 10-post-sale-flow-with-print-interception*
*Completed: 2026-04-23*
