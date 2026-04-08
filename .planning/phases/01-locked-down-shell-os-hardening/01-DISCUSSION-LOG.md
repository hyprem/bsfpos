# Phase 1: Locked-Down Shell & OS Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 01-locked-down-shell-os-hardening
**Areas discussed:** Window architecture, Auto-start mechanism, Dev escape hatch, Key intercept scope, OS runbook format

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Window architecture | Host + child view vs two windows vs single-window swap | ✓ |
| Auto-start mechanism | `setLoginItemSettings` vs NSIS Startup vs both | ✓ |
| Dev escape hatch | NODE_ENV vs --dev vs admin PIN vs none | ✓ |
| Key intercept scope | Just the 6 required vs broad sweep vs whitelist | ✓ |

**OS runbook format** — answered inline: **Executable scripts** (`.reg` + PowerShell + README under `docs/runbook/`).

---

## Window Architecture

### Q1: How should the host window relate to Magicline (which Phase 2 will embed)?

| Option | Description | Selected |
|--------|-------------|----------|
| Host + child view | One BrowserWindow loads `host.html`; Phase 2 attaches a child BrowserView for Magicline underneath | ✓ |
| Two BrowserWindows | Splash window on top, Magicline window beneath; z-order/focus races on Windows | |
| Single window, swap content | `loadFile('splash.html')` then `loadURL(magicline)`; loses permanent cover, fights SHELL-06 | |

**User's choice:** Host + child view
**Notes:** Phase 2 will attach the child view; class name (BrowserView vs WebContentsView) resolved at Phase 2 start.

### Q2: When does the branded splash lift to reveal the Magicline cash register?

| Option | Description | Selected |
|--------|-------------|----------|
| IPC `cash-register-ready` | Splash lifts only on explicit IPC signal from injection layer after CSS hide matched | ✓ |
| Timer-based (2s fade) | Fixed delay; risks flash of unhidden UI | |
| `did-finish-load` of BrowserView | Fires before React re-renders; flash still possible | |

**User's choice:** IPC `cash-register-ready`
**Notes:** Phase 1 ships the contract and main-side listener stub; Phase 2 wires the signal. No fallback — no signal means splash stays forever (correct failure mode).

### Q3: Should the branded cover element also serve as idle overlay / error screen / updating cover in later phases?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, one `host.html` | All branded surfaces as layered `<div>`s toggled via IPC | ✓ |
| Separate files per surface | `splash.html`, `idle.html`, etc.; brand drift risk | |

**User's choice:** Yes, one `host.html`

---

## Auto-Start Mechanism

### Q1: How should the kiosk launch on Windows boot?

| Option | Description | Selected |
|--------|-------------|----------|
| Both: NSIS Startup + `setLoginItemSettings` | Belt-and-suspenders; self-heals if shortcut deleted | ✓ |
| NSIS Startup shortcut only | Stops auto-starting if shortcut deleted | |
| `setLoginItemSettings` only | First boot won't auto-start until launched once | |

**User's choice:** Both — NSIS Startup shortcut AND `app.setLoginItemSettings({openAtLogin:true, name:'Bee Strong POS'})` called on every boot.

### Q2: What happens when a second instance launches?

| Option | Description | Selected |
|--------|-------------|----------|
| Silent quit | `requestSingleInstanceLock()` false → `app.quit()` immediately | ✓ |
| Focus existing + flash | No-op under kiosk mode anyway | |

**User's choice:** Silent quit — matches success criterion 4's "silently discarded" wording.

### Q3: How do we handle first boot with no credentials?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 3 | Phase 1 ends at "splash visible, kiosk locked" | ✓ |
| Phase 1 shows placeholder after splash | Extra screen Phase 3 would replace | |

**User's choice:** Defer to Phase 3. Phase 1 success = splash + kiosk lockdown, no Magicline load attempt.

---

## Dev Escape Hatch

### Q1: How should you develop locally without getting locked out?

