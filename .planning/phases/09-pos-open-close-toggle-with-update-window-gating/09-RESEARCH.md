# Phase 09: POS Open/Close Toggle with Update-Window Gating — Research

**Researched:** 2026-04-20
**Domain:** Electron IPC state management, electron-store persistence, updateGate extension, plain HTML/CSS admin menu and welcome layer rendering
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** New button "POS schliessen" / "POS offnen" placed AFTER "PIN andern" and BEFORE "Auto-Update einrichten" in the admin button stack.
- **D-02:** When `posOpen=true`: button label "POS schliessen" (yellow styling). Tapping opens a branded confirm overlay with "POS wirklich schliessen? Mitglieder sehen einen geschlossen-Hinweis." and Ja/Abbrechen buttons.
- **D-03:** When `posOpen=false`: button label "POS offnen" (green styling). Tapping sets `posOpen=true` immediately with NO confirmation modal.
- **D-04:** Audit log: `pos.state-changed open=true|false reason=admin` emitted on every toggle.
- **D-05:** Closed welcome screen reuses existing branded dark background + Bee Strong logo + card layout. Replace CTA text with "POS derzeit geschlossen" heading and "Bitte Studio-Personal verstandigen" subtext. No tap handler fires. No extra status info.
- **D-06:** Closed state takes effect after current session ends. Active Magicline sessions continue undisturbed.
- **D-07:** DI getter pattern: `getPosOpen` function added to `onUpdateDownloaded` opts object, same pattern as existing `getHour` test hook.
- **D-08:** New trigger `admin-closed-window` requires ONLY `posOpen=false` + time within 09:00-12:00. Does NOT require post-reset.
- **D-09:** Existing `post-reset` and `maintenance-window` triggers remain as fall-throughs with first-trigger-wins. `admin-closed-window` check runs in the same polling interval.
- **D-10:** Audit log: `update.install trigger=admin-closed-window posOpen=false hour=N` when new trigger fires.
- **D-11:** `posOpen` persists in electron-store across restarts. Default `true`. No auto-reopen.
- **D-12:** IPC `admin-menu-action` case `'toggle-pos-open'` — main.js reads current `posOpen`, flips it, writes to electron-store, broadcasts `pos-state-changed` to host, emits audit log.
- **D-13:** IPC `pos-state-changed` (main → host) — sent on app startup AND on toggle.

### Claude's Discretion

- Exact CSS for yellow "POS schliessen" and green "POS offnen" button variants.
- Whether the confirm overlay is a new `#pos-close-confirm` div or reuses a generic confirm pattern.
- Whether `getPosOpen` reads store synchronously (electron-store is sync) or wraps in a function for consistency.
- Admin diagnostics header: whether to show current posOpen state (low priority, nice-to-have).

### Deferred Ideas (OUT OF SCOPE)

- Cash-register banner for `posOpen=false` mid-session.
- Auto-reopen after N hours.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-02 | Admin-controlled POS open/close toggle gates auto-update installation. New `posOpen` boolean, admin menu button (yellow+confirm when closing, green+no confirm when opening), welcome closed-state with tap suppressed, `admin-closed-window` updateGate trigger. | Fully supported — all integration points identified in existing source code. |
</phase_requirements>

---

## Summary

Phase 09 adds a single feature: an admin-controlled `posOpen` boolean that (1) gates the welcome layer between interactive and informational-only modes and (2) adds a new `admin-closed-window` trigger to the existing `updateGate.js` safe-install logic.

The implementation touches seven files across main-process and host-renderer. Every integration point has a verified precedent in the codebase. The `updateGate.js` module is already architected for DI opts extension — `getPosOpen` slots in identically to `getHour`. The admin menu button stack, confirm overlay pattern, IPC channel patterns, and welcome layer rendering all have direct prior-phase counterparts to follow.

The only new CSS classes needed are `.bsk-btn--admin-action--caution` (yellow variant) and `.bsk-btn--admin-action--safe` (green variant), plus `.bsk-welcome-subtext`. The confirm overlay can be an inline card within the existing admin layer at z-400 — no new layer needed.

**Primary recommendation:** Follow the DI pattern exactly as the existing `getHour` opt, add the `admin-closed-window` check directly inside the existing `maintenanceTimer` polling interval (not a second timer), and send `pos-state-changed` both on startup and on toggle.

---

## Standard Stack

