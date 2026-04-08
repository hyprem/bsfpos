# Phase 1: Locked-Down Shell & OS Hardening - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

A single, auto-starting, fullscreen Electron window owned by a hardened Windows account that a standing gym member cannot exit by any normal means. Scope ends at: branded splash cover visible, kiosk mode holding, all escape combos suppressed, OS-level lockdown documented and reproducible, single-instance behavior proven. Magicline is NOT loaded in this phase — Phase 2 attaches the child BrowserView. Credentials and auto-login are Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Window Architecture
- **D-01:** Single `BrowserWindow` (kiosk mode) loads a branded `host.html`. `host.html` is the permanent overlay layer and owns all branded surfaces across the lifetime of the app — splash (Phase 1), idle overlay (Phase 4), PIN modal / error / updating cover (Phase 5). Phase 1 ships the splash layer only; later phases add sibling `<div>`s toggled via IPC.
- **D-02:** Phase 2 will attach a child `BrowserView` (or `WebContentsView` — class name resolved at Phase 2 start) to the same `BrowserWindow` for Magicline content. Phase 1 must NOT preclude this: the host window is a full-size content host with the splash as an opaque top layer, and Phase 2 will size/position the child view to fill the viewport underneath.
- **D-03:** The splash cover is lifted only when the main process receives an IPC event named `cash-register-ready` from the injection layer. Phase 1 defines the IPC contract (`ipcMain.on('cash-register-ready', ...)`) and the main-side listener stub; Phase 2 wires the signal from inside the injected JS after the CSS hide layer matches. No timer-based fallback, no `did-finish-load` shortcut — no signal means the splash stays visible forever (correct failure mode for SHELL-06).

### Auto-Start & Single Instance
- **D-04:** Belt-and-suspenders auto-start: NSIS installer creates a Startup folder shortcut at install time, AND `app.setLoginItemSettings({openAtLogin: true, name: 'Bee Strong POS'})` is called on every app boot to self-heal if the shortcut is deleted. Both fire safely because of the single-instance lock (D-05).
- **D-05:** `app.requestSingleInstanceLock()` at top of `main.js`. If it returns false, `app.quit()` immediately — no `second-instance` event handler, no focus-existing logic. Kiosk mode guarantees the first window is already topmost, so focusing is a no-op. This matches SHELL-02 and success criterion 4's "silently discarded" wording exactly.

### First-Run Scope Boundary
- **D-06:** Phase 1 ends with the splash visible and the kiosk locked down. There is no "waiting for setup" placeholder after the splash — first-run credential capture belongs to Phase 3. On a fresh device with no credentials, Phase 1 success looks like: boot → branded splash → splash stays up forever (because no `cash-register-ready` signal will fire without Phase 2+3). This is the correct end state for Phase 1 and keeps its scope tight.

### Dev Mode & DevTools
- **D-07:** Dev mode is gated by `process.env.NODE_ENV === 'development'`, set by the `npm start` script in `package.json`. In dev mode: `kiosk: false`, `frame: true`, resizable 420x800 window (vertical tablet simulation), `before-input-event` handler is a no-op, `globalShortcut` registrations are skipped. Production builds never set `NODE_ENV=development` — this path is not reachable after packaging.
- **D-08:** In dev mode, DevTools auto-open detached on window creation (`mainWindow.webContents.openDevTools({mode: 'detach'})`). In production mode, DevTools shortcuts (Ctrl+Shift+I, F12, Ctrl+Shift+J) are on the suppression list and DevTools cannot be opened. Production debugging goes exclusively through `%AppData%/Bee Strong POS/logs/` over RDP (no local debug UI per PROJECT.md).

### Keyboard Lockdown
- **D-09:** Broad-sweep suppression in production via `before-input-event` on the host `BrowserWindow`. Suppressed combos: Alt+F4, Alt+Tab, Win (Meta), F11, Esc, Ctrl+W (the 6 required by SHELL-04) PLUS Ctrl+R, Ctrl+Shift+R, F5, Ctrl+Shift+I, F12, Ctrl+Shift+J, Ctrl+P, Ctrl+U, Ctrl+O, Ctrl+N, Ctrl+T. Safe because the Deka reader emits only alphanumerics + Enter (NFC-02) and Magicline's cash register UI does not rely on any of these shortcuts.
- **D-10:** Phase 1 exports a `reservedShortcuts` registry (a `Set<string>` keyed by canonical accelerator strings). The `before-input-event` handler checks this set BEFORE suppressing — any shortcut in the set passes through to the target handler. Phase 1 ships with the set empty. Phase 5's admin exit will register `Ctrl+Shift+F12` into this set when wiring the admin hotkey. Clean Phase 1 → Phase 5 interface, no rewrite required later.
- **D-11:** Defense in depth: Phase 1 also calls `globalShortcut.register` with no-op handlers for Alt+F4, F11, and Esc, catching OS-level chords during the window's split-second startup before kiosk mode fully activates. Registered in `app.whenReady()`, unregistered on `will-quit`.

### OS Hardening Runbook
- **D-12:** SHELL-05 deliverable is a set of **executable scripts** under `docs/runbook/` (not a manual checklist). Target: a fresh Windows 11 Pro install can reach kiosk-ready state by running the scripts in order, with GUI steps (Assigned Access wizard, local user creation) called out in a short companion checklist only where the OS does not expose a scriptable path. Contents: `.reg` files for registry hardening (disable edge swipes, Action Center, Task Manager via kiosk account, etc.), PowerShell scripts for GPO/local policy tweaks, and a README.md with the exact run order and verification steps. Reproducible, version-controlled, survives device replacement.
- **D-13:** Shell Launcher v2 vs Assigned Access vs GPO — this depends on the exact Windows 11 SKU on the gym's POS device and is flagged in research. Planning/research step for Phase 1 must verify the SKU first, then pick the mechanism. Document the chosen mechanism and the kiosk-mode-breakout checklist results in the runbook.