| Option | Description | Selected |
|--------|-------------|----------|
| `NODE_ENV=development` guard | `npm start` sets it; production builds can't reach the code path | ✓ |
| `--dev` CLI flag | Runtime flag; less safe in the field | |
| Reuse admin PIN from Phase 5 | Couples Phase 1 to Phase 5 | |
| No escape hatch | Develop on second monitor, kill via Task Manager | |

**User's choice:** `NODE_ENV=development` guard — set by `npm start`, gates kiosk off, frame on, resizable 420x800, no key suppression.

### Q2: Should DevTools be reachable in dev mode, and how?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-open in dev, blocked in prod | Detached DevTools in dev; Ctrl+Shift+I/F12 suppressed in prod | ✓ |
| Always reachable via admin PIN | Small attack surface if PIN leaks | |
| Never — RDP + logs only | Matches "no local debug UI" constraint | |

**User's choice:** Auto-open in dev, fully blocked in prod. Production debugging = logs over RDP.

---

## Key Intercept Scope

### Q1: Which combos should `before-input-event` suppress in production?

| Option | Description | Selected |
|--------|-------------|----------|
| Broad sweep | 6 required + Ctrl+R, Ctrl+Shift+R, F5, Ctrl+Shift+I, F12, Ctrl+Shift+J, Ctrl+P, Ctrl+U, Ctrl+O, Ctrl+N, Ctrl+T | ✓ |
| Just the 6 required | Ctrl+R leaks cart, Ctrl+Shift+I opens DevTools | |
| Whitelist approach | Safest but could break Magicline keyboard shortcuts | |

**User's choice:** Broad sweep. Safe because Deka reader emits only alphanumerics + Enter.

### Q2: How to coordinate the Phase 5 admin hotkey (Ctrl+Shift+F12) with Phase 1's interceptor?

| Option | Description | Selected |
|--------|-------------|----------|
| Reserved-keys registry | Phase 1 exports `reservedShortcuts: Set<string>`; handler consults it before suppressing | ✓ |
| Hardcode Ctrl+Shift+F12 | Couples Phase 1 to Phase 5's specific choice | |
| Defer to Phase 5 refactor | Phase 1 lockdown code gets rewritten later | |

**User's choice:** Reserved-keys registry. Phase 1 ships with set empty; Phase 5 registers the admin accelerator.

### Q3: Also use `globalShortcut.register` to block OS-level chords?

| Option | Description | Selected |
|--------|-------------|----------|
| Both layers | `before-input-event` + no-op `globalShortcut` registrations for Alt+F4/F11/Esc | ✓ |
| `before-input-event` only | Relies on window always having focus | |

**User's choice:** Both layers (defense in depth).

---

## OS Runbook Format

| Option | Description | Selected |
|--------|-------------|----------|
| Executable scripts | `.reg` + PowerShell + README under `docs/runbook/` | ✓ |
| Manual checklist | Markdown + screenshots; drifts from reality | |
| Hybrid | Scripts + manual for GUI-only steps | |
| Defer to Phase 5 | SHELL-05 listed under Phase 1, shouldn't defer | |

**User's choice:** Executable scripts (with short companion checklist only for GUI-only steps the OS doesn't expose scriptably).

---

## Claude's Discretion

- Exact splash layout / animation / logo selection between the two PNGs
- Module/file layout inside the Electron project (keeping `main.js` CommonJS)
- Structure of the suppression list in code (array of accelerators vs predicate)
- Dev mode window dimensions
- Exact `package.json` scripts

## Deferred Ideas

- Admin exit hotkey wiring — Phase 5 (Phase 1 only ships the `reservedShortcuts` hook)
- Idle overlay / PIN modal / updating cover / error screen — Phases 4 and 5
- First-run credential capture UI — Phase 3
- Code signing — explicitly out of scope for v1
- Windows SKU / Shell Launcher v2 vs Assigned Access pick — flagged for Phase 1 research step
- Welcome / attract loop — OPS-04, v2
