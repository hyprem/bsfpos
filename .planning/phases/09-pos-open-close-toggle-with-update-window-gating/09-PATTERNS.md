# Phase 09: Patterns

**Extracted:** 2026-04-20
**Phase:** 09 — POS Open/Close Toggle with Update-Window Gating

This document maps every file Phase 09 touches to its closest existing analog in the codebase. Each section gives the exact code locations and excerpts an executor must follow.

---

## File Map

| File | Change Type | Role |
|------|-------------|------|
| `src/main/updateGate.js` | Extend existing module | Add `getPosOpen` DI opt; extend `fireWith` for extra fields; add `admin-closed-window` check inside existing interval |
| `src/main/main.js` | Extend existing module | Add `toggle-pos-open` case to switch; extend `buildAdminDiagnostics`; extend `armUpdateGate`; send `pos-state-changed` from `showWelcomeOnColdBoot` |
| `src/main/preload.js` | Add one line to existing `contextBridge.exposeInMainWorld` object | Expose `onPosStateChanged` channel |
| `src/host/host.html` | Insert HTML nodes | Insert toggle button in `.bsk-admin-btns`; insert `#pos-close-confirm` sibling layer; add `#pos-close-confirm` z-index to ladder comment |
| `src/host/host.css` | Append new rules | Yellow caution variant, green safe variant, `.bsk-welcome-subtext` |
| `src/host/host.js` | Add functions + extend wiring | `applyPosState`, `updatePosToggleButton`, button handler, confirm overlay logic, extend `hideAdminMenu`, extend `wireStatic`, subscribe to `onPosStateChanged`, re-apply on `onShowWelcome` |
| `test/updateGate.test.js` | Add test cases | `makeGetPosOpen` helper + 4 new test cases |

---

## 1. `src/main/updateGate.js`

### Role
Pure Node module, no Electron coupling. Accepts all external dependencies via the `opts` object to `onUpdateDownloaded`. Adding `getPosOpen` follows the identical pattern as the existing `getHour` test hook.

### Analog: existing `getHour` DI opt (lines 59, 79–83)

```javascript
// EXISTING — lines 43–91
function onUpdateDownloaded(opts) {
  // ...
  const { installFn, log, sessionResetModule, getHour } = opts;  // line 59

  function fireWith(trigger) {                                    // line 63
    if (fired) return;
    fired = true;
    clearGate();
    try { sessionResetModule.onPostReset(null); } catch (_) { /* ignore */ }
    log.audit('update.install', { trigger: trigger });            // line 70 — only { trigger } today
    try {
      installFn();
    } catch (e) {
      if (log.error) log.error('updateGate.installFn-threw: ' + (e && e.message));
    }
  }

  // Arm (a): maintenance-window polling
  maintenanceTimer = setInterval(() => {
    if (isMaintenanceWindow(getHour)) {                           // line 80
      fireWith('maintenance-window');
    }
  }, MAINTENANCE_POLL_MS);                                        // line 83
}
```

### What Phase 09 adds

**1a. Destructure `getPosOpen` from opts** (same line as `getHour`):

```javascript
const { installFn, log, sessionResetModule, getHour, getPosOpen } = opts;
```

**1b. Extend `fireWith` to accept optional extra fields** (D-10 requires `posOpen` and `hour` in the audit log):

```javascript
function fireWith(trigger, extra) {
  if (fired) return;
  fired = true;
  clearGate();
  try { sessionResetModule.onPostReset(null); } catch (_) { /* ignore */ }
  var fields = Object.assign({ trigger: trigger }, extra || {});
  log.audit('update.install', fields);
  try {
    installFn();
  } catch (e) {
    if (log.error) log.error('updateGate.installFn-threw: ' + (e && e.message));
  }
}
```

All existing `fireWith('post-reset')` and `fireWith('maintenance-window')` calls pass no second argument — `Object.assign` with `undefined` is safe.

