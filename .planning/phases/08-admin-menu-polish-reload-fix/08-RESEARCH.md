# Phase 08: Admin Menu Polish & Reload Fix — Research

**Researched:** 2026-04-20
**Domain:** Electron IPC / Plain HTML+CSS+JS overlay layer / admin menu state machine
**Confidence:** HIGH — all findings verified against actual source files in this session

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Close Button (ADMIN-01)**
- D-01: Top-right X button on the admin menu, above the diagnostic header. Min 44x44 px tap target. Discreet style — outlined or subtle, consistent with dark/yellow brand palette. Uses existing `.bsk-btn` pattern family.
- D-02: Esc key (host-side keydown listener while admin layer is visible) routes through same `admin:close` handler. Only fires from ROOT admin menu — Esc from nested screens (credentials overlay, PAT config) is handled by those screens' own cancel paths. Does NOT cascade to admin close.
- D-03: Ctrl+Shift+F12 toggles the admin menu. Second press when admin is already open routes through `admin:close`. Handler checks `adminMenuOpen` state: if open, close; if closed, open PIN modal as before.
- D-04: `admin:close` handler in main.js sets `adminMenuOpen = false`, sends `hide-admin-menu` to host, and calls `setMagiclineViewVisible(true)` if a Magicline view exists (restores cash register). If no Magicline view (welcome state), sends `welcome:show` instead. Emits `admin.action action=close-menu` audit log line.
- D-05: Closing admin during PAT lockout dismisses the admin panel WITHOUT resetting the lockout countdown. On reopen, lockout panel resumes with existing countdown. Lockout state persists in electron-store.

**Credentials Re-Entry Mode (ADMIN-03)**
- D-06: "Anmeldedaten andern" sends `show-credentials-overlay` with `{ firstRun: false }`. Host-side `showCredentialsOverlay(payload)` hides `#creds-firstrun-fields` when `firstRun === false`. First-boot path continues to send `{ firstRun: true }` (all 4 fields). Root cause investigation needed during research.
- D-07: Audit log: `admin.action action=credentials-changed` for Magicline credential updates, `admin.action action=pin-changed` for PIN changes.

**PIN Change Button (scope addition)**
- D-08: New admin menu button "PIN andern" placed after "Anmeldedaten andern" and before "Auto-Update einrichten". Follows Phase 5 D-02 safe-to-destructive ordering.
- D-09: PIN change flow opens a focused overlay with three fields: "Aktuelle PIN", "Neue PIN", "PIN bestatigen", plus "Speichern" and "Abbrechen" buttons.
- D-10: Requires re-entry of CURRENT PIN via `adminPin.verifyPin(store, currentPin)`. Uses the Phase 3 module directly (NOT the lockout wrapper).
- D-11: On successful PIN change: `adminPin.setPin(store, newPin)`, emit `admin.action action=pin-changed`, return to admin menu. Does NOT reset lockout state.

**Kasse Nachladen Welcome-State Fix (FIX-01)**
- D-12: `admin-menu-action` handler for `reload` checks Magicline view existence via new public `magiclineView.exists()` method (wraps `getMagiclineWebContents() !== null`).
- D-13: When `magiclineView.exists()` returns false: admin menu closes, handler triggers fresh session (same flow as welcome tap). Layer 2 interpretation adopted.
- D-14: When `magiclineView.exists()` returns true: existing behavior unchanged — `magiclineView.reload()` + authFlow restart from BOOTING.
- D-15: Admin menu always closes before the fresh session/reload starts. Splash appears immediately.

### Claude's Discretion

- Exact CSS for the X button (icon glyph vs text "X" vs SVG, hover/pressed states) — consistent with dark/yellow palette and existing button patterns.
- Whether the PIN change overlay reuses `#credentials-overlay` with a third mode or is a new `#pin-change-overlay` div — pick whatever keeps the HTML cleanest.
- Exact error messages for PIN change validation failures (mismatch, too short, wrong current PIN) — German, consistent with existing credential form patterns.
- Whether `magiclineView.exists()` is a standalone export or a method on an object — match the existing module's export style.