### Core (no new packages needed)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `electron-store` | `^10.1.0` (already installed) | Persisting `posOpen` boolean | [VERIFIED: package.json] |
| `electron` IPC (`ipcMain`/`ipcRenderer`) | ~41.1.1 (already in use) | `pos-state-changed` broadcast, `toggle-pos-open` action | [VERIFIED: preload.js, main.js] |
| Node.js built-in | — | No new dependencies | [VERIFIED: package.json] |

**No new npm packages are required for Phase 09.** [VERIFIED: package.json — all required primitives already present]

---

## Architecture Patterns

### Recommended Project Structure (no new files needed)

All Phase 09 work modifies existing files. No new source files. The single new test area is an extension of an existing test file.

```
src/main/
  updateGate.js    — add getPosOpen opt + admin-closed-window trigger
  main.js          — add toggle-pos-open case, armUpdateGate getPosOpen, startup broadcast
  preload.js       — add onPosStateChanged channel

src/host/
  host.html        — add #admin-btn-pos-toggle button, #pos-close-confirm overlay, .bsk-welcome-subtext p
  host.css         — add .bsk-btn--admin-action--caution, .bsk-btn--admin-action--safe, .bsk-welcome-subtext
  host.js          — add toggle handler, confirm overlay logic, welcome closed-state, pos-state-changed subscriber

test/
  updateGate.test.js — extend with getPosOpen mock + 4 new test cases
```

### Pattern 1: DI Getter Extension to updateGate.onUpdateDownloaded

**What:** Add `getPosOpen` as an optional function parameter alongside the existing `getHour` optional param. Read it inside the existing `maintenanceTimer` polling interval — no new timer.

**When to use:** Exactly this pattern for all testable state queries in updateGate.

**Existing structure (verified):**
```javascript
// Source: src/main/updateGate.js lines 43-91 [VERIFIED]
function onUpdateDownloaded(opts) {
  const { installFn, log, sessionResetModule, getHour } = opts;
  // ...
  maintenanceTimer = setInterval(() => {
    if (isMaintenanceWindow(getHour)) {
      fireWith('maintenance-window');
    }
  }, MAINTENANCE_POLL_MS);
  // ...
}
```

**Phase 09 extension pattern:**
```javascript
// Extend opts destructuring
const { installFn, log, sessionResetModule, getHour, getPosOpen } = opts;

// In the existing maintenanceTimer interval:
maintenanceTimer = setInterval(() => {
  // Check admin-closed-window FIRST (higher priority signal)
  if (typeof getPosOpen === 'function' && getPosOpen() === false && isMaintenanceWindow(getHour)) {
    fireWith('admin-closed-window');
    return;
  }
  if (isMaintenanceWindow(getHour)) {
    fireWith('maintenance-window');
  }
}, MAINTENANCE_POLL_MS);
```

**Source of log format (verified):**
```javascript
// Existing audit call in fireWith() — src/main/updateGate.js line 71 [VERIFIED]
log.audit('update.install', { trigger: trigger });
// Phase 09 adds posOpen and hour fields via the trigger string or by extending
// the log.audit call. D-10 says: trigger=admin-closed-window posOpen=false hour=N
```

**Note on audit log fields for admin-closed-window:** The existing `fireWith(trigger)` only logs `{ trigger }`. To emit `posOpen=false hour=N` as required by D-10, `fireWith` needs to be updated or a new `fireWithExtra(trigger, extra)` pattern used. Simplest approach: pass extra fields into `fireWith` when the new trigger fires.

### Pattern 2: admin-menu-action Case for toggle-pos-open

**What:** Add a new `case 'toggle-pos-open':` in the existing `switch (action)` block in main.js.

**Existing switch location (verified):**
```javascript
// Source: src/main/main.js line 757-888 [VERIFIED]
ipcMain.handle('admin-menu-action', async (_e, payload) => {
  const action = payload && payload.action;
  // ...
  switch (action) {
    case 'check-updates': { ... }
    case 'view-logs': { ... }
    // ... all existing cases ...
    default:
      return { ok: false, error: 'unknown-action' };
  }
});
```

**Phase 09 toggle-pos-open case pattern:**
```javascript
case 'toggle-pos-open': {
  const current = store.get('posOpen', true);
  const next = !current;
  store.set('posOpen', next);
  log.audit('pos.state-changed', { open: next, reason: 'admin' });
  try {
    mainWindow.webContents.send('pos-state-changed', { posOpen: next });
  } catch (_) {}
  return { ok: true, posOpen: next };
}
```