**1c. Add `admin-closed-window` check BEFORE `maintenance-window` in the existing `maintenanceTimer` interval:**

```javascript
maintenanceTimer = setInterval(() => {
  var inWindow = isMaintenanceWindow(getHour);
  // D-08: admin-closed-window fires when posOpen=false AND in maintenance window
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
```

**Key rules:**
- Do NOT add a second `setInterval`. The existing interval is the right cadence.
- `typeof getPosOpen === 'function'` guard is required — `getPosOpen` is optional (not present in existing callers or tests that pre-date Phase 09).
- `admin-closed-window` check runs first (first-trigger-wins, D-09).
- `return` after `fireWith` prevents falling through to the `maintenance-window` check in the same tick.

---

## 2. `src/main/main.js`

### 2a. `buildAdminDiagnostics(store)` — add `posOpen` field

**Analog:** existing fields pattern (lines 205–224):

```javascript
// EXISTING
function buildAdminDiagnostics(store) {
  // ...
  return {
    version: app.getVersion(),
    lastUpdateCheck: autoUpdater.getLastCheckAt(),
    authState: authState,
    lastResetAt: lastResetAt,
    updateStatus: updateStatus,
    patConfigured: !!store.get('githubUpdatePat'),
  };
}
```

**Phase 09 addition** — append to the return object:

```javascript
posOpen: store.get('posOpen', true),
```

This is the value `renderDiagnostics(d)` in host.js uses to set the button label/class when the admin menu opens.

### 2b. `armUpdateGate(store, info)` — add `getPosOpen` opt

**Analog:** existing `armUpdateGate` (lines 144–154):

```javascript
// EXISTING
function armUpdateGate(store, info) {
  updateGate.onUpdateDownloaded({
    installFn: () => {
      log.audit('update.install', { phase: 'quitAndInstall', version: (info && info.version) || 'unknown' });
      try { if (mainWindow) mainWindow.webContents.send('show-updating-cover'); } catch (_) {}
      autoUpdater.installUpdate();
    },
    log: log,
    sessionResetModule: sessionResetMod,
  });
}
```

**Phase 09 addition** — add `getPosOpen` to the opts object (after `sessionResetModule`):

```javascript
getPosOpen: () => store.get('posOpen', true),
```

`electron-store` `get` is synchronous. The getter wrapper is needed so `updateGate.js` can call it at interval tick time (not at arm time), picking up the current value even if admin toggled POS state after the update was downloaded.

### 2c. `showWelcomeOnColdBoot` — send `pos-state-changed` after `welcome:show`

**Analog:** existing sends in `showWelcomeOnColdBoot` (lines 541–555):

```javascript
// EXISTING
const showWelcomeOnColdBoot = () => {
  try {
    mainWindow.webContents.send('splash:hide');
    mainWindow.webContents.send('welcome:show');
    log.info('phase6.cold-boot.welcome-shown');
  } catch (err) {
    log.error('phase6.cold-boot.welcome:show failed: ' + (err && err.message));
  }
  runAutoUpdaterInit();
};
```

**Phase 09 addition** — send `pos-state-changed` AFTER `welcome:show` (D-13):

```javascript
const showWelcomeOnColdBoot = () => {
  try {
    mainWindow.webContents.send('splash:hide');
    mainWindow.webContents.send('welcome:show');
    const posOpen = store.get('posOpen', true);
    mainWindow.webContents.send('pos-state-changed', { posOpen: posOpen });
    log.info('phase6.cold-boot.welcome-shown posOpen=' + posOpen);
  } catch (err) {
    log.error('phase6.cold-boot.welcome:show failed: ' + (err && err.message));
  }
  runAutoUpdaterInit();
};
```

### 2d. `admin-menu-action` switch — add `toggle-pos-open` case

**Analog:** existing `case 'toggle-dev-mode':` (lines 848–871), which similarly reads state, flips, writes, notifies renderer:

```javascript
// EXISTING pattern to follow
case 'toggle-dev-mode': {
  devModeActive = !devModeActive;
  log.info('admin.dev-mode: ' + (devModeActive ? 'ON' : 'OFF'));
  // ... state application ...
  try {
    mainWindow.webContents.send('dev-mode-changed', { active: devModeActive });
  } catch (_) {}
  adminMenuOpen = false;
  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
  return { ok: true, devMode: devModeActive };
}
```

**Phase 09 `toggle-pos-open` case** — insert AFTER `case 'pin-change':` and BEFORE `case 'configure-auto-update':` (D-01 ordering):

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

**Note:** Unlike `toggle-dev-mode`, this case does NOT close the admin menu — host.js handles the confirm overlay and only calls `adminMenuAction('toggle-pos-open')` after the admin confirms (or immediately for the open direction). The admin menu stays open after the toggle so admin can see the updated button label.

---

## 3. `src/main/preload.js`

### Role
Exposes a minimal, audited IPC surface via `contextBridge`. Each main→renderer channel is a one-liner subscriber.

### Analog: existing subscriber lines (lines 50–58)

```javascript
// EXISTING pattern (lines 50–58)
onShowAdminMenu:     (cb) => ipcRenderer.on('show-admin-menu',      (_e, payload) => cb(payload)),
onHideAdminMenu:     (cb) => ipcRenderer.on('hide-admin-menu',      () => cb()),
onShowUpdateConfig:  (cb) => ipcRenderer.on('show-update-config',   (_e, payload) => cb(payload)),
// ...
onDevModeChanged:    (cb) => ipcRenderer.on('dev-mode-changed', (_e, payload) => cb(payload)),
```

```javascript
// Phase 08 — same pattern (lines 80–83)
onShowPinChangeOverlay: (cb) => ipcRenderer.on('show-pin-change-overlay', () => cb()),
onHidePinChangeOverlay: (cb) => ipcRenderer.on('hide-pin-change-overlay', () => cb()),
```

### What Phase 09 adds

Append after the Phase 08 block, before the closing `}`):

```javascript
// Phase 09 — POS state
onPosStateChanged: (cb) => ipcRenderer.on('pos-state-changed', (_e, payload) => cb(payload)),
```

---

## 4. `src/host/host.html`

### 4a. Admin button stack — insert `#admin-btn-pos-toggle`

**Analog:** existing button block (lines 188–197):

```html
<!-- EXISTING — lines 188–197 -->
<div class="bsk-admin-btns">
  <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-check-updates">Updates pr&uuml;fen</button>
  <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-logs">Protokolle anzeigen</button>
  <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-reload">Kasse nachladen</button>
  <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-credentials">Anmeldedaten &auml;ndern</button>
  <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-pin-change">PIN &auml;ndern</button>
                                                           <!-- INSERT HERE -->
  <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-update-config">Auto-Update einrichten</button>
  <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-dev-mode">Dev-Modus</button>
  <button type="button" class="bsk-btn bsk-btn--admin-action bsk-btn--admin-exit" id="admin-btn-exit">Beenden</button>
</div>
```

**Phase 09 insertion** after `#admin-btn-pin-change`:

```html
<button type="button"
        class="bsk-btn bsk-btn--admin-action bsk-btn--admin-action--caution"
        id="admin-btn-pos-toggle"
        aria-label="POS schliessen &mdash; Best&auml;tigung erforderlich">POS schliessen</button>
```

Initial class is `--caution` (yellow) because default `posOpen=true` (D-02). `renderDiagnostics` updates label/class on admin menu open if `posOpen=false`.

### 4b. `#pos-close-confirm` sibling layer (z-400)

**Analog:** `#pin-change-overlay` (lines 202–228), which is a `bsk-layer bsk-layer--credentials` sibling of `#admin-menu` at z-400:

```html
<!-- EXISTING — lines 202–228 (pattern to follow) -->
<div id="pin-change-overlay"
     class="bsk-layer bsk-layer--credentials"
     style="display:none;"
     aria-hidden="true"
     role="dialog"
     aria-label="PIN &auml;ndern">
  <div class="bsk-card">
    ...
    <button type="button" id="pin-change-save" class="bsk-btn bsk-btn--primary" disabled>Speichern</button>
    <button type="button" id="pin-change-cancel" class="bsk-btn">Abbrechen</button>
  </div>
</div>
```

**Phase 09 `#pos-close-confirm`** — place after `#pin-change-overlay`, before `#update-config`:

```html
<!-- Phase 09: POS close confirm overlay (layer 400, sibling of #pin-change-overlay) -->
<div id="pos-close-confirm"
     class="bsk-layer bsk-layer--credentials"
     style="display:none;"
     aria-hidden="true"
     role="dialog"
     aria-label="POS schlie&szlig;en best&auml;tigen">
  <div class="bsk-card">
    <img src="assets/logo-dark.png" class="bsk-logo" alt="Bee Strong Fitness" width="160">
    <h2 class="bsk-card-title">POS schliessen?</h2>
    <p class="bsk-update-config-hint">Mitglieder sehen einen Geschlossen-Hinweis.</p>
    <button type="button" id="pos-confirm-yes" class="bsk-btn bsk-btn--primary">Ja, schliessen</button>
    <button type="button" id="pos-confirm-cancel" class="bsk-btn">Abbrechen</button>
  </div>
</div>
```

**Z-index ladder comment** (line 19 area) — add entry:

```
400 — #pos-close-confirm — Phase 09 POS close confirm (mutually exclusive with #pin-change-overlay, #credentials-overlay)
```

---

## 5. `src/host/host.css`

### 5a. Admin action button variants — caution (yellow) and safe (green)

**Analog:** existing `.bsk-btn--admin-exit` (lines 495–505):

```css
/* EXISTING */
.bsk-btn--admin-exit {
  background: #1A1A1A;
  border-color: #FF6B6B;
  color: #FF6B6B;
  margin-top: 8px;
  font-size: 20px;
}

.bsk-btn--admin-exit:active {
  background: rgba(255, 107, 107, 0.12);
}
```

**Phase 09 additions** — append after `.bsk-btn--admin-exit:active`:

```css
/* Phase 09 — "POS schliessen" caution variant (yellow, destructive-caution) */
.bsk-btn--admin-action--caution {
  background: #2A2000;
  border-color: #F5C518;
  color: #F5C518;
}

.bsk-btn--admin-action--caution:active {
  background: #3A3000;
}

/* Phase 09 — "POS offnen" safe variant (green) */
.bsk-btn--admin-action--safe {
  background: #0A2010;
  border-color: #4CAF50;
  color: #4CAF50;
}

.bsk-btn--admin-action--safe:active {
  background: #0A3015;
}
```

**Design rationale:** Dark tinted background + colored border + colored text matches the `--admin-exit` established pattern (border-dominant, dark bg). Avoids filled yellow/green which would over-saturate in the dark admin card theme.

### 5b. `.bsk-welcome-subtext` — closed-state secondary line

**Analog:** `.bsk-error-subtext` (line 140–148) and `.bsk-status-text` (lines 91–98):

```css
/* EXISTING — .bsk-error-subtext */
.bsk-error-subtext {
  font-size: 16px;
  color: #9CA3AF;
  text-align: center;
  padding: 0 32px;
  margin: 0;
  line-height: 1.4;
}
```

**Phase 09 addition** — append after the welcome screen block (after `.bsk-welcome-title`):

```css
/* Phase 09 — welcome closed-state subtext */
.bsk-welcome-subtext {
  font-size: 18px;
  font-weight: 400;
  color: #9CA3AF;
  text-align: center;
  margin: 16px 0 0 0;
  line-height: 1.5;
  max-width: 80vw;
}
```

---

## 6. `src/host/host.js`

### 6a. Module-level state variable

**Analog:** existing module-level vars (lines 234–238):