### Deferred Ideas (OUT OF SCOPE)

- POS open/close toggle — ADMIN-02, Phase 09 scope.
- Cash-register banner for `posOpen=false` mid-session — lower-priority polish on ADMIN-02.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | Discreet close control (X button / Esc / Ctrl+Shift+F12 second press) for admin menu; returns to prior layer; lockout-safe | D-01 through D-05. `close-admin-menu` IPC handler already exists at main.js:842-850 and needs extension. Ctrl+Shift+F12 handler fires `openAdminPinModal()` unconditionally — needs `adminMenuOpen` toggle branch. |
| ADMIN-03 | "Anmeldedaten andern" opens credentials overlay in re-entry mode (no PIN fields); separate PIN-change path added | D-06 through D-11. Root-cause verified: main.js already sends `{ firstRun: false }` at line 786. Bug is NOT in the IPC payload — it is in host.js `showCredentialsOverlay()` which does NOT update the card title when `firstRun=false`. The `#creds-firstrun-fields` visibility toggle is already correct. The title stays "Kiosk einrichten" in both modes, which is the observable mismatch. |
| FIX-01 | "Kasse nachladen" from welcome state triggers fresh session instead of crashing against null view | D-12 through D-15. `magiclineView.exists()` does not exist yet — must add. The `reload` case in `admin-menu-action` calls `mainWindow.webContents.reload()` (reloads the HOST window, not Magicline) rather than `magiclineView.reload()`. Both the null-safety bug and the wrong reload target must be fixed together. |

</phase_requirements>

---

## Summary

Phase 08 makes three surgical fixes to the admin menu surface, plus adds a new PIN-change path. All changes are confined to four files: `src/host/host.html`, `src/host/host.js`, `src/host/host.css`, and `src/main/main.js`, with a one-method addition to `src/main/magiclineView.js` and two new IPC channels in `src/main/preload.js`. No new modules, no new npm packages, and no changes to the test infrastructure beyond the test files that cover these modules.

Research found one important discrepancy between the CONTEXT.md analysis and the actual code. The CONTEXT.md states "the bug may be in main.js sending the wrong payload." Code inspection shows main.js already sends `{ firstRun: false }` at line 786. The `showCredentialsOverlay` host function already hides `#creds-firstrun-fields` correctly when `firstRun=false`. The actual bug is narrower: the credentials overlay card title remains "Kiosk einrichten" in re-entry mode, making it look like first-run mode even though the PIN fields are hidden. The fix for ADMIN-03 is a one-line title update in `showCredentialsOverlay()` plus the new PIN-change overlay.

A second discrepancy: the CONTEXT.md reload bug description says `magiclineView.reload()` is called against null. The actual `reload` case in `admin-menu-action` calls `mainWindow.webContents.reload()` — this reloads the **host BrowserWindow**, not the Magicline view, which explains why the BITTE WARTEN splash appears (the host HTML reloads, re-shows splash, but no Magicline view is loading behind it). The fix must address both the null-safety check AND replace `mainWindow.webContents.reload()` with a proper Magicline reload sequence.

**Primary recommendation:** All four requirements can be addressed in a single sequential wave. The UI-SPEC for Phase 08 is already locked, and the code patterns are well-established. No new dependencies, no new modules, no architecture decisions left open.

---

## Standard Stack

### Core (no additions needed)

All required libraries are already installed and wired. This phase adds no npm packages.

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| Electron `ipcMain` / `ipcRenderer` | built-in (Electron 41) | IPC between main and host renderer | Already used; Phase 08 adds 3 new channels |
| `electron-store` 10.x | `^10.1.x` | Persist lockout state across close/reopen cycles | Already in use; no new keys |
| `adminPin.js` | Phase 3 module | `verifyPin(store, pin)` + `setPin(store, pin)` for PIN change flow | READ-ONLY per D-10/D-11 |
| `log.audit()` | Phase 5 logger | Structured audit events | Already imported in main.js |

**Installation:** None required.

---

## Architecture Patterns

### Established Pattern: Main sends, host renders