**armUpdateGate extension (verified base):**
```javascript
// Source: src/main/main.js lines 144-154 [VERIFIED]
function armUpdateGate(store, info) {
  updateGate.onUpdateDownloaded({
    installFn: () => { ... },
    log: log,
    sessionResetModule: sessionResetMod,
    // Phase 09 adds:
    getPosOpen: () => store.get('posOpen', true),
  });
}
```

### Pattern 3: pos-state-changed Startup Broadcast

**What:** Send `pos-state-changed` on app startup so welcome layer renders the persisted state immediately.

**Existing startup sequence (verified):**
```javascript
// Source: src/main/main.js lines 541-555 [VERIFIED]
const showWelcomeOnColdBoot = () => {
  try {
    mainWindow.webContents.send('splash:hide');
    mainWindow.webContents.send('welcome:show');
    // Phase 09: send pos-state-changed AFTER welcome:show
    const posOpen = store.get('posOpen', true);
    mainWindow.webContents.send('pos-state-changed', { posOpen });
  } catch (err) { ... }
  runAutoUpdaterInit();
};
```

### Pattern 4: preload.js Channel Exposure

**What:** Expose `onPosStateChanged` following the exact pattern of existing main-to-renderer subscribers.

**Existing pattern (verified):**
```javascript
// Source: src/main/preload.js lines 50-61 [VERIFIED]
onShowAdminMenu:  (cb) => ipcRenderer.on('show-admin-menu',  (_e, payload) => cb(payload)),
// Phase 09 adds:
onPosStateChanged: (cb) => ipcRenderer.on('pos-state-changed', (_e, payload) => cb(payload)),
```

### Pattern 5: host.js Welcome Closed-State Rendering

**What:** On `pos-state-changed`, mutate the existing `#welcome-screen` element in place — change h1 text, add/remove subtext p, toggle pointer-events and cursor, update aria attributes.

**Welcome layer DOM (verified from host.html lines 39-48):**
```html
<!-- Source: src/host/host.html lines 39-48 [VERIFIED] -->
<div id="welcome-screen"
     class="bsk-layer bsk-layer--welcome"
     style="display:none;"
     aria-hidden="true"
     role="button"
     tabindex="0"
     aria-label="Zum Kassieren tippen">
  <img src="assets/logo-dark.png" class="bsk-logo" alt="Bee Strong Fitness" width="260">
  <h1 class="bsk-welcome-title">Zum Kassieren tippen</h1>
</div>
```

**Phase 09 host.js rendering function pattern:**
```javascript
// Source pattern: showMagiclineError() variant switching in host.js lines 134-213 [VERIFIED]
function applyPosState(posOpen) {
  var el = document.getElementById('welcome-screen');
  if (!el) return;
  var h1 = el.querySelector('.bsk-welcome-title');
  var sub = el.querySelector('.bsk-welcome-subtext');
  if (posOpen) {
    // Restore open state
    if (h1) h1.textContent = 'Zum Kassieren tippen';
    if (sub) sub.remove();
    el.style.pointerEvents = '';
    el.style.cursor = '';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Zum Kassieren tippen');
  } else {
    // Apply closed state
    if (h1) h1.textContent = 'POS derzeit geschlossen';
    if (!sub) {
      sub = document.createElement('p');
      sub.className = 'bsk-welcome-subtext';
      el.appendChild(sub);
    }
    sub.textContent = 'Bitte Studio-Personal verst\u00e4ndigen';
    el.style.pointerEvents = 'none';
    el.style.cursor = 'default';
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.setAttribute('aria-label', 'POS geschlossen');
  }
}
```

**Tap suppression:** `pointer-events: none` on `#welcome-screen` prevents `handleWelcomeTap` from firing — the existing `pointerdown` / `touchstart` handlers in `wireStatic()` simply never receive events. [VERIFIED: host.css .bsk-layer--welcome has `pointer-events: auto` by default; inline style overrides it]

### Pattern 6: Confirm Overlay (#pos-close-confirm)

**What:** Inline card within the admin layer, shown when admin taps "POS schliessen". Dismisses without state change on "Abbrechen" or on any admin-menu-close path.

