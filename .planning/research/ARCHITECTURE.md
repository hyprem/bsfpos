# Architecture Patterns

**Domain:** Electron Windows kiosk wrapping a third-party React+MUI SaaS web UI (Magicline) with NFC HID input, idle/reset flow, hidden admin exit, and GitHub Releases auto-update
**Researched:** 2026-04-08
**Overall confidence:** HIGH (grounded in the working Android prototype in `BeeStrong_POS_Kiosk_Project.md` and standard, stable Electron primitives: `BrowserWindow`, `BrowserView`, `webContents.insertCSS`/`executeJavaScript`, `contextBridge`, `safeStorage`, `session.clearStorageData`, `globalShortcut`, `before-input-event`, `electron-updater`)

## Recommended Architecture

### One Sentence
A single Electron **main process** owns a single fullscreen **host `BrowserWindow`** that loads a local `host.html` (our branded chrome + idle overlay), and embeds Magicline inside a child **`BrowserView`** attached to that window. The main process is the single source of truth for credentials, idle state, badge-buffer arbitration, session clearing, admin exit, logs, and updates. The renderer and the injected Magicline page communicate with main only via IPC through a `contextIsolation: true` preload script.

### High-level Diagram

```
+-----------------------------------------------------------------+
|  Electron Main Process (Node)                                   |
|  - app lifecycle, single-instance lock                          |
|  - CredentialStore (safeStorage / DPAPI)                        |
|  - IdleController (authoritative timer)                         |
|  - BadgeArbiter (optional, see "Badge input" section)           |
|  - SessionResetService (session.clearStorageData + reload)      |
|  - AdminExitController (globalShortcut + PIN modal)             |
|  - Logger (rotating files via electron-log / winston)           |
|  - UpdateService (electron-updater -> GitHub Releases)          |
|  - CrashWatcher (render-process-gone -> reload)                 |
|                                                                 |
|  +----------- host BrowserWindow (fullscreen, kiosk) ---------+ |
|  |                                                            | |
|  |  host.html  (our renderer, branded)                        | |
|  |   - Idle "Are you still there?" overlay (hidden by default)| |
|  |   - "Logging in..." splash                                 | |
|  |   - Error screen                                           | |
|  |   - Admin PIN modal                                        | |
|  |   preload-host.js  (contextBridge -> window.kiosk)         | |
|  |                                                            | |
|  |  +---- child BrowserView (covers host minus overlays) ---+ | |
|  |  |                                                       | | |
|  |  |  Magicline SaaS (React + MUI)                         | | |
|  |  |  - inject.css   (webContents.insertCSS, permanent)    | | |
|  |  |  - inject.js    (executeJavaScript on did-finish-load | | |
|  |  |                  AND preload via webPreferences)      | | |
|  |  |  preload-magicline.js (contextBridge -> window.bridge)| | |
|  |  |                                                       | | |
|  |  +-------------------------------------------------------+ | |
|  |                                                            | |
|  +------------------------------------------------------------+ |
+-----------------------------------------------------------------+
            ^                                     ^
            |                                     |
   USB HID keystrokes                     GitHub Releases (HTTPS)
   (delivered to whichever                electron-updater checks
    webContents has focus)                on boot + every N hours
```

### Component Boundaries