### Claude's Discretion
- Exact splash layout, animation timing, logo placement (brand assets `1 BSF_vertical.png` and `3 BSF_vertical_for dark BG.png` are at repo root — pick the one that matches the splash background).
- Exact file/module layout inside the Electron project (`main.js`, `preload.js`, `host.html`, `host.css`, `host.js`, etc.) — no strong preference, but keep `main.js` CommonJS per the PROJECT.md stack note (electron-store 10.x requires CJS).
- How to structure the `before-input-event` suppression list in code (array of accelerator strings vs a predicate function) — either is fine as long as `reservedShortcuts` is consulted first.
- Dev mode window dimensions (420x800 is a starting suggestion — adjust to match the real kiosk screen's aspect ratio if known).
- Exact package.json scripts: at minimum `npm start` sets `NODE_ENV=development` and runs `electron .`; `npm run build` packages with `electron-builder --win`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — full project vision, constraints, prescriptive stack, "what NOT to use" list
- `.planning/REQUIREMENTS.md` §Kiosk Shell & OS Lockdown — SHELL-01 through SHELL-06 requirement text
- `.planning/ROADMAP.md` §Phase 1 — goal, success criteria, phase dependencies
- `CLAUDE.md` — project instructions and GSD workflow enforcement
- `BeeStrong_POS_Kiosk_Project.md` — original project brief and Android prototype port notes

### Research
- `.planning/research/SUMMARY.md` §Phase 1 — "Walking Skeleton + OS Hardening"
- `.planning/research/ARCHITECTURE.md` — host window + BrowserView layering, `before-input-event` keyboard lockdown, single-instance lock
- `.planning/research/PITFALLS.md` — Windows kiosk breakout, `insertCSS` flash-of-unhidden-UI, Assigned Access gotchas
- `.planning/research/STACK.md` — Electron 41 pin, electron-builder NSIS, plain HTML/CSS/JS for overlays
- `.planning/research/FEATURES.md` — T1 kiosk lockdown, T12 auto-start

### Brand Assets
- `1 BSF_vertical.png` — Bee Strong logo, vertical orientation, light background
- `3 BSF_vertical_for dark BG.png` — Bee Strong logo, vertical orientation, dark background

### External Docs (to consult during research/planning step)
- Electron docs: `BrowserWindow` (kiosk option), `globalShortcut`, `before-input-event`, `app.requestSingleInstanceLock`, `app.setLoginItemSettings`
- Microsoft Learn: Shell Launcher v2, Assigned Access (Windows 11), GPO kiosk hardening
- `github.com/ikarus23/kiosk-mode-breakout` — re-enumerate current escape vectors against Win 11 build on the device
- electron-builder NSIS target docs — Startup folder shortcut config

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — this is a fresh project. Repo currently contains only `.planning/`, `CLAUDE.md`, brand PNGs, and `BeeStrong_POS_Kiosk_Project.md`. Phase 1 is the first phase that creates source code.

### Established Patterns
- None established yet. CLAUDE.md §Conventions explicitly says "Conventions not yet established. Will populate as patterns emerge during development." Phase 1 sets the initial conventions: CommonJS `main.js`, plain HTML/CSS/JS for the host layer, no TypeScript, no bundler for the main process.

### Integration Points
- Phase 1 → Phase 2 interface: `host.html` leaves space for a child `BrowserView`/`WebContentsView` to fill the viewport underneath the splash cover. Phase 2 attaches the view and sends `cash-register-ready` via IPC when hide rules have matched.
- Phase 1 → Phase 5 interface: `reservedShortcuts` Set exported from the keyboard lockdown module. Phase 5 adds `Ctrl+Shift+F12` (or the final chosen admin accelerator) to this set when wiring the admin exit.
- Phase 1 → all future phases: `host.html` is the permanent branded layer that hosts Phase 4's idle overlay and Phase 5's PIN modal / updating cover / error screen. Structure it with layered `<div>`s from day one so later phases only add sibling layers.

</code_context>

<specifics>
## Specific Ideas

- Default-deny keyboard philosophy: broader is safer because the Deka reader only emits alphanumerics + Enter. If Magicline ever relies on a suppressed shortcut, we'll find out during Phase 2 and can carve out a reserved-key exception.
- Dev window dimensions target vertical tablet (420x800 as starting point) — the real kiosk is a vertical touchscreen, so developing in a desktop-landscape window would produce layout surprises.
- `host.html` is permanent, not a splash that navigates away. This is the core architectural bet of Phase 1 and unlocks all later branded overlays without re-engineering.

</specifics>

<deferred>
## Deferred Ideas

- **Admin exit hotkey wiring** — Phase 5. Phase 1 only ships the `reservedShortcuts` hook point.
- **Idle overlay, PIN modal, updating cover, error screen** — Phases 4 and 5. Phase 1 only ships the splash layer inside `host.html`, but structures the file so these are added as sibling `<div>`s.
- **First-run credential capture UI** — Phase 3.
- **Code signing of the NSIS installer** — explicitly out of scope per REQUIREMENTS.md Out of Scope table ("Code-signed Windows installer"). SmartScreen one-click accepted for v1.
- **Windows SKU / Shell Launcher v2 vs Assigned Access pick** — flagged in research; decided during Phase 1 planning/research step after verifying the device SKU.
- **Welcome screen / attract loop** — OPS-04, v2.

</deferred>

---

*Phase: 01-locked-down-shell-os-hardening*
*Context gathered: 2026-04-08*