**Reference pattern (verified):** Phase 08 PIN change overlay uses the same inline card approach at z-400 (sibling `.bsk-layer--credentials` div), proven to work. The confirm overlay for POS close can be simpler — either a sibling div at z-400 (same pattern as `#pin-change-overlay`) or an absolutely positioned card within the admin layer card itself.

**Simplest approach (inline within admin layer — no new z-index layer):**
```html
<!-- Insert inside .bsk-card--admin, hidden by default -->
<div id="pos-close-confirm"
     style="display:none;"
     role="dialog"
     aria-label="POS schlie&szlig;en best&auml;tigen">
  <h3 class="bsk-card-title">POS wirklich schliessen?</h3>
  <p><!-- body text --></p>
  <button type="button" id="pos-confirm-yes" class="bsk-btn bsk-btn--primary">Ja, schliessen</button>
  <button type="button" id="pos-confirm-cancel" class="bsk-btn">Abbrechen</button>
</div>
```

The UI-SPEC also permits a sibling `bsk-layer--credentials` div at z-400 — this is slightly cleaner for z-index isolation (consistent with `#pin-change-overlay`). Either approach is valid per D-02 and UI-SPEC.

### Pattern 7: Admin Button Stack Insertion

**What:** Insert `#admin-btn-pos-toggle` between `#admin-btn-pin-change` and `#admin-btn-update-config` in host.html.

**Verified current order (host.html lines 189-196):**
```
1. admin-btn-check-updates
2. admin-btn-logs
3. admin-btn-reload
4. admin-btn-credentials
5. admin-btn-pin-change
   [INSERT HERE: admin-btn-pos-toggle]
6. admin-btn-update-config
7. admin-btn-dev-mode
8. admin-btn-exit
```

**Initial HTML:** Button starts as `bsk-btn--admin-action--caution` (yellow, "POS schliessen") because default `posOpen=true`. The `showAdminMenu()` / `renderDiagnostics()` function updates the label and class based on `posOpen` value from `buildAdminDiagnostics(store)`.

**buildAdminDiagnostics must include posOpen:** The diagnostics object passed to `show-admin-menu` IPC needs `posOpen: store.get('posOpen', true)` so host.js can render the correct initial button state on admin menu open.

### Anti-Patterns to Avoid

- **Do NOT add a second `setInterval` for the admin-closed-window check.** The existing `MAINTENANCE_POLL_MS = 60_000` interval in updateGate.js is the right polling cadence. Add the `getPosOpen()` check inside the existing interval callback. [VERIFIED: updateGate.js lines 79-83]
- **Do NOT send `pos-state-changed` from inside `toggle-pos-open` case before writing to store.** Write store first, then broadcast. Prevents race where host renders new state before store persists.
- **Do NOT use `posOpen=true` as the only welcome:tap guard.** The welcome:tap suppression must be in the host.js rendering layer (pointer-events), not in main.js. Main.js has no way to know if a tap occurred before or after the IPC round-trip.
- **Do NOT rely on `adminMenuOpen` flag for the toggle-pos-open case validation.** The existing `if (!adminMenuOpen)` guard at the top of the `admin-menu-action` handler already provides this protection. [VERIFIED: main.js line 759]
- **Do NOT add `toggle-pos-open` to the existing `wireAdminButtons()` handlers map for simple action dispatch.** The button has two states (open vs. closed) and the close action needs a confirm overlay — it needs special handling, not a direct `adminMenuAction('toggle-pos-open')` call. The "POS offnen" direction CAN use direct dispatch; the "POS schliessen" direction must show the confirm overlay first in host.js, only invoking `adminMenuAction('toggle-pos-open')` after confirm.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persistent boolean state | Custom file write | `electron-store` `store.set('posOpen', value)` | Already in use throughout the project; atomic writes, schema validation available |
| IPC main→renderer broadcast | `webContents.executeJavaScript` | `mainWindow.webContents.send('pos-state-changed', payload)` | Already the project's established IPC pattern |
| DI test hooks in updateGate | Module-level mutable flag | Opts getter function `getPosOpen: () => store.get('posOpen', true)` | Existing `getHour` pattern is proven testable |
| Polling for gate condition | Second setInterval | Extend existing `maintenanceTimer` interval | Only one polling loop needed; first-trigger-wins logic already handles multiple checks |

---

## Common Pitfalls