| Component | Process | Responsibility | Talks To |
|-----------|---------|---------------|----------|
| **AppBootstrap** | Main | `app.whenReady`, single-instance lock, command-line switches (`--disable-http-cache` etc.), create host window, wire everything | everything |
| **HostWindow** | Main | Owns the fullscreen `BrowserWindow({ kiosk: true, fullscreen: true, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: preload-host.js } })`. Loads `host.html`. | MagiclineView, HostRenderer |
| **MagiclineView** | Main | Creates `BrowserView`, `setBrowserView` on host window, sizes it to fill host minus reserved overlay area, loads `https://bee-strong-fitness.web.magicline.com`. Owns the injection lifecycle. | HostWindow, InjectionService |
| **InjectionService** | Main | On `did-finish-load` / `did-navigate-in-page` / `dom-ready` of Magicline `webContents`: calls `insertCSS(hideCss)` (keeps returned key) and `executeJavaScript(injectJs)`. Re-runs on every nav. | MagiclineView |
| **HostRenderer** | Renderer (host.html) | Bee Strong branded HTML: idle overlay, login splash, error screen, admin PIN modal. Pure presentation, triggered by IPC messages from main. Never talks to Magicline directly. | Main (via `window.kiosk` preload API) |
| **MagiclinePreload** | Preload (Magicline webContents) | Context-isolated bridge exposing a tiny `window.bridge` to the injected script: `bridge.notifyActivity()`, `bridge.notifySaleConfirmed()`, `bridge.notifyLoginPageDetected()`, `bridge.requestCredentials()`, `bridge.log(event)`. All other features are blocked. | InjectedScript, Main (IPC) |
| **InjectedScript** (`inject.js`) | In Magicline page | Direct port of the prototype: `setMuiValue`, badge buffer with <50ms timing, dynamic-element hiding, `Jetzt verkaufen` post-sale clear, login-page detection, `customer-search` injection, focus-aware product-search passthrough. Reports events to main via `window.bridge`. | Magicline DOM, MagiclinePreload |
| **InjectedCSS** (`inject.css`) | In Magicline page | Stable `[data-role=...]` hides + flagged fragile MUI `css-xxxxx` hides. Loaded once per navigation via `insertCSS` (engine-level, survives re-renders). | — |
| **CredentialStore** | Main | Reads/writes Magicline username+password encrypted with `safeStorage.encryptString` (Windows DPAPI). File in `app.getPath('userData')/credentials.bin`. Provided to injected login fill via preload on explicit request. | AdminExitController, InjectionService |
| **IdleController** | Main | **Authoritative** 60s inactivity timer. Receives `activity` events from injected script (pointerdown/keydown) and host renderer (overlay taps). On expiry -> tells HostRenderer to show overlay with 30s countdown. On countdown expiry -> calls SessionResetService. | MagiclinePreload, HostRenderer, SessionResetService |
| **SessionResetService** | Main | `session.defaultSession.clearStorageData({ storages: ['cookies','localstorage','indexdb','serviceworkers','cachestorage'] })` then reloads MagiclineView. Auto-login will then fire via the login-page detection path. | MagiclineView, Logger |
| **AdminExitController** | Main | Registers `globalShortcut.register('Ctrl+Shift+F12', ...)` (or uses `before-input-event` on host webContents for extra reliability under kiosk). Shows PIN modal in HostRenderer. On correct PIN: drops `kiosk: true`, unhides menu, enables devtools for maintenance session. | HostRenderer, HostWindow |
| **Logger** | Main | `electron-log` with rotating file transport in `app.getPath('userData')/logs/`. Structured events: `badge_scan`, `sale_completed`, `idle_reset`, `login_attempt`, `login_success`, `login_failure`, `update_available`, `update_applied`, `crash`, `reload`. | everything |
| **UpdateService** | Main | `electron-updater` with `GitHub` provider. Checks on `app.whenReady` and on an interval (e.g. every 6h). `autoDownload: true`, `autoInstallOnAppQuit: true`. Also forces quitAndInstall during idle-reset windows if an update is pending. | Logger |
| **CrashWatcher** | Main | `webContents.on('render-process-gone')` on both host and magicline webContents -> log + reload. `app.on('child-process-gone')` -> log. | Logger, MagiclineView |

### Key Decision: Host Window + Child BrowserView (not one BrowserWindow loading Magicline directly)

This is the single most important architectural choice. Three options were considered:

| Option | Where does the "Are you still there?" overlay live? | Verdict |
|--------|----------------------------------------------------|---------|
| **A. One `BrowserWindow` loading Magicline directly; overlay injected as a DOM element into the Magicline page via `executeJavaScript`** | Inside the Magicline DOM | REJECTED. Couples our branded UI to React re-render fights — exactly the Android pain point we are leaving. Every Magicline update risks breaking our overlay. Cannot style it cleanly without leaking CSS into Magicline. Z-index wars with MUI modals. |
| **B. Separate second `BrowserWindow` positioned on top of the Magicline window** | A borderless always-on-top second window | REJECTED. Two windows must be kept synced in size/focus/kiosk state; HID keystrokes land in whichever window has focus, creating a badge-routing ambiguity. Alt+Tab and focus-stealing edge cases. Two crash domains to supervise. |
| **C. One host `BrowserWindow` loading our own `host.html`, with a child `BrowserView` inside it loading Magicline** | A plain HTML element in `host.html`, shown/hidden by the host renderer on IPC from main | **CHOSEN**. Our overlay lives in **our** DOM, styled with **our** CSS, never touched by React re-renders. The Magicline page is fully isolated. To show the overlay we simply `setBounds` the BrowserView smaller or hide it, or draw the overlay on top via CSS z-index on the host — the BrowserView is a native OS child, but a fullscreen host `<div class="overlay">` with pointer-events on still blocks input because the BrowserView can be hidden via `removeBrowserView` or resized to 0 during overlay display. |

**Overlay display mechanism (concrete):** The host renderer shows a fullscreen `<div id="idle-overlay">`. Because `BrowserView` sits above host HTML in the z-order on screen, the main process additionally calls `hostWindow.setBrowserView(null)` (or `setBounds({ x:0,y:0,width:0,height:0 })`) while the overlay is shown, then restores it on dismiss. This gives us a clean "our brand is on screen, Magicline is hidden, no DOM contamination."

*(Note: there is ongoing Electron discussion of deprecating `BrowserView` in favor of `WebContentsView` + `BaseWindow`. `WebContentsView` is the forward-compatible equivalent and should be preferred if available in the chosen Electron version — the architecture is identical, just the class name changes. Confidence: HIGH on concept, MEDIUM on exact class name — to re-verify against the chosen Electron version during Phase 1.)*

### Data Flow

#### 1. NFC HID badge scan -> Magicline customer field

```
Deka reader (USB HID keyboard wedge)
   |  (OS delivers keystrokes to the focused webContents)
   v
Magicline BrowserView webContents has focus (normal state)
   |
   v
document keydown listener in inject.js
   |  - measures inter-key delta; <50ms -> treated as badge chars
   |  - buffers chars; 100ms silence -> flush
   |  - EXCEPT if document.activeElement === product-search input -> passthrough
   v
setMuiValue(customerSearchInput, buffer)
   |  (React-native value setter + input/change events)
   v
Magicline React state updates -> member lookup fires on their side
   |
   v
inject.js -> window.bridge.notifyActivity() + bridge.log({type:'badge_scan'})
   |                                                |
   v                                                v
IdleController resets 60s timer            Logger writes rotating log
```

**Badge arbitration note:** When the idle overlay is visible, the BrowserView is hidden, so HID keystrokes land in the host window instead. The host preload captures them via `keydown` but only uses them to dismiss the overlay on *any* input (per the "Tap to continue" requirement — keystroke also counts as "still there"). The host does not attempt to forward buffered badge chars back into Magicline; after dismiss, the member simply scans again. This keeps the badge path single-sourced in `inject.js` and avoids cross-process buffer sync.

#### 2. Idle timeout -> overlay -> hard reset

```
inject.js pointerdown/keydown
  -> window.bridge.notifyActivity()
     -> IPC 'activity' to main
        -> IdleController.resetTimer(60_000ms)

(60s of silence)
  -> IdleController fires
     -> IPC 'show-idle-overlay' to host renderer
     -> main: hostWindow.setBrowserView(null)  (hide Magicline)
     -> host renderer: show overlay + start 30s visual countdown
     -> host renderer starts its own 30s timer

host user taps / types during countdown
  -> host renderer IPC 'overlay-dismissed' to main
  -> main: hostWindow.setBrowserView(magiclineView) (restore)
  -> IdleController.resetTimer(60_000ms)

host countdown expires with no interaction
  -> host renderer IPC 'overlay-expired' to main
  -> SessionResetService:
      1. Logger.log({type:'idle_reset'})
      2. session.defaultSession.clearStorageData({storages:[cookies, localstorage, indexdb, serviceworkers, cachestorage]})
      3. magiclineView.webContents.loadURL(MAGICLINE_URL)
  -> Magicline reloads -> lands on login page
  -> inject.js detects [data-role="username"] -> bridge.notifyLoginPageDetected()
  -> main -> CredentialStore.get() -> IPC reply with creds to preload
  -> preload calls an internal inject.js function fillAndSubmitLogin(user, pass)
  -> inject.js uses setMuiValue on username+password, then clicks [data-role="login-button"]
  -> Magicline logs in -> redirects to /#/cash-register
  -> inject.js re-asserts (CSS is already permanent via insertCSS)
  -> idle overlay is hidden, BrowserView is restored
```