All admin menu state (`adminMenuOpen`) lives in `main.js`. Host.js is a pure renderer — it shows/hides DOM based on IPC signals, never holds authoritative state. Phase 08 follows this exactly.

### Established Pattern: Sibling divs on layered z-index, IPC-toggled

`#pin-change-overlay` is a new `<div>` at z-index 400 (`.bsk-layer--credentials` class, same backdrop as credentials overlay). It is toggled via IPC, not CSS classes. It is mutually exclusive with `#credentials-overlay` and `#pin-modal`.

### Established Pattern: `wireAdminButtons()` maps button IDs to action strings

```javascript
// host.js lines 671-689 — current handler map
var handlers = {
  'admin-btn-check-updates':   'check-updates',
  'admin-btn-logs':            'view-logs',
  'admin-btn-reload':          'reload',
  'admin-btn-credentials':     're-enter-credentials',
  'admin-btn-update-config':   'configure-auto-update',
  'admin-btn-dev-mode':        'toggle-dev-mode',
  'admin-btn-exit':            'exit-to-windows',
};
```

Phase 08 adds:
- `'admin-btn-pin-change': 'pin-change'` to this map
- A separate click handler for `#admin-btn-close` that invokes `window.kiosk.closeAdminMenu()` (already exposed in preload.js)

### Anti-Patterns to Avoid

- **Don't cascade Esc from nested overlays.** The Esc keydown listener must check `#pin-change-overlay` and `#credentials-overlay` visibility before routing to `admin:close`. D-02 is explicit: only the root admin menu's Esc fires `admin:close`.
- **Don't call `mainWindow.webContents.reload()` for Magicline.** This reloads the host HTML, not the Magicline child view. The correct sequence for a real reload is: close admin menu, call `magiclineView.reload()` if the view exists, restart authFlow.
- **Don't reuse `adminPinLockout.verifyPinWithLockout` for PIN change re-verification.** Use `adminPin.verifyPin(store, pin)` directly per D-10. The lockout wrapper is only for the PIN modal entry path.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PIN hashing | Custom hash function | `adminPin.verifyPin(store, pin)` + `adminPin.setPin(store, pin)` | Phase 3 module already uses scrypt with timing-safe compare |
| Audit logging | Raw `console.log` | `log.audit('admin.action', { action: ... })` | Phase 5 log.audit provides redaction + structured format |
| Overlay visibility | New CSS class toggles | `el.style.display = 'flex'/'none'` + `el.setAttribute('aria-hidden', ...)` | Matches all existing overlay show/hide patterns exactly |

---

## Runtime State Inventory

> This phase is not a rename/refactor/migration phase. Omit full inventory.

No stored data, live service config, OS-registered state, secrets/env vars, or build artifacts are affected by Phase 08. The changes are additive: new IPC channels, new DOM elements, new switch cases. No existing keys in `electron-store` are renamed or removed.

---

## Common Pitfalls

### Pitfall 1: Ctrl+Shift+F12 toggle — two handler locations

**What goes wrong:** The Ctrl+Shift+F12 hotkey fires `openAdminPinModal()` in two places in main.js: (a) the `globalShortcut.register` callback at line 318 and (b) the `before-input-event` listener on the host webContents at line 346. A third listener exists inside `magiclineView.js` at line 248-252, which calls `adminHotkeyHandler()` (also `openAdminPinModal`). All three must be updated to check `adminMenuOpen` and route to close if already open. Missing any one of them means the toggle is incomplete for that input path.

**Why it happens:** The hotkey was intentionally registered in three places (defense-in-depth per Phase 5 D-08) — one globalShortcut, one host-wc before-input-event, one magicline-wc before-input-event.

**How to avoid:** Change `openAdminPinModal` itself to check `adminMenuOpen` and either call a shared `closeAdminMenu()` helper or call `openAdminPinModal` logic. Since all three paths call `openAdminPinModal()`, centralizing the toggle inside that function covers all three paths with a single change.

**Warning signs:** Admin can toggle open but not toggle closed via hotkey; requires two presses of Ctrl+Shift+F12 to reopen after close.

### Pitfall 2: Esc key cascades through nested overlays