```javascript
// EXISTING
var pinModalContext = 'admin';
var lockoutInterval = null;
var adminUpdateResultTimer = null;
var updateFailedTimer = null;
var updateFailedHandler = null;
```

**Phase 09 addition** — append with the existing Phase 5 state block:

```javascript
var posOpenState = true;    // tracks last known posOpen; updated by onPosStateChanged
```

### 6b. `applyPosState(posOpen)` — mutate `#welcome-screen` in place

**Analog:** `showMagiclineError(payload)` (lines 134–213) — the definitive example of variant-switching by mutating existing DOM elements in place rather than showing/hiding different layers:

```javascript
// EXISTING pattern — showMagiclineError mutates title, subtext, button in-place
function showMagiclineError(payload) {
  var el = document.getElementById('magicline-error');
  var variant = (payload && payload.variant) || 'drift';
  var title = el.querySelector('.bsk-error-title');
  var sub = el.querySelector('.bsk-error-subtext');
  // ...
  if (variant === 'drift') {
    if (title) title.textContent = 'Kasse vor\u00FCbergehend nicht verf\u00FCgbar';
    if (sub)   sub.textContent   = '...';
    // ...
  } else if (variant === 'credentials-unavailable') {
    // ...
  }
  el.style.display = 'flex';
  el.setAttribute('aria-hidden', 'false');
}
```

**Phase 09 `applyPosState`:**

```javascript
function applyPosState(posOpen) {
  var el = document.getElementById('welcome-screen');
  if (!el) return;
  var h1 = el.querySelector('.bsk-welcome-title');
  var sub = el.querySelector('.bsk-welcome-subtext');
  if (posOpen) {
    if (h1) h1.textContent = 'Zum Kassieren tippen';
    if (sub) sub.remove();
    el.style.pointerEvents = '';
    el.style.cursor = '';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Zum Kassieren tippen');
  } else {
    if (h1) h1.textContent = 'POS derzeit geschlossen';
    if (!sub) {
      sub = document.createElement('p');
      sub.className = 'bsk-welcome-subtext';
      el.appendChild(sub);
    }
    sub.textContent = 'Bitte Studio-Personal verst\u00E4ndigen';
    el.style.pointerEvents = 'none';
    el.style.cursor = 'default';
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.setAttribute('aria-label', 'POS geschlossen');
  }
}
```

**Tap suppression:** `pointer-events: none` on `#welcome-screen` prevents `handleWelcomeTap` (wired via `pointerdown`/`touchstart` in `wireStatic` at lines 943–951) from receiving events. The existing `bsk-layer--welcome` CSS has `pointer-events: auto` by default (line 107); the inline style overrides it cleanly.

### 6c. `updatePosToggleButton(posOpen)` — update button label and class

**Analog:** `renderDiagnostics` line that updates `#admin-btn-update-config` label (lines 554–556):

```javascript
// EXISTING
var cfgBtn = document.getElementById('admin-btn-update-config');
if (cfgBtn) cfgBtn.textContent = d.patConfigured ? 'Update-Zugang \u00E4ndern' : 'Auto-Update einrichten';
```

**Phase 09 `updatePosToggleButton`:**

```javascript
function updatePosToggleButton(posOpen) {
  var btn = document.getElementById('admin-btn-pos-toggle');
  if (!btn) return;
  if (posOpen) {
    btn.textContent = 'POS schliessen';
    btn.classList.remove('bsk-btn--admin-action--safe');
    btn.classList.add('bsk-btn--admin-action--caution');
    btn.setAttribute('aria-label', 'POS schliessen \u2014 Best\u00E4tigung erforderlich');
  } else {
    btn.textContent = 'POS \u00F6ffnen';
    btn.classList.remove('bsk-btn--admin-action--caution');
    btn.classList.add('bsk-btn--admin-action--safe');
    btn.setAttribute('aria-label', 'POS \u00F6ffnen');
  }
}
```