**Critical:** the idle timer lives in **main**, not in inject.js. The prototype's `setTimeout(..., 60000)` inside the injected script worked for Android but is fragile in Electron because (a) multiple `executeJavaScript` re-runs on navigation would stack timers, (b) main already needs to know about idle to drive the host overlay, and (c) main can supervise badge activity from multiple sources consistently.

#### 3. Auto-login on cold boot

```
app.whenReady -> createHostWindow -> createMagiclineView
  -> magiclineView.loadURL(MAGICLINE_URL)
  -> Magicline serves login page (no session)
  -> InjectionService on did-finish-load:
      magiclineView.webContents.insertCSS(hideCss)
      magiclineView.webContents.executeJavaScript(injectJs)
  -> inject.js detects login page selectors
  -> bridge.notifyLoginPageDetected()
  -> main returns credentials (one-shot, not cached in renderer)
  -> inject.js fills + clicks
  -> navigation occurs -> did-finish-load fires again
  -> InjectionService re-injects (CSS insertCSS is permanent per-webContents but
     we re-call it defensively because SPAs hash-navigate and we want belt+braces)
  -> inject.js sees /#/cash-register -> starts normal operation
  -> bridge.notifyReady() -> main hides "Logging in..." splash in host
```

#### 4. Post-sale reset (3s after Jetzt verkaufen)

Identical to prototype — entirely inside inject.js: click listener on `[data-role="button"]` with text "Jetzt verkaufen", `setTimeout(resetCustomerField, 3000)`. Additionally: `bridge.notifySaleConfirmed()` so main can log it and reset idle timer.

#### 5. Admin exit

```
globalShortcut 'Ctrl+Shift+F12' (registered after app.whenReady)
  -> main: IPC 'show-admin-pin' to host renderer
  -> main: setBrowserView(null) to hide Magicline
  -> host renderer shows PIN modal
  -> on submit: IPC 'admin-pin-attempt' {pin}
  -> main verifies against hashed PIN in userData
  -> on success:
       - Logger.log({type:'admin_exit'})
       - hostWindow.setKiosk(false)
       - hostWindow.setFullScreen(false)
       - hostWindow.webContents.openDevTools() (optional)
       - magiclineView.webContents.openDevTools()
       - quit only on explicit admin action
  -> on failure: log, reshow
```

### IPC Channel Inventory

All IPC is main <-> renderer via `contextBridge`-exposed functions. No `nodeIntegration`, no direct `ipcRenderer` in page scripts.

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `kiosk:activity` | magiclinePreload -> main | `{source:'keydown'\|'pointerdown'}` | Reset idle timer |
| `kiosk:badge-scanned` | magiclinePreload -> main | `{length:number}` (never the badge value itself) | Logging only |
| `kiosk:sale-confirmed` | magiclinePreload -> main | `{}` | Logging + idle reset |
| `kiosk:login-page-detected` | magiclinePreload -> main | `{}` | Trigger credential fetch |
| `kiosk:credentials-request` | magiclinePreload -> main (invoke) | `{}` -> `{user,pass}` | One-shot credential delivery |
| `kiosk:log` | either preload -> main | `{level, type, data}` | Structured logging |
| `kiosk:show-overlay` | main -> hostRenderer | `{countdownSec:30}` | Show idle overlay |
| `kiosk:hide-overlay` | main -> hostRenderer | `{}` | Hide idle overlay |
| `kiosk:overlay-dismissed` | hostRenderer -> main | `{}` | User returned |
| `kiosk:overlay-expired` | hostRenderer -> main | `{}` | Trigger hard reset |
| `kiosk:show-login-splash` | main -> hostRenderer | `{}` | "Logging in..." |
| `kiosk:hide-login-splash` | main -> hostRenderer | `{}` | Ready |
| `kiosk:show-error` | main -> hostRenderer | `{message}` | Render-process-gone, network down, etc. |
| `kiosk:show-admin-pin` | main -> hostRenderer | `{}` | Admin exit entry |
| `kiosk:admin-pin-attempt` | hostRenderer -> main (invoke) | `{pin}` -> `{ok:bool}` | Verify |