**What goes wrong:** A global `keydown` listener for Esc on the admin layer will fire even when a nested overlay (credentials, PIN change, PAT config) is visible, closing the admin menu and leaving the nested overlay open but orphaned.

**Why it happens:** The admin layer is always behind the nested overlays in z-order, but if the Esc listener is on `document` it fires regardless.

**How to avoid:** In the Esc handler, check whether any nested overlay is currently visible (`#credentials-overlay` or `#pin-change-overlay` display !== 'none') before routing to `admin:close`. If a nested overlay is visible, let the nested overlay's own Abbrechen/cancel path handle Esc.

**Warning signs:** Tapping credentials Abbrechen returns to admin menu correctly, but pressing Esc while credentials overlay is open instantly closes the admin menu.

### Pitfall 3: `admin:close` missing the welcome-state branch

**What goes wrong:** The existing `close-admin-menu` IPC handler (main.js lines 842-850) always calls `setMagiclineViewVisible(true)`. If the admin was opened from the welcome state (no Magicline view), `setMagiclineViewVisible(true)` is a no-op (guard at line 641: `if (!magiclineView) return`), and no `welcome:show` is sent. The host stays on the admin overlay with nothing behind it.

**Why it happens:** The handler predates Phase 6 welcome-state awareness.

**How to avoid:** The extended `admin:close` path must mirror FIX-01's pattern: check `getMagiclineWebContents() !== null` (or the new `magiclineView.exists()`). If a view exists, call `setMagiclineViewVisible(true)`. If no view, send `welcome:show` instead.

**Warning signs:** Closing admin from welcome state leaves the screen black or frozen on admin overlay. Closing admin from an active session still works correctly.

### Pitfall 4: `reload` case calls `mainWindow.webContents.reload()` not `magiclineView.reload()`

**What goes wrong:** The current `reload` case (main.js line 777) calls `mainWindow.webContents.reload()`. This reloads the host BrowserWindow's HTML (host.html itself), causing the splash to re-appear and the host.js event wiring to re-initialize, but the Magicline child view is unaffected. The BITTE WARTEN splash appears and never clears because no Magicline auth flow is triggered.

**Why it happens:** `mainWindow.webContents` refers to the host renderer (host.html), not the Magicline child view. The correct target is the Magicline `WebContentsView`.

**How to avoid:** Replace the `reload` case with:
1. `magiclineView.exists()` check (FIX-01).
2. If view exists: close admin, call the Magicline view's webContents `loadURL` / `reload` approach, restart authFlow from BOOTING. Do NOT call `mainWindow.webContents.reload()`.
3. If no view: close admin, trigger `startLoginFlow()` equivalent (send splash:show, welcome:hide, call `startLoginFlow`).

**Warning signs:** "Kasse nachladen" from an active session causes host.html to visibly reload (flash of BITTE WARTEN) but Magicline does not reload.

### Pitfall 5: `showCredentialsOverlay` does not update the card title on mode switch

**What goes wrong:** The existing `showCredentialsOverlay(payload)` in host.js hides `#creds-firstrun-fields` correctly when `firstRun=false`, but does not change the `#credentials-overlay .bsk-card-title` text from "Kiosk einrichten" to "Anmeldedaten andern". An admin tapping "Anmeldedaten andern" sees the title "Kiosk einrichten", making it look like a first-run flow.

**Root cause confirmed:** The current code at host.js lines 299-318 has the correct `firstRunFields.style.display = credsFirstRun ? 'block' : 'none'` toggle, but no title update. The main.js payload at line 786 (`{ firstRun: false }`) is already correct.

**How to avoid:** In `showCredentialsOverlay(payload)`, add: `cardTitle.textContent = credsFirstRun ? 'Kiosk einrichten' : 'Anmeldedaten \u00E4ndern'`.

---

## Code Examples

Verified patterns from existing source:

### magiclineView.exists() — match existing export style

The module exports a flat set of named functions (not an object/class). `exists()` follows the same pattern:

```javascript
// src/main/magiclineView.js — add this function
function exists() {
  return magiclineView !== null;
}

// Add to module.exports:
module.exports = {
  createMagiclineView,
  destroyMagiclineView,
  getMagiclineWebContents,
  setMagiclineViewVisible,
  setAdminHotkeyHandler,
  enableDevMode,
  disableDevMode,
  isDevMode,
  clearCookiesAndReload,
  exists,  // Phase 08 FIX-01
  // ...
};
```

[VERIFIED: src/main/magiclineView.js lines 726-742 — existing export pattern]

### admin-menu-action reload case — corrected pattern

```javascript
case 'reload': {
  adminMenuOpen = false;
  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
  try { mainWindow.webContents.send('setMagiclineViewVisible', false); } catch (_) {}
  const { exists: mvExists } = require('./magiclineView');
  if (mvExists()) {
    // Active session: reload Magicline and restart authFlow
    try {
      const wc = require('./magiclineView').getMagiclineWebContents();
      if (wc && !wc.isDestroyed()) {
        require('./authFlow').start({
          mainWindow, webContents: wc, store, safeStorage, log
        });
        wc.reload();
      }
    } catch (e) { log.error('admin reload failed: ' + (e && e.message)); }
  } else {
    // Welcome state: start fresh session (Layer 2 behavior, D-13)
    welcomeTapPending = true;
    try { mainWindow.webContents.send('welcome:hide'); } catch (_) {}
    try { mainWindow.webContents.send('splash:show'); } catch (_) {}
    startLoginFlow();
  }
  return { ok: true };
}
```

[ASSUMED] — The exact `authFlow.start` call site uses the existing `store` and `safeStorage` closures from `app.whenReady`. The planner should confirm that the `startLoginFlow` helper defined at main.js line 488 is directly reusable here.

### close-admin-menu IPC handler — extended pattern

```javascript
// main.js lines 842-850 — existing handler
ipcMain.handle('close-admin-menu', async () => {
  adminMenuOpen = false;
  log.audit('admin.action', { action: 'close-menu' });
  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
  const { exists: mvExists, setMagiclineViewVisible } = require('./magiclineView');
  if (mvExists()) {
    try { setMagiclineViewVisible(true); } catch (_) {}
  } else {
    try { mainWindow.webContents.send('welcome:show'); } catch (_) {}
  }
  return { ok: true };
});
```

[VERIFIED: src/main/main.js lines 842-850 — existing handler shape; extension is additive]

### Ctrl+Shift+F12 toggle — centralize in openAdminPinModal

```javascript
// main.js — replace unconditional openAdminPinModal with toggle
function openAdminPinModal() {
  if (adminMenuOpen) {
    // D-03: second press closes the admin menu
    closeAdminMenu();
    return;
  }
  // Original logic: surface the admin PIN modal
  if (!mainWindow) return;
  log.info('adminHotkey: Ctrl+Shift+F12 pressed — surfacing admin PIN modal');
  try {
    const { setMagiclineViewVisible } = require('./magiclineView');
    setMagiclineViewVisible(false);
  } catch (_) {}
  try {
    mainWindow.webContents.send('show-pin-modal', { context: 'admin' });
  } catch (e) {
    log.error('adminHotkey.send failed: ' + (e && e.message));
  }
}

// Shared helper to avoid duplication across hotkey + IPC handler
function closeAdminMenu() {
  adminMenuOpen = false;
  log.audit('admin.action', { action: 'close-menu' });
  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
  const { exists: mvExists, setMagiclineViewVisible } = require('./magiclineView');
  if (mvExists()) {
    try { setMagiclineViewVisible(true); } catch (_) {}
  } else {
    try { mainWindow.webContents.send('welcome:show'); } catch (_) {}
  }
}
```

[VERIFIED: src/main/main.js lines 71-83, 342-348 — all three hotkey registrations call `openAdminPinModal()`; centralizing the toggle there covers all three]

### PIN change IPC handler — new `pin-change` case

```javascript
case 'pin-change': {
  // D-09: hide admin menu, show #pin-change-overlay
  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
  try { mainWindow.webContents.send('show-pin-change-overlay'); } catch (_) {}
  // adminMenuOpen stays false until admin returns from PIN change
  adminMenuOpen = false;
  return { ok: true };
}
```