### Pitfall 1: posOpen state mismatch on admin menu open
**What goes wrong:** Admin opens menu. Logs show `posOpen=false` but button still shows "POS schliessen" (yellow).
**Why it happens:** `buildAdminDiagnostics(store)` does not include `posOpen`, so `renderDiagnostics()` in host.js cannot update the button label/class.
**How to avoid:** Add `posOpen: store.get('posOpen', true)` to `buildAdminDiagnostics()` return value. In `renderDiagnostics()` (host.js), update `#admin-btn-pos-toggle` label and class based on `d.posOpen`.
**Warning signs:** Button label inconsistent with actual welcome layer state after kiosk restart.

### Pitfall 2: Welcome layer shows closed state on first cold boot
**What goes wrong:** `pos-state-changed` sent before `welcome:show`, or not sent at all on cold boot. Welcome renders open state even though `posOpen=false` was persisted.
**Why it happens:** `showWelcomeOnColdBoot` sends `welcome:show` and then the `pos-state-changed` must follow. If order is reversed or omitted, the layer renders its default (open) state.
**How to avoid:** Send `pos-state-changed` AFTER `welcome:show` in `showWelcomeOnColdBoot`. Also send after welcome-mode `hardReset` in `sessionReset.js`'s post-reset flow — or handle it in the `onShowWelcome` subscriber in host.js.
**Warning signs:** After kiosk restart with `posOpen=false`, welcome briefly shows "Zum Kassieren tippen" then jumps to closed state (or stays wrong until next toggle).

**Cleaner approach:** In host.js, subscribe to `onShowWelcome` and also re-apply pos state from a module-level `posOpen` variable that was set by the last `pos-state-changed` received. This way welcome always renders the correct state regardless of when `pos-state-changed` was last sent.

### Pitfall 3: Confirm overlay leaks state across admin menu open/close cycles
**What goes wrong:** Admin opens confirm overlay, then closes admin menu (Esc or X button) without confirming. On next admin menu open, the confirm overlay is still visible.
**Why it happens:** `hideAdminMenu()` in host.js only hides `#admin-menu` and `#admin-update-result`. It does not hide `#pos-close-confirm` if that's a sibling div inside the admin layer.
**How to avoid:** In `hideAdminMenu()` in host.js, also hide `#pos-close-confirm`. Alternatively, the admin menu close path (main.js `closeAdminMenu()` → `hide-admin-menu` IPC) triggers `hideAdminMenu()`, so put the cleanup there.
**Warning signs:** Confirm overlay visible when admin menu reopens.

### Pitfall 4: audit log for admin-closed-window missing posOpen/hour fields
**What goes wrong:** Log shows `update.install trigger=admin-closed-window` but without `posOpen=false hour=N` (D-10 requirement).
**Why it happens:** Existing `fireWith(trigger)` only calls `log.audit('update.install', { trigger: trigger })` — no extra fields.
**How to avoid:** Either extend `fireWith` to accept extra fields `fireWith(trigger, extra)` and merge into the audit call, or add a special case in the `admin-closed-window` log path. The cleanest approach is `log.audit('update.install', { trigger, posOpen: false, hour: (typeof getHour === 'function' ? getHour() : new Date().getHours()) })`.
**Warning signs:** Log parsing for `posOpen=false hour=N` fields returns no results after trigger fires.

### Pitfall 5: welcome:tap fires despite pointer-events:none when element has children with pointer-events:auto
**What goes wrong:** A child element of `#welcome-screen` has `pointer-events: auto` (or inherits it from a CSS rule), so taps on that child still bubble up through a non-none path.
**Why it happens:** CSS `pointer-events: none` on a parent does not suppress events on children that have been explicitly re-enabled via CSS.
**How to avoid:** In `applyPosState(false)`, verify no child elements (logo, h1, subtext p) have CSS rules that re-enable pointer-events. In the current codebase, `.bsk-logo`, `.bsk-welcome-title`, and the new `.bsk-welcome-subtext` have no pointer-events overrides. [VERIFIED: host.css — no pointer-events override on these elements]

### Pitfall 6: updateGate admin-closed-window fires immediately after arm if posOpen=false at arm time
**What goes wrong:** An update is downloaded while `posOpen=false` AND hour is 10. The `maintenanceTimer` interval arms. On the FIRST tick (60 seconds later), `admin-closed-window` fires. This is correct behavior — but if `armUpdateGate` is called during a time when `posOpen=false` AND already inside the maintenance window, the first tick fires within 60 seconds, not immediately.
**Why it happens:** The existing gate design intentionally waits for the first interval tick rather than checking immediately on arm. This is the same behavior as `maintenance-window`.
**How to avoid:** This is NOT a bug — it is intentional and consistent. Document: the `admin-closed-window` trigger fires on the next 60-second tick after the gate is armed, not immediately. This matches D-08 and D-09.