## Patterns to Follow

### Pattern 1: Permanent injection on every navigation
**What:** Register `webContents.on('dom-ready', ...)` **and** `webContents.on('did-navigate-in-page', ...)` and re-apply `insertCSS` + `executeJavaScript` on each. Keep a guard inside `inject.js` using a window symbol (`window.__bskiosk_injected__`) so the script is idempotent.
**When:** Every SPA navigation, because Magicline uses hash routing and may full-reload on session expiry.
**Why:** `insertCSS` returns a key and is persistent per-document, but a full reload re-parses the document and we want belt + braces. The JS guard prevents double listeners from stacking.

### Pattern 2: Stable selectors first, fragile selectors last, isolated file
**What:** `inject.css` has two clearly separated sections: `/* STABLE data-role selectors */` and `/* FRAGILE MUI css-xxxxx - re-verify on Magicline updates */`. Similarly inject.js keeps any text/SVG-path based hiding (`Rabatt`, `m21.41 11.41`) in a dedicated `hideDynamicElements()` function.
**When:** Always.
**Why:** When Magicline ships an update and something reappears, the admin knows exactly which file section to re-inspect. This is called out as a constraint in PROJECT.md.

### Pattern 3: Main process is the single source of truth
**What:** Any state that must survive navigation, crashes, or must be shared between Magicline-page and host-page lives in main. Timers, credentials, idle state, update state, admin state.
**When:** Always.
**Why:** `inject.js` is re-run on every navigation and loses closure state. Renderer crashes discard state. Main is the only stable home.

### Pattern 4: One preload per webContents, no nodeIntegration anywhere
**What:** `preload-host.js` exposes `window.kiosk` for host.html. `preload-magicline.js` exposes `window.bridge` for the Magicline page and is loaded via `webPreferences.preload` on the BrowserView. Neither preload exposes fs, child_process, or ipcRenderer directly — only narrow named functions.
**When:** Always.
**Why:** Magicline is third-party code we do not control. Context isolation and sandboxing are mandatory to prevent any XSS or Magicline-bug from escalating to Node. PROJECT.md's security constraint on credentials makes this non-negotiable.

### Pattern 5: Disable accelerators, keyboard shortcuts, and dev escapes in kiosk mode
**What:** `hostWindow.webContents.on('before-input-event', (e, input) => { if (matchesBlocklist(input)) e.preventDefault(); })` blocks F11, F12, Ctrl+R, Ctrl+Shift+I, Alt+F4, etc., *except* the admin hotkey. Also set `Menu.setApplicationMenu(null)`. Same `before-input-event` on the magicline webContents.
**When:** Always in kiosk mode; disabled after admin exit.
**Why:** PROJECT.md explicitly requires no escape via keyboard shortcuts.

### Pattern 6: Credentials never cross into the renderer as a cached value
**What:** `CredentialStore` in main returns credentials via `ipcMain.handle('kiosk:credentials-request', ...)` on a **single explicit invoke per login attempt**. The preload passes them into `inject.js` via a single function call and `inject.js` does not store them in any variable longer than the fill-and-click operation.
**When:** Login page detection only.
**Why:** Minimizes surface area. Credentials at rest are encrypted with DPAPI (`safeStorage`); credentials in memory exist only transiently.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Overlay as DOM injected into the Magicline page
**What:** Creating an `<div id="still-there-overlay">` via `executeJavaScript` inside the Magicline document.
**Why bad:** React will re-render its root and MUI modals use portals that will z-index fight you. Style leakage. You end up rebuilding the Android prototype's MutationObserver pain you are migrating away from.
**Instead:** Overlay lives in the host renderer (`host.html`), which is our own DOM we fully control.