And a new IPC handler for PIN change submission:

```javascript
ipcMain.handle('submit-pin-change', async (_e, payload) => {
  if (!payload || typeof payload.currentPin !== 'string' || typeof payload.newPin !== 'string') {
    return { ok: false, error: 'invalid-payload' };
  }
  // D-10: re-verify current PIN using raw adminPin (NOT lockout wrapper)
  const ok = adminPin.verifyPin(store, payload.currentPin);
  if (!ok) {
    log.audit('pin.verify', { result: 'fail', via: 'pin-change' });
    return { ok: false, error: 'wrong-pin' };
  }
  try {
    adminPin.setPin(store, payload.newPin);
    log.audit('admin.action', { action: 'pin-changed' });
    return { ok: true };
  } catch (e) {
    log.error('ipc.submit-pin-change failed: ' + (e && e.message));
    return { ok: false, error: String(e && e.message) };
  }
});
```

[VERIFIED: src/main/adminPin.js lines 76-93 — `verifyPin(store, input)` signature confirmed; src/main/adminPin.js lines 70-74 — `setPin(store, newPin)` signature confirmed]

### X button placement in host.html

```html
<!-- Inside .bsk-card--admin, as first child per UI-SPEC -->
<div class="bsk-card bsk-card--admin">
  <button type="button"
          id="admin-btn-close"
          class="bsk-btn"
          aria-label="Admin-Men&uuml; schlie&szlig;en"
          style="position:absolute; top:8px; right:8px; min-width:44px; min-height:44px;">
    &times;
  </button>
  <!-- rest of card content -->
</div>
```

The `.bsk-card--admin` needs `position: relative` added to its CSS declaration to make the absolute positioning work.

[VERIFIED: src/host/host.html lines 174-195 — current admin menu card structure; UI-SPEC line 139 — placement spec]

### New IPC channels to expose in preload.js

```javascript
// Add to contextBridge.exposeInMainWorld('kiosk', { ... }):

// Phase 08 — PIN change overlay (main → renderer)
onShowPinChangeOverlay: (cb) => ipcRenderer.on('show-pin-change-overlay', () => cb()),
onHidePinChangeOverlay: (cb) => ipcRenderer.on('hide-pin-change-overlay', () => cb()),

// Phase 08 — PIN change submit (renderer → main)
submitPinChange: (payload) => ipcRenderer.invoke('submit-pin-change', payload),
```

[VERIFIED: src/main/preload.js lines 50-67 — existing Phase 5 pattern for on/off pairs + invoke]

---

## State of the Art

| Old Behavior | Phase 08 Behavior | Notes |
|---|---|---|
| No way to dismiss admin menu non-destructively | X button + Esc + Ctrl+Shift+F12 toggle | Admin can now "just check the version" without side effects |
| "Anmeldedaten andern" shows "Kiosk einrichten" title | Shows "Anmeldedaten andern" title, no PIN fields | Title fix + correct field hiding |
| No explicit PIN change path | New "PIN andern" admin button with current-PIN verification | Defense-in-depth: re-verify even though admin already authenticated |
| "Kasse nachladen" from welcome crashes/wedges | Triggers fresh session (Layer 2) | Admin gets what they asked for: a live session |
| `close-admin-menu` always calls `setMagiclineViewVisible(true)` | Branches on `magiclineView.exists()` | welcome-state safe |
| `reload` case reloads host HTML via `mainWindow.webContents.reload()` | Reloads Magicline child view via `getMagiclineWebContents().reload()` + authFlow restart | Correct reload target |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `startLoginFlow` closure defined at main.js:488 is accessible from the `admin-menu-action` switch case without threading extra parameters | Code Examples — reload case | Low; both are inside the same `app.whenReady` callback scope |
| A2 | The `authFlow.start()` call accepts repeated calls with the same webContents and safely resets to BOOTING | Code Examples — reload case | Low; Phase 3 D-20 states "authFlow resets its own retry counter on any cash-register-ready event" and Phase 3 D-01 establishes `start()` re-seeds currentState |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