---

## Code Examples

### updateGate.js — Complete Admin-Closed-Window Extension

```javascript
// Source: src/main/updateGate.js — Phase 09 extension [VERIFIED base, ASSUMED extension pattern]

function onUpdateDownloaded(opts) {
  // ... existing validation unchanged ...
  const { installFn, log, sessionResetModule, getHour, getPosOpen } = opts;

  // ... existing fireWith() unchanged, but extend to support extra fields:
  function fireWith(trigger, extra) {
    if (fired) return;
    fired = true;
    clearGate();
    try { sessionResetModule.onPostReset(null); } catch (_) {}
    var fields = Object.assign({ trigger: trigger }, extra || {});
    log.audit('update.install', fields);
    try {
      installFn();
    } catch (e) {
      if (log.error) log.error('updateGate.installFn-threw: ' + (e && e.message));
    }
  }

  // Existing maintenance-window polling interval — extend with admin-closed-window check
  maintenanceTimer = setInterval(() => {
    var inWindow = isMaintenanceWindow(getHour);
    // D-08: admin-closed-window fires when posOpen=false AND in window
    if (typeof getPosOpen === 'function' && getPosOpen() === false && inWindow) {
      var hour = typeof getHour === 'function' ? getHour() : new Date().getHours();
      fireWith('admin-closed-window', { posOpen: false, hour: hour });
      return;
    }
    // D-09: maintenance-window falls through regardless of posOpen
    if (inWindow) {
      fireWith('maintenance-window');
    }
  }, MAINTENANCE_POLL_MS);

  // ... existing post-reset arm unchanged ...
}
```

### host.js — pos-state-changed IPC subscriber wiring

```javascript
// Source: follows pattern at src/host/host.js lines 954-1022 [VERIFIED]
// Add to the IPC subscriptions block:
if (window.kiosk && window.kiosk.onPosStateChanged) {
  window.kiosk.onPosStateChanged(function (payload) {
    var posOpen = !!(payload && payload.posOpen !== false);
    applyPosState(posOpen);
    updatePosToggleButton(posOpen);
  });
}
```

### host.js — updatePosToggleButton helper

```javascript
// Call from showAdminMenu(diagnostics) and from onPosStateChanged handler
function updatePosToggleButton(posOpen) {
  var btn = document.getElementById('admin-btn-pos-toggle');
  if (!btn) return;
  if (posOpen) {
    btn.textContent = 'POS schliessen';
    btn.classList.remove('bsk-btn--admin-action--safe');
    btn.classList.add('bsk-btn--admin-action--caution');
    btn.setAttribute('aria-label', 'POS schliessen \u2014 Best\u00e4tigung erforderlich');
  } else {
    btn.textContent = 'POS \u00f6ffnen';
    btn.classList.remove('bsk-btn--admin-action--caution');
    btn.classList.add('bsk-btn--admin-action--safe');
    btn.setAttribute('aria-label', 'POS \u00f6ffnen');
  }
}
```

### test/updateGate.test.js — New Test Cases Pattern

```javascript
// Source: follows makeLog/makeSessionReset pattern at lines 12-28 [VERIFIED]

function makeGetPosOpen(value) {
  return () => value;
}

test('admin-closed-window: posOpen=false in window fires trigger', () => {
  gate._resetForTests();
  // ... monkey-patch setInterval as in existing tests ...
  gate.onUpdateDownloaded({
    installFn: () => installed++,
    log, sessionResetModule: sr,
    getHour: () => 10,         // in window
    getPosOpen: makeGetPosOpen(false),  // POS closed
  });
  intervalFn();
  assert.strictEqual(installed, 1);
  const audit = log.calls.find(c => c.event === 'update.install');
  assert.strictEqual(audit.fields.trigger, 'admin-closed-window');
  assert.strictEqual(audit.fields.posOpen, false);
  assert.strictEqual(audit.fields.hour, 10);
});

test('admin-closed-window: posOpen=false out of window does NOT fire', () => {
  // getHour: () => 14, getPosOpen: () => false → no fire
});

test('admin-closed-window: posOpen=true in window falls through to maintenance-window', () => {
  // getHour: () => 10, getPosOpen: () => true → maintenance-window fires
});

test('admin-closed-window vs post-reset: first trigger wins', () => {
  // Both posOpen=false+in-window AND post-reset fire → only one installFn call
});
```