### Anti-Pattern 2: Idle timer inside the injected script
**What:** A `setTimeout(..., 60000)` inside `inject.js`.
**Why bad:** inject.js re-runs on navigation, stacking timers. Cannot coordinate with the host overlay. Loses state on any hash change. Cannot be supervised by main on crash.
**Instead:** IdleController lives in main; inject.js only emits `activity` events.

### Anti-Pattern 3: Storing credentials in `localStorage`, `env`, or a plaintext JSON
**What:** Any persistence of credentials not wrapped in `safeStorage.encryptString`.
**Why bad:** Explicitly violates PROJECT.md's security constraint. Plaintext on disk = any RDP user can read them.
**Instead:** Always `safeStorage.encryptString` -> file in `userData`. Check `safeStorage.isEncryptionAvailable()` at startup and refuse to run otherwise.

### Anti-Pattern 4: Relying on `webContents.insertCSS` alone for dynamic hides
**What:** Putting `Rabatt` or the discount-icon SVG-path hides into `inject.css`.
**Why bad:** Those elements are identified by text content and SVG `d` attribute, not by a CSS selector alone. Only JS can hide them after React mounts them.
**Instead:** `insertCSS` for selector-based hides; `hideDynamicElements()` in `inject.js` for text/SVG-path-based hides, called from a MutationObserver scoped to the cart area.

### Anti-Pattern 5: Running Magicline in the host webContents
**What:** Loading `bee-strong-fitness.web.magicline.com` directly in the host `BrowserWindow` instead of a child `BrowserView`.
**Why bad:** Our branded overlays then have to live inside Magicline's DOM (Anti-Pattern 1). Host HTML and Magicline HTML share the same origin/document, breaking isolation.
**Instead:** Host HTML is our own `file://` (or data) document; Magicline lives in a child `BrowserView`/`WebContentsView`.

### Anti-Pattern 6: Blocking-wait for "login complete"
**What:** `await` or poll until the cash-register page appears before declaring ready.
**Why bad:** Magicline may redirect through intermediate pages, show 2FA prompts, or be offline. Blocking locks the kiosk.
**Instead:** State machine in main: `BOOTING -> LOGIN_DETECTED -> LOGIN_SUBMITTED -> CASH_REGISTER_READY`. Each transition is event-driven via IPC from inject.js. Timeouts on each transition -> show branded error screen, retry.

## File / Module Layout