All other claims in this document are tagged VERIFIED from direct source-file inspection in this session.

---

## Open Questions

1. **authFlow.start() for Magicline reload (FIX-01 active-session branch)**
   - What we know: `startLoginFlow()` at main.js:488 creates the view if needed and calls `authFlow.start()`. For the reload branch the view already exists; we just need to restart authFlow on the existing webContents.
   - What's unclear: Does calling `authFlow.start({ ... webContents: wc ... })` reset the state machine cleanly when called on an already-running authFlow (e.g. after a previous successful login)?
   - Recommendation: Inspect `authFlow.start()` implementation to confirm it resets `currentState = 'BOOTING'` unconditionally. If so, calling it again is safe. If it guards against re-entry, add a `authFlow.reset()` call first.

2. **admin:close IPC vs `closeAdminMenu` helper**
   - What we know: The existing `close-admin-menu` IPC handler at main.js:842 does most of what `closeAdminMenu()` needs. The `admin-menu-action` case for `pin-change` also needs to re-show the admin menu after PIN change completes — which is handled by the renderer's `onHidePinChangeOverlay + showAdminMenu` sequence.
   - What's unclear: Whether the `close-admin-menu` IPC handler should be updated to call the shared `closeAdminMenu()` helper, or whether the helper is only used inside main.js (hotkey + pin-change return-to-menu).
   - Recommendation: Extract `closeAdminMenu()` as a module-scoped helper in main.js. Both the IPC handler and `openAdminPinModal()` call it. Clean deduplication.

---

## Environment Availability