### 6d. Extend `renderDiagnostics(d)` to call `updatePosToggleButton`

**Analog:** the existing `cfgBtn.textContent` line in `renderDiagnostics` (line 555):

```javascript
// Phase 09 addition — append at end of renderDiagnostics(d):
updatePosToggleButton(typeof d.posOpen === 'boolean' ? d.posOpen : true);
```

### 6e. Extend `hideAdminMenu()` to also hide `#pos-close-confirm`

**Analog:** existing `hideAdminMenu` (lines 567–573):

```javascript
// EXISTING
function hideAdminMenu() {
  var menu = document.getElementById('admin-menu');
  if (menu) { menu.style.display = 'none'; menu.setAttribute('aria-hidden', 'true'); }
  var res = document.getElementById('admin-update-result');
  if (res) res.style.display = 'none';
  if (adminUpdateResultTimer) { clearTimeout(adminUpdateResultTimer); adminUpdateResultTimer = null; }
}
```

**Phase 09 addition** — append before closing `}`:

```javascript
var posConfirm = document.getElementById('pos-close-confirm');
if (posConfirm) { posConfirm.style.display = 'none'; posConfirm.setAttribute('aria-hidden', 'true'); }
```

### 6f. `#admin-btn-pos-toggle` click handler

**Analog:** `wireAdminButtons()` for simple dispatch (lines 786–815), but the POS toggle button has asymmetric behavior — it needs special handling outside the `handlers` map (same reason as `admin-btn-close` which is also outside the map):

```javascript
// EXISTING — admin-btn-close is outside the handlers map
var closeBtn = document.getElementById('admin-btn-close');
if (closeBtn) {
  closeBtn.addEventListener('click', function () {
    if (window.kiosk && window.kiosk.closeAdminMenu) {
      window.kiosk.closeAdminMenu();
    }
  });
}
```

**Phase 09 addition** — add inside `wireAdminButtons()` after the `closeBtn` block:

```javascript
// Phase 09 — POS toggle button (asymmetric: close needs confirm, open does not)
var posToggleBtn = document.getElementById('admin-btn-pos-toggle');
if (posToggleBtn) {
  posToggleBtn.addEventListener('click', function () {
    if (posOpenState) {
      // posOpen=true → show confirm before closing
      var confirm = document.getElementById('pos-close-confirm');
      if (confirm) {
        confirm.style.display = 'flex';
        confirm.setAttribute('aria-hidden', 'false');
      }
    } else {
      // posOpen=false → open immediately, no confirm (D-03)
      if (window.kiosk && window.kiosk.adminMenuAction) {
        window.kiosk.adminMenuAction('toggle-pos-open');
      }
    }
  });
}

// Phase 09 — POS close confirm overlay buttons
var posConfirmYes = document.getElementById('pos-confirm-yes');
if (posConfirmYes) {
  posConfirmYes.addEventListener('click', function () {
    var confirm = document.getElementById('pos-close-confirm');
    if (confirm) { confirm.style.display = 'none'; confirm.setAttribute('aria-hidden', 'true'); }
    if (window.kiosk && window.kiosk.adminMenuAction) {
      window.kiosk.adminMenuAction('toggle-pos-open');
    }
  });
}

var posConfirmCancel = document.getElementById('pos-confirm-cancel');
if (posConfirmCancel) {
  posConfirmCancel.addEventListener('click', function () {
    var confirm = document.getElementById('pos-close-confirm');
    if (confirm) { confirm.style.display = 'none'; confirm.setAttribute('aria-hidden', 'true'); }
  });
}
```

### 6g. Esc key guard — extend existing Esc handler

**Analog:** existing `keydown` listener (lines 1024–1041) that skips close-admin-menu if nested overlays are visible:

```javascript
// EXISTING — lines 1024–1041
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  var adminMenu = document.getElementById('admin-menu');
  if (!adminMenu || adminMenu.style.display === 'none') return;
  var credsOverlay = document.getElementById('credentials-overlay');
  var pinChangeOverlay = document.getElementById('pin-change-overlay');
  var updateConfig = document.getElementById('update-config');
  if (credsOverlay && credsOverlay.style.display !== 'none') return;
  if (pinChangeOverlay && pinChangeOverlay.style.display !== 'none') return;
  if (updateConfig && updateConfig.style.display !== 'none') return;
  // Only root admin menu is visible — close it
  if (window.kiosk && window.kiosk.closeAdminMenu) {
    window.kiosk.closeAdminMenu();
  }
});
```

**Phase 09 addition** — add guard for `#pos-close-confirm` before the `closeAdminMenu` call:

```javascript
var posCloseConfirm = document.getElementById('pos-close-confirm');
if (posCloseConfirm && posCloseConfirm.style.display !== 'none') {
  // Esc from confirm overlay = cancel (dismiss overlay, stay in admin menu)
  posCloseConfirm.style.display = 'none';
  posCloseConfirm.setAttribute('aria-hidden', 'true');
  return;
}
```

### 6h. IPC subscriptions — `onPosStateChanged` and `onShowWelcome` extension

**Analog:** existing subscription block (lines 954–1022), specifically the `onDevModeChanged` pattern (lines 1007–1021) for a subscriber that updates DOM immediately:

```javascript
// EXISTING — onDevModeChanged pattern
if (window.kiosk.onDevModeChanged) window.kiosk.onDevModeChanged(function (payload) {
  var active = payload && payload.active;
  var btn = document.getElementById('admin-btn-dev-mode');
  if (btn) btn.textContent = active ? 'Dev-Modus AUS' : 'Dev-Modus';
  // ...
});
```

**Phase 09 additions** — append after the `onDevModeChanged` block, before the closing `}` of the `if (window.kiosk)` block:

```javascript
// Phase 09 — pos-state-changed: update module-level state + apply to welcome + update toggle button
if (window.kiosk.onPosStateChanged) {
  window.kiosk.onPosStateChanged(function (payload) {
    posOpenState = !!(payload && payload.posOpen !== false);
    applyPosState(posOpenState);
    updatePosToggleButton(posOpenState);
  });
}
```

**Extend the existing `onShowWelcome` subscriber** (line 997) to re-apply `posOpenState` so the correct state is shown on every welcome cycle (including post-reset hardReset paths that call `welcome:show`):

```javascript
// EXISTING — line 997
if (window.kiosk.onShowWelcome) window.kiosk.onShowWelcome(showWelcome);
```

**Phase 09 replacement:**

```javascript
if (window.kiosk.onShowWelcome) window.kiosk.onShowWelcome(function () {
  showWelcome();
  applyPosState(posOpenState); // ensure closed state persists across welcome cycles
});
```

---

## 7. `test/updateGate.test.js`

### Helper: `makeGetPosOpen`

**Analog:** existing `makeLog()` and `makeSessionReset()` factories (lines 12–28):

```javascript
// EXISTING
function makeLog() {
  const calls = [];
  return {
    calls,
    audit: (event, fields) => calls.push({ event, fields }),
    error: (msg) => calls.push({ event: 'error', msg }),
  };
}

function makeSessionReset() {
  let listener = null;
  return {
    onPostReset: (cb) => { listener = cb; },
    _fire: () => { if (listener) listener(); },
    _getListener: () => listener,
  };
}
```

**Phase 09 addition** — add after `makeSessionReset`:

```javascript
function makeGetPosOpen(value) {
  return () => value;
}
```

### Test case structure — `setInterval` monkey-patching pattern

**Analog:** existing `maintenance-window` test (lines 78–110) — the complete pattern to follow:

```javascript
// EXISTING — complete pattern for tests that exercise the polling interval
test('onUpdateDownloaded: maintenance-window trigger fires installFn', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  let intervalCleared = false;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer'; };
  global.clearInterval = (id) => { if (id === 'fake-timer') intervalCleared = true; };

  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 9,
    });
    assert.strictEqual(installed, 0, 'install must wait for interval tick');
    intervalFn();
    assert.strictEqual(installed, 1);
    assert.ok(intervalCleared, 'timer should be cleared after fire');
    const installAudit = log.calls.find(c => c.event === 'update.install');
    assert.strictEqual(installAudit.fields.trigger, 'maintenance-window');
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});
```

### Four new test cases

**Test 1 — `admin-closed-window` fires when `posOpen=false` + in window:**

```javascript
test('admin-closed-window: posOpen=false in window fires trigger with posOpen and hour fields', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-acw'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 10,                    // in window
      getPosOpen: makeGetPosOpen(false),    // POS closed
    });
    assert.strictEqual(installed, 0, 'install must wait for interval tick');
    intervalFn();
    assert.strictEqual(installed, 1);
    const audit = log.calls.find(c => c.event === 'update.install');
    assert.ok(audit, 'update.install audit missing');
    assert.strictEqual(audit.fields.trigger, 'admin-closed-window');
    assert.strictEqual(audit.fields.posOpen, false);
    assert.strictEqual(audit.fields.hour, 10);
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});
```

**Test 2 — no fire when `posOpen=false` but outside window:**

```javascript
test('admin-closed-window: posOpen=false outside window does NOT fire', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-acw2'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 14,                    // outside window
      getPosOpen: makeGetPosOpen(false),
    });
    intervalFn();
    assert.strictEqual(installed, 0, 'must not fire outside maintenance window');
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});
```

**Test 3 — falls through to `maintenance-window` when `posOpen=true`:**

```javascript
test('admin-closed-window: posOpen=true in window falls through to maintenance-window', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-acw3'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 9,
      getPosOpen: makeGetPosOpen(true),     // POS open
    });
    intervalFn();
    assert.strictEqual(installed, 1, 'maintenance-window should still fire');
    const audit = log.calls.find(c => c.event === 'update.install');
    assert.strictEqual(audit.fields.trigger, 'maintenance-window');
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});
```

**Test 4 — first-trigger-wins when `admin-closed-window` and `post-reset` both fire:**

```javascript
test('admin-closed-window: first-trigger-wins — admin-closed-window vs post-reset', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-acw4'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 10,
      getPosOpen: makeGetPosOpen(false),
    });
    // admin-closed-window fires first via interval
    intervalFn();
    assert.strictEqual(installed, 1);
    // subsequent post-reset must be no-op
    sr._fire();
    assert.strictEqual(installed, 1, 'second trigger must be suppressed by first-trigger-wins');
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});
```

---

## Pitfall Reminders (from RESEARCH.md)

| Pitfall | File | Guard |
|---------|------|-------|
| Button shows wrong label on admin menu open after kiosk restart with `posOpen=false` | `main.js` `buildAdminDiagnostics` | Include `posOpen: store.get('posOpen', true)` |
| Welcome renders open state on cold boot when `posOpen=false` persisted | `main.js` `showWelcomeOnColdBoot` | Send `pos-state-changed` AFTER `welcome:show` |
| Confirm overlay visible when admin menu reopens (stale from prior session) | `host.js` `hideAdminMenu` | Hide `#pos-close-confirm` in `hideAdminMenu` |
| Audit log missing `posOpen=false hour=N` fields for `admin-closed-window` | `updateGate.js` `fireWith` | Extend `fireWith` to accept `extra` object, `Object.assign` into fields |
| Welcome closed state lost on post-reset welcome cycle | `host.js` `onShowWelcome` subscriber | Re-call `applyPosState(posOpenState)` inside the subscriber |
| `getPosOpen` type guard missing — breaks on test environments pre-dating Phase 09 | `updateGate.js` interval | `typeof getPosOpen === 'function'` guard before calling |

---

*Patterns extracted: 2026-04-20*
*Codebase read: all 7 target files verified*