```
bee-strong-kiosk/
|-- package.json
|-- electron-builder.yml        # win target, nsis, GitHub publish provider
|-- src/
|   |-- main/
|   |   |-- index.js                  # AppBootstrap, whenReady, single-instance lock
|   |   |-- hostWindow.js             # Creates host BrowserWindow
|   |   |-- magiclineView.js          # Creates BrowserView, wires InjectionService
|   |   |-- injectionService.js       # Reads inject.css/inject.js, re-injects on nav
|   |   |-- credentialStore.js        # safeStorage wrapper
|   |   |-- idleController.js         # 60s inactivity + overlay coordination
|   |   |-- sessionResetService.js    # clearStorageData + reload
|   |   |-- adminExitController.js    # globalShortcut + PIN
|   |   |-- logger.js                 # electron-log setup, rotating files
|   |   |-- updateService.js          # electron-updater / GitHub Releases
|   |   |-- crashWatcher.js           # render-process-gone handlers
|   |   |-- ipcChannels.js            # constants shared across main
|   |   `-- keyboardLockdown.js       # before-input-event blocklist
|   |-- preload/
|   |   |-- host.js                   # window.kiosk for host.html
|   |   `-- magicline.js              # window.bridge for injected script
|   |-- host/                         # Bee Strong branded renderer
|   |   |-- host.html
|   |   |-- host.css
|   |   |-- host.js                   # overlay state machine, PIN modal, splash
|   |   `-- assets/
|   |       |-- logo.svg
|   |       `-- fonts/
|   `-- injected/                     # Loaded as strings by InjectionService
|       |-- inject.css                # STABLE section + FRAGILE section
|       `-- inject.js                 # Ported from prototype, guarded, bridge-aware
|-- build/                            # icon.ico, installer assets
|-- logs/                             # (runtime, in userData actually)
`-- README.md
```

## Scalability Considerations

| Concern | Single device (this project) | If multi-device ever | Notes |
|---------|-----------------------------|---------------------|-------|
| Config | Hardcoded constants + local encrypted creds | Remote config service | Explicitly out of scope per PROJECT.md |
| Updates | GitHub Releases via electron-updater | Same | Free tier fine |
| Logs | Rotating local files, RDP to read | Centralized (Loki/ELK) | RDP is sufficient per constraints |
| Crash reporting | Local logs only | Sentry/etc | Explicitly rejected per budget constraint |
| Magicline drift | Manual selector re-verification via admin exit + devtools | Feature-flag driven CSS bundles | Single gym, manual is fine |

## Suggested Build Order

Dependencies flow top to bottom — later items depend on earlier ones.

### Phase A. Walking skeleton (day 1-2)
1. `npm init` + install `electron`, `electron-builder`, `electron-log`, `electron-updater`
2. **AppBootstrap** + **HostWindow** loading a trivial `host.html` that shows "Bee Strong loading..."
3. Verify `kiosk: true`, `fullscreen: true`, no menu bar, no devtools escape
4. **KeyboardLockdown** — `before-input-event` blocklist (F11, F12, Ctrl+R, Alt+F4, Ctrl+Shift+I)
**Gate:** App boots to branded splash, cannot be escaped with keyboard.

### Phase B. Magicline embed + injection (day 2-4)
5. **MagiclineView** — `BrowserView` loading Magicline, sized to host bounds, resize on `host.on('resize')`
6. **InjectionService** — load `inject.css` + `inject.js` from disk, apply on `dom-ready` and `did-navigate-in-page`
7. Port **inject.css** stable + fragile sections from `BeeStrong_POS_Kiosk_Project.md`
8. Port **inject.js** badge buffer, MUI setter, dynamic hides, post-sale reset **without** the bridge yet — verify it still works end-to-end like the Android prototype did
**Gate:** Kiosk boots, lands on Magicline login, CSS hides are applied, keyboard badge test fills customer-search. (Manual login for now.)

### Phase C. Credential vault + auto-login (day 4-5)
9. **CredentialStore** with `safeStorage`; one-time setup CLI or a first-run flow to write creds
10. **MagiclinePreload** exposes `bridge.notifyLoginPageDetected` and `bridge.requestCredentials` (invoke)
11. **inject.js** gains login-page detection + `fillAndSubmitLogin(user, pass)`
**Gate:** Cold boot -> auto-login -> cash register, no human interaction.

### Phase D. Activity + idle + overlay (day 5-7)
12. **MagiclinePreload** adds `bridge.notifyActivity`
13. **IdleController** in main with 60s timer
14. Host renderer overlay UI (`host.html` + `host.css` Bee Strong branded) — "Are you still there?" + 30s countdown + "Tap to continue"
15. IPC wiring `show-overlay` / `hide-overlay` / `overlay-dismissed` / `overlay-expired`
16. Main hides BrowserView (`setBrowserView(null)` or resize to 0) while overlay is shown
**Gate:** 60s inactivity shows branded overlay, tap dismisses, countdown expiry triggers next step.

### Phase E. Session reset + re-login loop (day 7-8)
17. **SessionResetService** — `clearStorageData` + reload
18. Wire `overlay-expired` -> SessionResetService -> auto-login path from Phase C fires
19. **Post-sale reset** via bridge event (belt + braces: inject.js still does its 3s clear locally)
**Gate:** Full loop — scan badge, walk away, overlay, expire, session cleared, auto-login, ready for next member.

### Phase F. Admin exit + logging (day 8-9)
20. **Logger** with rotating files in userData
21. Wire structured log events at every transition
22. **AdminExitController** — globalShortcut + PIN modal in host renderer
23. Hashed PIN storage in userData; admin exit drops kiosk mode and opens devtools on both webContents
**Gate:** Technician can enter PIN, get devtools, inspect Magicline, quit cleanly.

### Phase G. Auto-update + auto-start + crash recovery (day 9-10)
24. **UpdateService** — electron-updater, GitHub provider, check on boot
25. `electron-builder` publish config to GitHub Releases
26. **CrashWatcher** — render-process-gone -> log + reload both host and magiclineView independently
27. `app.setLoginItemSettings({ openAtLogin: true })` + NSIS `runAfterFinish`
**Gate:** Publish a dummy 0.0.2 release; kiosk on 0.0.1 upgrades itself on next boot. Kill the renderer from Task Manager; kiosk recovers.

### Phase H. Hardening + Magicline drift kit (day 10-12)
28. Branded error screen (network down, Magicline 5xx, login failure after N attempts)
29. `safeStorage.isEncryptionAvailable()` guard at startup
30. Single-instance lock (`app.requestSingleInstanceLock`)
31. Document "how to re-verify fragile MUI selectors" in `inject.css` comments + a short admin runbook
32. End-to-end on-device test: badge scan, full sale, walk-away, overlay, reset, re-login, under real usage
**Gate:** Ready to leave on site.

### Dependency Graph (short form)
```
A (skeleton + lockdown)
  -> B (Magicline embed + injection)
       -> C (credentials + auto-login)
            -> D (idle + overlay)
                 -> E (session reset loop)
                      -> F (admin exit + logging)
                           -> G (auto-update + crash recovery)
                                -> H (hardening)