> Step 2.6: SKIPPED (no external dependencies identified — this is a code/config-only change phase with no new CLI tools, runtimes, or services)

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (package.json `"test": "jest"`) |
| Config file | `jest.config.js` or inline package.json |
| Quick run command | `npm test -- --testPathPattern=host` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | `admin:close` IPC returns to prior layer (welcome vs cash register) | unit | `npm test -- --testPathPattern=main.admin` | Needs new test |
| ADMIN-01 | Esc handler does not cascade from nested overlays | unit | `npm test -- --testPathPattern=host` | Needs new test |
| ADMIN-01 | Ctrl+Shift+F12 toggle: second press closes, not re-opens PIN modal | unit | `npm test -- --testPathPattern=main.admin` | Needs new test |
| ADMIN-03 | `show-credentials-overlay { firstRun: false }` shows only username+password fields | unit | `npm test -- --testPathPattern=host` | May extend existing |
| ADMIN-03 | `show-credentials-overlay { firstRun: false }` shows "Anmeldedaten andern" title | unit | `npm test -- --testPathPattern=host` | Needs new test |
| ADMIN-03 | `submit-pin-change` with wrong current PIN returns `{ ok: false, error: 'wrong-pin' }` | unit | `npm test -- --testPathPattern=main.admin` | Needs new test |
| ADMIN-03 | `submit-pin-change` with matching PINs calls `adminPin.setPin` | unit | `npm test -- --testPathPattern=main.admin` | Needs new test |
| FIX-01 | `admin-menu-action reload` when `exists()=false` calls `startLoginFlow` not `mainWindow.webContents.reload()` | unit | `npm test -- --testPathPattern=main.admin` | Needs new test |
| FIX-01 | `admin-menu-action reload` when `exists()=true` calls `getMagiclineWebContents().reload()` | unit | `npm test -- --testPathPattern=main.admin` | Needs new test |
| FIX-01 | `magiclineView.exists()` returns false when view is null, true when view exists | unit | `npm test -- --testPathPattern=magiclineView` | Extend existing |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern="(host|main.admin|magiclineView)"`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] New test cases for `admin:close` welcome-state branch — covers ADMIN-01 + FIX-01
- [ ] New test cases for `submit-pin-change` IPC handler — covers ADMIN-03 PIN change
- [ ] New test cases for credentials overlay mode title — covers ADMIN-03 title fix
- [ ] `magiclineView.exists()` unit test — extend existing magiclineView test file

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (PIN change) | `adminPin.verifyPin(store, currentPin)` — re-verify before PIN change (D-10) |
| V3 Session Management | no | No session tokens involved |
| V4 Access Control | yes | `adminMenuOpen` gate on `admin-menu-action` already enforced; PIN change IPC must also check admin was authenticated |
| V5 Input Validation | yes | PIN format validated by `PIN_REGEX = /^[0-9]{4,6}$/` in adminPin.js; new PIN must pass `validatePinFormat` before `setPin` |
| V6 Cryptography | yes (PIN storage) | scrypt + timingSafeEqual in `adminPin.js` — do not hand-roll |

### Known Threat Patterns for Admin PIN Change

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized PIN reset (maintenance tech with temporary access) | Elevation of Privilege | D-10: re-verification of current PIN before allowing change |
| PIN brute force via `submit-pin-change` | Spoofing | Use `adminPin.verifyPin` (which does NOT use lockout). Note: this is intentional per D-10 — the admin already authenticated via `adminPinLockout` to enter the menu. A separate lockout on PIN-change would lock out the admin who just proved their PIN. |
| Audit log bypass (PIN changed silently) | Repudiation | D-07 + D-11: `log.audit('admin.action', { action: 'pin-changed' })` on every successful change |

**Security note on `submit-pin-change` and lockout:** D-10 explicitly uses `adminPin.verifyPin` (raw, no lockout) rather than the lockout wrapper. This is intentional: the admin already passed lockout to enter the menu. The threat of a second brute-force attempt INSIDE the menu is bounded by the fact that entering the menu itself required passing lockout. If a future phase wants to re-add lockout here, it should use a separate attempt counter, not the same one as the entry gate.

---

## Sources

### Primary (HIGH confidence — verified against source files in this session)

- `src/main/main.js` lines 740-838 — `admin-menu-action` switch, `reload` case, `re-enter-credentials` case
- `src/main/main.js` lines 842-850 — `close-admin-menu` IPC handler
- `src/main/main.js` lines 71-83 — `openAdminPinModal()` function
- `src/main/main.js` lines 316-348 — Ctrl+Shift+F12 registration (globalShortcut + before-input-event)
- `src/main/main.js` lines 488-503 — `startLoginFlow` closure
- `src/main/magiclineView.js` lines 726-742 — exported functions (no `exists()` present)
- `src/main/magiclineView.js` lines 630-632 — `getMagiclineWebContents()` — wraps `magiclineView !== null` check
- `src/main/adminPin.js` lines 70-108 — `setPin(store, newPin)`, `verifyPin(store, input)` signatures
- `src/host/host.html` lines 167-195 — current `#admin-menu` structure
- `src/host/host.html` lines 95-136 — current `#credentials-overlay` structure
- `src/host/host.js` lines 299-318 — `showCredentialsOverlay(payload)` — VERIFIED: `firstRun` toggle already correct for fields; title NOT updated
- `src/host/host.js` lines 671-689 — `wireAdminButtons()` handler map
- `src/main/preload.js` lines 50-67 — existing Phase 5 IPC surface (pattern for new channels)

### Secondary (MEDIUM confidence)

- `.planning/phases/08-admin-menu-polish-reload-fix/08-CONTEXT.md` — locked decisions
- `.planning/phases/08-admin-menu-polish-reload-fix/08-UI-SPEC.md` — visual contract (already approved)
- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md` — Phase 5 patterns (admin menu structure, lockout persistence, audit log format)
- `.planning/phases/03-credentials-auto-login-state-machine/03-CONTEXT.md` — `adminPin.js` contract

### Tertiary (LOW confidence)

None — all material claims verified from source.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all libraries verified in source
- Architecture: HIGH — all patterns verified from existing source
- Pitfalls: HIGH — Pitfalls 1-5 confirmed from direct code inspection; not inference
- Root cause of ADMIN-03 bug: HIGH — `showCredentialsOverlay` code inspected; main.js payload confirmed correct
- Root cause of FIX-01 bug: HIGH — `admin-menu-action reload` case inspected; `mainWindow.webContents.reload()` confirmed

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable — no external APIs, all internal codebase)