### CSS — New Button Variant Classes

```css
/* Source: follows .bsk-btn--admin-exit pattern at host.css lines 495-505 [VERIFIED] */

/* Phase 09 — "POS schliessen" caution variant (yellow) */
.bsk-btn--admin-action--caution {
  background: #F5C518;
  color: #1A1A1A;
  border-color: #F5C518;
}

.bsk-btn--admin-action--caution:active {
  background: #D9AD10;
}

/* Phase 09 — "POS offnen" safe variant (green) */
.bsk-btn--admin-action--safe {
  background: #4CAF50;
  color: #1A1A1A;
  border-color: #4CAF50;
}

.bsk-btn--admin-action--safe:active {
  background: #3D8B40;
}

/* Phase 09 — welcome closed-state subtext */
.bsk-welcome-subtext {
  font-size: 16px;
  font-weight: 400;
  color: #9CA3AF;
  text-align: center;
  margin: 8px 0 0 0;
  line-height: 1.5;
  max-width: 80vw;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded 03:00-05:00 window | 09:00-12:00 | Quick 260414-iiv (0.1.3) shipped | Already in codebase — no change needed |
| No posOpen gate | `admin-closed-window` trigger | Phase 09 | New update path |

**Nothing deprecated.** The existing `post-reset` and `maintenance-window` triggers remain as-is.

---

## Integration Point Map

Every file that must change and the exact location of each change:

### `src/main/updateGate.js`
- `onUpdateDownloaded`: destructure `getPosOpen` from opts
- `fireWith`: accept optional `extra` fields, merge into audit call
- `maintenanceTimer` interval: add `admin-closed-window` check before `maintenance-window`

### `src/main/main.js`
- `buildAdminDiagnostics(store)`: add `posOpen: store.get('posOpen', true)` to return object
- `armUpdateGate(store, info)`: add `getPosOpen: () => store.get('posOpen', true)` to opts
- `showWelcomeOnColdBoot`: send `pos-state-changed` with persisted posOpen AFTER `welcome:show`
- `admin-menu-action` switch: add `case 'toggle-pos-open'` — flip, write store, broadcast, audit log

### `src/main/preload.js`
- Add `onPosStateChanged: (cb) => ipcRenderer.on('pos-state-changed', (_e, payload) => cb(payload))`

### `src/host/host.html`
- `#admin-menu` `.bsk-admin-btns`: insert `#admin-btn-pos-toggle` between `#admin-btn-pin-change` and `#admin-btn-update-config`
- Add `#pos-close-confirm` div (inside `.bsk-card--admin` or as a sibling layer at z-400)
- `#welcome-screen`: no structural change needed — `applyPosState()` mutates DOM dynamically
- `#admin-menu` `.bsk-admin-diagnostics`: add POS-Status diag row (optional, Claude's discretion)

### `src/host/host.css`
- Add `.bsk-btn--admin-action--caution` (yellow)
- Add `.bsk-btn--admin-action--safe` (green)
- Add `.bsk-welcome-subtext`
- Add `#pos-close-confirm` styles if using inline-card approach

### `src/host/host.js`
- Add module-level `var posOpenState = true;` to track last known posOpen
- Add `applyPosState(posOpen)` function
- Add `updatePosToggleButton(posOpen)` function
- Extend `showAdminMenu(diagnostics)` / `renderDiagnostics(d)` to call `updatePosToggleButton(d.posOpen)`
- Extend `hideAdminMenu()` to also hide `#pos-close-confirm`
- Add `#admin-btn-pos-toggle` click handler (show confirm if posOpen=true, dispatch immediately if posOpen=false)
- Add `#pos-confirm-yes` and `#pos-confirm-cancel` click handlers
- Add Esc key handler guard for `#pos-close-confirm` (same pattern as existing Esc guard for nested overlays in the `keydown` listener, line 1026-1041)
- Subscribe to `onPosStateChanged` IPC — call `applyPosState` + `updatePosToggleButton`
- Subscribe to `onShowWelcome` — re-apply `posOpenState` (ensures correct state on welcome-mode hard reset)

### `test/updateGate.test.js`
- Add `makeGetPosOpen(value)` helper
- Add 4 new test cases:
  1. `posOpen=false` + in-window → `admin-closed-window` fires with `posOpen` and `hour` fields
  2. `posOpen=false` + out-of-window → no fire
  3. `posOpen=true` + in-window → `maintenance-window` fires (unchanged path)
  4. First-trigger-wins: `admin-closed-window` vs `post-reset`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fireWith` can be extended with an optional `extra` parameter without breaking existing callers (all existing calls pass no second arg) | Code Examples | Low — JS is tolerant of extra function args; existing 9 tests all pass single-argument calls |
| A2 | `posOpen` default `true` when key absent from store (`store.get('posOpen', true)`) is the correct default for a fresh install | Architecture Patterns | Low — D-11 explicitly states default is `true`; electron-store `get(key, default)` is the correct API |

**All other claims were verified directly from the source files read in this session.**

---

## Open Questions

1. **`#pos-close-confirm` as inline card vs. sibling z-400 layer**
   - What we know: Both approaches are valid per UI-SPEC. The inline-in-admin-card approach avoids a new sibling div. The sibling-layer approach is consistent with `#pin-change-overlay`.
   - What's unclear: Whether the inline approach causes z-index stacking issues on some browsers/Electron versions.
   - Recommendation: Use sibling layer approach (matching `#pin-change-overlay`) for consistency. Simpler CSS, no absolute-positioning inside admin card.

2. **When posOpen=false is set mid-session, welcome layer shows closed on next welcome cycle**
   - What we know: D-06 says active sessions continue undisturbed; closed state renders on next welcome cycle.
   - What's unclear: The `onShowWelcome` IPC fires when the welcome layer is shown. If host.js subscribes to `onShowWelcome` and re-applies the last known `posOpenState`, closed rendering is guaranteed on next welcome.
   - Recommendation: In host.js `onShowWelcome` subscriber, always call `applyPosState(posOpenState)` where `posOpenState` is the module-level variable updated by `onPosStateChanged`. This makes the pattern self-healing regardless of IPC timing.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 09 is entirely code and config changes within the existing Electron/Node environment. No new external tools, runtimes, databases, or CLIs are required beyond what is already installed and verified.

---

## Security Domain

Phase 09 introduces no new authentication, session management, cryptographic, or privileged operations. The `posOpen` boolean is non-sensitive operational state (not a credential or secret). The `toggle-pos-open` action is already gated behind the existing `adminMenuOpen` guard (verified in main.js line 759), which requires a successful PIN verification to enter. No new ASVS categories are implicated beyond what the existing admin PIN flow already covers.

---

## Sources

### Primary (HIGH confidence — verified in session)
- `src/main/updateGate.js` — full module read, DI pattern, existing trigger logic, fireWith structure
- `src/main/main.js` — full module read, armUpdateGate, admin-menu-action switch, buildAdminDiagnostics, showWelcomeOnColdBoot
- `src/main/preload.js` — full module read, existing channel exposure patterns
- `src/host/host.html` — full file read, admin button stack, welcome layer structure, z-index ladder
- `src/host/host.css` — full file read, .bsk-btn--admin-action, .bsk-layer--welcome, .bsk-welcome-title, existing modifier patterns
- `src/host/host.js` — full file read, wireAdminButtons, renderDiagnostics, hideAdminMenu, welcome tap handler, IPC subscription block
- `test/updateGate.test.js` — full file read, makeLog/makeSessionReset helpers, existing test structure
- `.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` — locked decisions D-01 through D-13
- `.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-UI-SPEC.md` — approved UI design contract
- `package.json` — stack verification (no new packages needed)
- `.planning/config.json` — `nyquist_validation: false` confirmed

### Secondary (MEDIUM confidence)
- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md` — updateGate architecture decisions D-15/D-16/D-17
- `.planning/phases/08-admin-menu-polish-reload-fix/08-CONTEXT.md` — admin menu close button, button stack ordering
- `.planning/todos/pending/2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md` — source todo with test plan

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all primitives verified in project files
- Architecture patterns: HIGH — all extension points verified in source code; patterns follow direct precedents
- Pitfalls: HIGH — derived from code analysis of actual source files, not speculation
- Code examples: HIGH (base) / ASSUMED (extension) — base structures verified; Phase 09 additions follow verified patterns

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable — no external dependencies or fast-moving ecosystem concerns)