```

C, D, and E must ship together for a usable kiosk; everything before C is demoable-but-not-deployable; everything after E is operability.

## Open Architecture Questions (for phase-specific research)

1. **`BrowserView` vs `WebContentsView`** — exact class to use depends on Electron version chosen in STACK.md. Same architecture either way. Re-verify at Phase B start. *(MEDIUM confidence)*
2. **Overlay hide mechanism** — `setBrowserView(null)`/`removeBrowserView` vs `setBounds` to zero vs an always-on-top transparent child window. Prototype in Phase D and pick the one with the cleanest visual transition. Leaning toward `setBounds` for speed (no view teardown). *(MEDIUM confidence)*
3. **`globalShortcut` vs `before-input-event` for admin hotkey** — `globalShortcut` is OS-global (fires even when app not focused, which is fine here because the app is always focused) but has been flaky in past Electron kiosk reports. `before-input-event` on the host webContents is more reliable but only fires when host has focus — which is not always true because the BrowserView has focus most of the time. **Likely need both**: `before-input-event` on the magicline webContents *and* on the host webContents, both routed to the same handler. Re-verify in Phase F. *(MEDIUM confidence)*
4. **Session clearing scope** — `clearStorageData` with `{ storages: [...] }` vs `session.clearCache()` + cookies separately. Need to confirm that Magicline's session is fully broken (no resurrect from serviceworker cache). Test in Phase E. *(MEDIUM confidence)*
5. **Fragile MUI selectors drift cadence** — unknowable without watching Magicline releases over weeks. Architecture already isolates them; the question is how often the fragile section will need re-verification. Operational concern, not structural. *(LOW confidence — accept and monitor)*

## Sources

- `BeeStrong_POS_Kiosk_Project.md` (project root) — working prototype JS/CSS, selectors, badge timing, reset logic, Magicline quirks **[HIGH confidence — proven on live Magicline]**
- `.planning/PROJECT.md` — scope, constraints, key decisions **[HIGH confidence — authoritative]**
- Electron main-process / BrowserWindow / BrowserView / preload / contextBridge / safeStorage / session.clearStorageData / globalShortcut / before-input-event / electron-updater: stable public APIs **[HIGH confidence from training data; cross-check exact signatures at phase start]**
- `BrowserView` -> `WebContentsView` migration path **[MEDIUM confidence — re-verify against chosen Electron version]**
