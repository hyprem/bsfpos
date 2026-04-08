# Pitfalls Research

**Domain:** Electron Windows kiosk wrapping third-party React+MUI SaaS (Magicline) on a single touchscreen POS with NFC HID, safeStorage credentials, idle session-clear, GitHub Releases auto-update
**Researched:** 2026-04-08
**Confidence:** HIGH for kiosk-breakout, safeStorage, MUI drift, HID focus issues; MEDIUM for session-clear race details and auto-updater kiosk behavior (verified via GitHub issues but exact versions drift)

Scope note: the user already understands MUI auto-class fragility and React re-render fights at a high level. This document focuses on the *operational* consequences and second-order failures — the things that look solved in a demo and bite you at the gym three weeks in.

---

## Critical Pitfalls

### Pitfall 1: Fragile MUI class selectors baked into the injection script instead of isolated in a versioned "drift layer"

**What goes wrong:**
On the first Magicline update after launch, `.css-p8umht`, `.css-qo4f3u`, `.MuiTypography-h5.css-1b1c5ke` (and any siblings) resolve to nothing. Elements that were hidden for weeks suddenly appear on the kiosk — usually the category tree, discount buttons, or a heading the customer now sees above the cart. The team has to SSH/RDP in, re-inspect the live DOM, and patch selectors while the gym is open.

**Why it happens:**
Emotion generates hashed class names from the compiled style rule contents; any CSS change inside Magicline's build (a padding tweak, a theme token rename, a dependency bump) re-hashes everything. MUI's own docs explicitly warn that hashed class names "can't be used as CSS selectors because they are unstable" and recommend the stable `.Mui[Component]-[slot]` names in the `sx` prop — which you can't use here because you don't own the components. You are living in the world the docs warn against.

**How to avoid:**
- Treat every `.css-xxxxxx` and every `-sc-xxxxxxxx-0` (styled-components) selector as a **known-fragile token** with an expiration date. Put them in a single file `inject/fragile-selectors.js` with a version stamp and a comment pointing at the DOM path, text content, and parent-by-`data-role` that identifies each one. No fragile selector anywhere else in the codebase.
- For each fragile selector, write a **text/structure-based fallback** (what the current code already does for "Rabatt" button and the SVG `d="m21.41 11.41..."` icon path). The hashed class is the fast path; the fallback must still fire if the class is absent.
- Ship a **self-diagnosis routine** that runs on every load: for each fragile selector, log `document.querySelectorAll(sel).length`. Zero matches for an element we expect to hide = a named warning in the log file + optional on-screen admin banner. This turns a silent regression into a loud one.
- Never restyle Magicline's content area (already in Out of Scope — keep it there). Restyling doubles the fragile-selector surface.

**Warning signs:**
- A selector's query count drops from >0 to 0 after a Magicline deploy
- Customer complaint: "why is there an extra button now"
- Log shows `hideDynamicElements` ran but MutationObserver keeps firing (target re-appears)

**Phase to address:**
Injection/hardening phase. Must exist before first customer release, not after first regression.

---

### Pitfall 2: `insertCSS` not actually persistent across SPA navigation / login redirect

**What goes wrong:**
Developer injects CSS in `did-finish-load` of the main window and assumes it sticks. It does — until Magicline's React router does a full document swap on logout→login redirect, or until the session expires and the app hard-reloads, or until the auto-update reloads the window. The CSS is re-inserted by the load handler, but there's a visible flash of the unhidden sidebar/topbar for 200–800ms on every reload, and on the touchscreen a customer can actually tap the "global search" button during that window.

**Why it happens:**
`webContents.insertCSS` persists for the life of the `webContents` / document, but any full navigation (new document) means a new lifecycle. CSS applied in `did-finish-load` runs *after* first paint — the bare Magicline UI is visible for however long it takes your handler to fire.

**How to avoid:**
- Inject CSS in `did-start-navigation` or via `webFrame.insertCSS` from the preload so it runs before first paint. The documented durable pattern: a "hide everything" safety stylesheet applied from the preload before first paint (`html { visibility: hidden !important }` on the root, then reveal once the real CSS is in), OR cover the window with a solid branded splash `BrowserView` / absolute-positioned `<div>` that your main process removes only after `executeJavaScript` confirms the hide rules evaluated non-empty.
- Re-inject on every `did-finish-load` AND `did-frame-finish-load` AND `did-navigate-in-page` (hash routing) — the three together catch Magicline's hash router, full reloads, and iframe logins if any.
- Test specifically: forced logout while customer is mid-checkout, session cookie expires, `session.clearStorageData` + `loadURL` cycle, auto-updater `quitAndInstall` → new launch.

**Warning signs:**
- "Flash of unhidden UI" (FOUUI) visible on every reset
- Customer manages to tap something during the flash (you'll see it in logs as an unexpected route change)
- MutationObserver logs showing "sidebar appeared" immediately after navigation events

**Phase to address:**
Injection/hardening phase, alongside idle session-clear implementation.

---

### Pitfall 3: Idle session-clear → auto-login race producing an infinite login loop or half-logged-in state

**What goes wrong:**
Idle timer fires → `session.defaultSession.clearStorageData({ storages: ['cookies','localstorage','indexdb','serviceworkers','cachestorage'] })` → `mainWindow.reload()` → auto-login detects the login form → fills credentials → clicks submit → Magicline sets cookies → redirect to cash-register → **but the reload started before clearStorageData's Promise resolved**, so the new page load sees stale cookies, navigates to `/#/cash-register` (already logged in), the auto-login detector waits for a login form that never comes, customer field is never cleared, next member walks up to another member's half-cart. Or: clearStorageData races cookie flush, reload happens with a corrupted cookie jar, Magicline rejects, infinite reload loop.

Related symptom seen in electron issue tracker: calling `clearStorageData` without awaiting the promise can leave cookies in an ambiguous state (#9776, #15928), and `clearStorageData` with caching disabled has crashed the whole renderer silently (#18585).

**Why it happens:**
`clearStorageData` is async and has been historically buggy with partial clears and ordering. `webContents.reload()` starts a new navigation immediately. Magicline's "am I logged in" check is cookie-based and runs client-side on the SPA — stale cookies from before the clear beat the clear.

**How to avoid:**
- Strict sequential flow, every step awaited:
  1. `await mainWindow.loadURL('about:blank')` to unload Magicline cleanly (kills its timers, closes EventSource/WebSocket)
  2. `await session.defaultSession.clearStorageData({ storages: [...] })`
  3. `await session.defaultSession.clearCache()`
  4. `await session.defaultSession.cookies.flushStore()` — critical, and documented as needed after programmatic cookie changes
  5. `await mainWindow.loadURL(MAGICLINE_URL)`
- Put the whole flow in a single `async` function guarded by a mutex (`resetInProgress` flag). Any idle/post-sale/admin trigger that fires during a reset is dropped, not queued.
- Auto-login state machine must be **idempotent** and **timeout-bounded**: "wait up to N seconds for username field; if not seen and we're on cash-register URL, assume already logged in, just clear customer field and return". Never block forever waiting for a login form.
- Detect loop: if >3 reloads happen within 60s, stop, surface an error overlay, and log. Otherwise you will DDoS Magicline from a stuck kiosk.
- Log every state transition (`reset-start`, `cleared`, `loaded`, `login-seen`, `login-filled`, `login-success`, `cash-register-ready`) with timestamps so you can reconstruct the race when it misbehaves.

**Warning signs:**
- Intermittent "member A's cart showing for member B" reports
- Log shows `reset` without matching `cash-register-ready` within 10s
- Reload count per hour > expected idle count
- Customer field non-empty on fresh load

**Phase to address:**
Session lifecycle phase — must be built as a state machine from day one, not patched onto a simple reload.

---

### Pitfall 4: `safeStorage` credentials bricked by Windows user password reset or profile migration

**What goes wrong:**
The gym IT person (or Windows Update, or a "reset PC preserving files") changes the Windows user password or the local profile SID. `safeStorage.decryptString` throws. The kiosk boots to an error screen. The gym owner has no idea what "decrypt failed" means and calls at 8am on a Saturday.

**Why it happens:**
`safeStorage` on Windows wraps DPAPI, and DPAPI master keys are derived from the user's logon credentials. A password reset done via another admin (not the user changing it themselves) can invalidate the old master key. Profile migration / re-creation definitely invalidates it. There is no domain backup key on a standalone kiosk — nothing rescues you.

**How to avoid:**
- Treat the encrypted blob as **disposable cache, not source of truth**. On decryption failure, don't crash — fall back to a clearly-branded "Kiosk-Anmeldedaten fehlen" admin screen that accepts credentials via on-screen keyboard behind the admin PIN, re-encrypts, and resumes.
- Store an **unencrypted integrity marker** (version, created timestamp, Windows username) next to the encrypted blob. If the current user doesn't match the stored username, don't even try to decrypt — go straight to re-entry flow. Prevents confusing "wrong password" errors.
- Check `safeStorage.isEncryptionAvailable()` *before* every encrypt/decrypt. It can return false before the app is fully ready (Electron issue #34614 — `safeStorage` use is invalid prior to BrowserWindow creation on some platforms).
- Document in the physical "kiosk runbook" taped to the terminal: "If you see the credential re-entry screen, enter the Magicline kiosk account password". Don't make the next person rediscover this.
- Do NOT store the Windows user password anywhere to "rescue" DPAPI. That defeats the whole point.
- Consider: does the gym's IT policy ever force Windows password rotation? If yes, you need a documented re-enroll procedure before the first rotation hits.

**Warning signs:**
- `safeStorage.decryptString` throws
- `isEncryptionAvailable()` returns false at boot
- Logs show repeated decrypt attempts on startup
- Windows profile path changed (rare but happens with "Reset this PC")

**Phase to address:**
Credentials phase. The fallback re-entry UI is non-optional and must ship with first release.

---

### Pitfall 5: Auto-update restart happening mid-transaction

**What goes wrong:**
`electron-updater` checks on a timer, downloads in background, calls `quitAndInstall()` when ready. On an always-on kiosk "idle" ≠ "not mid-transaction". A member has just tapped `Jetzt verkaufen`, Magicline is processing the card payment, the updater fires `quitAndInstall`, the Electron process dies, the POS terminal shows the NSIS installer flashing past on a 15" touchscreen, and either (a) the payment completed but no confirmation is shown (member thinks it failed and rescans) or (b) the payment is in an unknown state. This is reportedly a common complaint — electron-builder issues #1589 and #7785 explicitly ask for "update on quit rather than restart" and for flags to suppress auto-restart on Windows.

**Why it happens:**
The default `autoUpdater.quitAndInstall()` restart is immediate and uncooperative. Kiosk apps have no "user closed the window" moment to piggyback on, so naive implementations just call it on a timer.

**How to avoid:**
- **Never** call `quitAndInstall` from inside the running app. Set `autoUpdater.autoInstallOnAppQuit = true` (electron-updater supports this) and only trigger the quit path from a **known-safe window**: e.g. right after a successful idle hard-reset, when the customer field is empty AND no pending XHR to Magicline AND no cart items visible AND no transaction in flight for ≥30s.
- Define the safe window precisely. "After idle reset completes" is the cleanest single signal because by definition no member is mid-checkout.
- Schedule updates for a **daily maintenance window** (e.g. 04:00 local) — check for updates, download, and install on next natural idle. Don't check/install during gym opening hours at all if you can avoid it.
- When you do apply, show a branded "Wird aktualisiert…" fullscreen overlay BEFORE initiating the installer, so if someone walks up mid-update they see Bee Strong branding, not the raw NSIS splash.
- Log the entire update lifecycle (`update-available`, `download-progress`, `downloaded`, `install-scheduled`, `install-now`) with timestamps.
- Consider setting `autoUpdater.autoDownload = false` and controlling the download explicitly during maintenance window, so you're not competing with Magicline for bandwidth during a checkout.

**Warning signs:**
- Update applied timestamp inside gym opening hours
- Member complaint about a transaction that "didn't complete"
- NSIS installer UI reported as seen by member
- Log shows `quitAndInstall` while `sale-in-flight` flag was set

**Phase to address:**
Auto-update phase. The safe-window logic depends on session-lifecycle state being well-defined (Pitfall 3), so build session state first.

---

### Pitfall 6: NFC HID buffer losing characters to focus changes and competing event handlers

**What goes wrong:**
Member taps their badge. The first 3–4 characters of the 10-character UID arrive while Magicline's React is in the middle of a re-render triggered by the previous `pointerdown`. During that re-render, `document.activeElement` momentarily changes (or a toast popover steals focus, or the product search field briefly mounts). Your keydown listener uses `focused === productInput` as an early-return — during the flicker it's true, so keys get eaten. Customer field gets "5823" instead of "1234567890". Magicline fuzzy-matches to the wrong member or fails silently.

Alternative failure: the Deka reader emits characters at ~20ms intervals and your `BADGE_SPEED_MS = 50` check uses `timeSinceLast < 50 || badgeBuffer.length > 0`. The first character always has `lastKeyTime = 0` so `timeSinceLast` is huge — the first character of every scan is dropped unless a previous scan left the buffer non-empty. Current Android script has this bug latent; check the port carefully.

**How to avoid:**
- **Capture keydown at the Electron main process level** via `before-input-event` on `webContents`, not just in the renderer. That event fires before the page's React handlers and before any focus-dependent logic in the SPA.
- Maintain the badge buffer in the **preload/main side**, not in the page-injected script. The page can be re-rendered/reloaded, the preload cannot.
- Distinguish HID from human by inter-character timing only at the start of the first character via a separate "last-non-badge-keystroke" timestamp. Start a new buffer on any keystroke; commit the buffer when you see ≥4 fast keys AND a terminator (Enter/Tab is common for HID wedges — check what the Deka actually emits) OR timeout.
- **Never rely on `document.activeElement`** to route badge input. Route based on URL/state: "we are on `/#/cash-register` and no modal is open → badge goes to customer-search". Track modal state via a MutationObserver on `body` for `[role="dialog"]` / `.MuiModal-root` and suppress badge injection only while a modal is open.
- For product scanning (staff path): distinguish product barcodes from member badges by length/format if possible (member badges are usually numeric fixed-length; product EANs are 8/13 digits). If indistinguishable, provide an explicit "product scan mode" toggle for staff, not focus-based.
- Verify on the actual device: log raw keydown stream with timings for a session, inspect that HID timings and first-character handling match assumptions.

**Warning signs:**
- Customer-search field contains a short string missing first digits
- Log shows a badge buffer committed with length < expected UID length
- "Member scanned but nothing happened" complaints
- `timeSinceLast` value of >1000 on first character of scan

**Phase to address:**
NFC input phase, before first on-site user test. This is the pitfall most likely to embarrass the launch.

---

### Pitfall 7: Windows kiosk breakout via touchscreen gestures, on-screen keyboard, and physical keyboard shortcuts

**What goes wrong:**
Electron's `kiosk: true` + `fullscreen: true` + `autoHideMenuBar: true` hide the Electron window's own chrome but don't disable Windows itself. Edge-swipes from the right (Notification Center / Action Center / Copilot), left (Task View / Widgets), top (title bar snap), Win key, Win+D, Win+R, Win+L, Ctrl+Alt+Del, Ctrl+Shift+Esc (Task Manager), Alt+F4, Alt+Tab, F11 toggling fullscreen, three/four-finger gestures on precision touchpads (there isn't one here but on-screen gestures exist), and the on-screen keyboard's own special keys are all still live. A curious gym member (or an ex-employee) WILL find one. The `kiosk-mode-breakout` GitHub repo exists specifically to enumerate these.

**Why it happens:**
Electron's kiosk mode is "make the app fullscreen and trap focus". It does not replace the Windows shell. Preventing breakout requires OS-level configuration, not just app-level.

**How to avoid:**
- Use a dedicated local Windows user account running **Shell Launcher v2** (Windows 11 Enterprise/Education/IoT) with the Electron app configured as the replacement shell. Shell Launcher replaces explorer.exe — no Start menu, no taskbar, no Action Center shell. Requires the right SKU; verify the gym's Windows license up front.
- If Assigned Access / Shell Launcher is not available, the fallback is Group Policy + registry hardening:
  - Disable edge swipes: `HKLM\Software\Policies\Microsoft\Windows\EdgeUI\AllowEdgeSwipe = 0`
  - Disable Charms hints, app switcher, Task View
  - Disable Win key combinations via the "Turn off Windows+X hotkeys" policy
  - Disable Ctrl+Alt+Del options (lock, switch user, task manager) via GPO
  - Disable Win+L (lock) to prevent reaching the login screen
  - Disable Windows Ink workspace, Cortana/Copilot, notification center
  - Remove the on-screen keyboard's "Fn" / "Options" key behaviors or use the **touch keyboard** (TabTip) not OSK with Win key access
  - Hide the taskbar and set autohide off
- At the Electron level: intercept `before-input-event` and swallow F11, Ctrl+W, Ctrl+R, Ctrl+Shift+I (devtools), F12, Alt+F4, Ctrl+N, Ctrl+T. Disable `webContents.openDevTools` entirely in production builds.
- Physically: the Deka reader is USB HID = keyboard. If someone unplugs it and plugs in a real keyboard, they have Ctrl+Alt+Del. Consider physical port blocking (USB port blockers) or BIOS-level USB whitelist if the OEM BIOS supports it.
- **Test the breakout list from the `kiosk-mode-breakout` repo against your own kiosk before calling it done.** Every item. Every time you ship a Windows update.
- Admin PIN exit (Ctrl+Shift+F12) should be swallowed everywhere else and only pass through to your own handler; make sure Shell Launcher / GPO doesn't intercept it first.

**Warning signs:**
- Anything other than your app visible in a support screenshot
- Taskbar peeked even briefly
- Log shows unexpected blur/focus events on the Electron window
- Member discovers a way out and posts it (this has happened; it goes viral)

**Phase to address:**
OS hardening phase — must happen before customer release. Electron-level kiosk flags are necessary but NOT sufficient; if the phase planning only lists "set kiosk: true", the phase is under-scoped.

---

### Pitfall 8: MutationObserver + React re-render infinite loop / CPU pegged at 100%

**What goes wrong:**
The `hideDynamicElements` observer listens on `document.body` with `{ childList: true, subtree: true }`. Every time it hides an element via `style.setProperty('display','none','important')`, that's a DOM mutation, which fires the observer again. If React re-renders that element (restoring the style), you loop: React re-adds → observer hides → React re-renders with new props from state → observer hides again. On a low-end Chinese OEM POS CPU this shows up as fan noise, touchscreen lag, and batteries getting warm before it's noticeable visually.

**Why it happens:**
Observers that mutate the DOM they're observing without guarding are a classic footgun. Worse: MUI components often use refs and will re-assert their own styles on every render, meaning your hide sticks for one frame then gets overwritten.

**How to avoid:**
- Never set `style` directly. Use `insertCSS` with `!important` rules — these live outside the DOM tree and don't trigger mutation events.
- If you *must* set `display:none` via JS (e.g. for the text-matched "Rabatt" button), add a **stable marker class** (`bsfpos-hidden`) and a stylesheet rule `.bsfpos-hidden { display: none !important }`. Then your mutation check is "does it have the marker class?" — setting the class on an element that already has it is a no-op and doesn't re-trigger.
- Throttle/debounce the observer callback (50–100ms). Magicline re-rendering 200 times a second on its own business is fine; responding 200 times is not.
- Scope the observer tightly: observe a specific subtree (the main content area) once you've found it, not the whole body.
- Monitor CPU usage of the renderer process during a 10-minute idle session; should be <5% on the target hardware. If it's 30%+, the observer loop is live.

**Warning signs:**
- Renderer process CPU >20% at idle
- Touchscreen input lag
- Device fan audible
- Observer callback fires >10Hz during idle

**Phase to address:**
Injection phase. Ties into Pitfall 1 (selector strategy) and Pitfall 2 (insertCSS persistence).

---

### Pitfall 9: Auto-update on a long-running process leaks resources and the kiosk drifts over weeks

**What goes wrong:**
Kiosk boots once, runs for 47 days. Chromium's renderer accumulates detached DOM nodes from MutationObservers, service worker registrations, unreleased Blob URLs. Memory creeps from 300MB to 2.8GB. At some point a Magicline route change OOMs the renderer. `render-process-gone` handler reloads. But the main process has also leaked listeners from an unclosed IPC channel or a stale setTimeout chain from the first-day auto-login. Reload succeeds but now the idle timer fires twice. Classic "it works in a demo, falls apart after two weeks."

**Why it happens:**
Always-on Electron processes are unlike desktop apps where "quit/relaunch" is the daily reset. Every resource lifecycle assumption that holds for a 3-hour session breaks for a 30-day session.

**How to avoid:**
- **Scheduled full restart**: once per day during maintenance window (e.g. 03:00), gracefully `app.relaunch() + app.exit(0)`. Cheap, effective, covers every leak you didn't plan for.
- Monitor main + renderer process memory via `process.getProcessMemoryInfo()` / `webContents.getProcessMemoryInfo()`; log daily, alert if private memory grows >50% day-over-day.
- Every `setInterval`/`setTimeout` goes in a registry that the reset logic clears. Every `on(...)` event listener has a matching cleanup.
- Never leave `console.log`s that stringify large DOM nodes in production — they hold references.
- On `render-process-gone` reload: also reset all main-process timers, not just the renderer.

**Warning signs:**
- Memory usage trending up day-over-day
- Reset timer firing twice per idle (duplicate listeners)
- First unexpected crash after N weeks of uptime with no code change

**Phase to address:**
Reliability/long-running phase. Can be deferred to after first launch but must happen before the first multi-week deployment.

---

### Pitfall 10: "Logged out by Magicline" invisible state — session expires server-side, kiosk shows login form to the next member

**What goes wrong:**
Magicline expires the session after N hours of inactivity or because of a server-side policy change. The next member taps a badge. The badge buffer commits, tries to `setMuiValue` on `[data-role="customer-search"] input`, but the element doesn't exist — the page now shows the login form. The member sees an email/password form they can't fill in. Or worse: the customer-search element exists in a DOM far from the login form because of a stale rendered route, and the badge UID appears in an email field.

**Why it happens:**
Auto-login is only triggered on app start in a naive implementation, not on "we're unexpectedly back at the login page". The injection script doesn't know the URL changed out from under it.

**How to avoid:**
- Auto-login must be **reactive** to URL/DOM state, not one-shot on boot. Observe: "is there a `[data-role="username"]` on the page right now?" → if yes, run login flow.
- Detect logout by URL (`/#/login` or similar) and by DOM (presence of login form). Treat either as a trigger.
- Before every badge-buffer commit, verify the target input exists AND the URL indicates cash-register. If not, drop the buffer and log.
- Periodically ping Magicline's app state (a cheap observer on URL hash changes + DOM): this is a cheap correctness check.
- On detecting logout mid-session, log it with cause if possible, and run the same reset flow (with credentials) as idle.

**Warning signs:**
- Log shows badge commit attempted with target input missing
- URL hash changes unexpectedly
- Member reports "I scanned and the email keyboard came up"

**Phase to address:**
Auto-login phase. The login flow must be a state machine, not a startup script.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| Hardcode fragile `.css-xxxxx` selectors inline in inject.js | Ships faster | Every Magicline update becomes a production incident | Only in Phase 0 spike; must be refactored before first release |
| Inject CSS only in `did-finish-load` | One-liner | Flash-of-unhidden-UI on every reset, customer can tap sidebar during flash | Never for customer-visible release |
| `session.clearStorageData()` fire-and-forget without awaiting | Simpler reset code | Intermittent half-logged-in state, cross-member cart bleed | Never |
| Badge capture via renderer keydown listener only | Simpler, all logic in one file | Lost keystrokes on focus flicker, eaten first characters | Prototype only |
| `kiosk: true` alone, no OS-level lockdown | Works on dev laptop | Trivially breakable on deployed device | Never for production |
| Auto-update check + install on a naive timer | Zero-config | Transaction interruption mid-sale | Never; always use safe-window gating |
| Store Magicline credentials in `.env` or `localStorage` | Easy dev setup | Plaintext credentials on disk, visible to anyone with touchscreen + admin exit | Never; user requirement explicitly forbids it |
| Single MutationObserver on `document.body` with `subtree: true` and no debounce | Catches everything | CPU pegged, touchscreen lag | Only with debounce + marker-class guard |
| Rely on `document.activeElement` for badge routing | Uses current code as-is | Races against React re-render focus changes | Never; route by URL/modal state |
| Log everything to a single file forever | Simple | Disk fills up eventually, RDP session slow to open | Never; use rotation from day one |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| Magicline SPA routing | Assume `did-finish-load` covers all navigation | Also handle `did-navigate-in-page` for hash routes and `did-frame-finish-load` |
| Magicline MUI inputs | `input.value = 'x'` (DOM) | `HTMLInputElement.prototype` value setter + dispatch `input`+`change`, already in prototype — keep it |
| Magicline session cookies | Clear cookies then reload immediately | `about:blank` → `clearStorageData` (await) → `flushStore` (await) → reload |
| Magicline login form | Assume selectors stable forever | They're stable TODAY; add a self-check that logs if `[data-role="username"]` ever disappears |
| Deka USB HID reader | Assume it behaves like a text field with a human at it | Timing-based HID detection at main process level via `before-input-event` |
| Windows safeStorage | Assume DPAPI key is forever | Fallback re-entry flow for decrypt failure is mandatory |
| electron-updater GitHub Releases | Assume `autoDownload` + `quitAndInstall` is fine | Gate install behind safe-window state machine tied to session-reset lifecycle |
| GitHub Releases | Publish unsigned Windows builds | Code-sign (or at minimum, document the SmartScreen warning acceptance procedure for first install) — unsigned auto-updates also get blocked by SmartScreen in some configs |
| Electron `kiosk: true` | Assume it prevents OS breakout | Layer with Shell Launcher / Assigned Access + GPO hardening |
| Windows auto-start | `app.setLoginItemSettings` and assume it runs before login | Use a dedicated auto-logon account (HKLM Winlogon DefaultUserName / AutoAdminLogon) + login item; BOTH |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Unthrottled MutationObserver on `document.body` subtree | Renderer CPU ≥20% at idle, fan audible | Debounce 50–100ms, scope tightly, use marker classes | Immediately on low-end OEM POS hardware |
| Detached DOM nodes accumulating across Magicline re-renders | Memory climb over days | Daily scheduled `app.relaunch()`, no JS references holding DOM nodes | After ~1 week uptime |
| `executeJavaScript` returning large objects back to main | Main process memory climb | Only return primitives / small JSON; no DOM node references | After first week |
| Log file growing unbounded | Disk fills, app hangs on write | `winston` / `electron-log` with size-based rotation, cap at ~50MB total | After 1–3 months |
| `insertCSS` called on every observer tick | CSS rules accumulate (returned keys not removed) | Call `insertCSS` once per document; store returned key for removal if needed | After a few hours of repeated re-injection |
| Idle overlay using CSS animations running forever at 60fps | GPU usage, fan | Pause animations when overlay hidden, use `visibility: hidden` + `animation-play-state: paused` | Always-on immediately |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| Admin PIN hardcoded in source | Anyone with the GitHub repo knows the exit code | PIN stored alongside credentials in safeStorage, set at install time |
| Admin PIN compared with `==` allowing timing attack | Low-ish (touchscreen = slow) but still | Constant-time compare; or just lock out after 3 wrong attempts for 5 min |
| Magicline credentials logged on auto-login failure | Plaintext in log file, accessible via RDP by anyone | Never log credentials, even on error; log `login-failed` with reason only |
| `webSecurity: false` or `contextIsolation: false` in BrowserWindow | Third-party Magicline scripts get Node access; supply-chain exposure | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the Magicline webContents |
| `executeJavaScript` with user-controlled strings | Injection | Only ever inject static strings from bundled files, never interpolate runtime values |
| DevTools left enabled in production build | Customer (or ex-employee) opens with Ctrl+Shift+I, pastes arbitrary JS | Disable `openDevTools`; trap `Ctrl+Shift+I`/`F12` in `before-input-event` |
| RDP/TeamViewer using weak password because "it's internal" | Remote compromise path into the kiosk and from there any member data Magicline shows | Strong password, RDP only via VPN or TeamViewer unattended access with 2FA |
| Crash log contains Magicline DOM snapshot with member PII | Log file leaks member names, membership numbers | Scrub logs: never dump DOM text content, log structural info only |
| Unencrypted backup of safeStorage blob copied to git | Repo leaks live encryption blob | Add the app-data directory explicitly to `.gitignore`, never commit |
| Trusting `keydown` event source | A USB rubber ducky plugged into the kiosk can type anything | Physical USB blocker on the Deka port, BIOS USB whitelist if available |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| Generic Electron splash "Loading..." between reset and auto-login | Member sees Electron branding, not Bee Strong | Branded fullscreen overlay owned by the app, visible until `cash-register-ready` confirmed |
| Flash of unhidden Magicline UI on reload (Pitfall 2) | Member sees sidebar/topbar they shouldn't | Preload-time hide + branded cover during navigation |
| "Are you still there?" overlay that requires reading German text to dismiss | International member hesitates, timer runs out, cart lost mid-checkout | Large tappable "Weiter" / "Continue" button, language-neutral icons |
| Idle countdown too fast (e.g. 10s) | Member typing their pin / thinking is reset | 30s minimum, reset on any pointer event |
| Idle countdown too slow (>60s) | Next member walks up to previous member's partial cart | Tune on-site; 30s overlay + 30s countdown is a reasonable start |
| No feedback on badge scan | Member scans, nothing visibly changes, scans again | Short haptic-equivalent (subtle animation) on `cash-register-ready` → customer field populated |
| Error state shows raw Magicline error text | Member sees German DevOps-speak | Catch known errors, show branded "Bitte beim Personal melden" card |
| Admin exit PIN prompt looks identical to a login form | Curious member tries random PINs | Clearly-branded admin screen with warning, wrong-PIN lockout |
| Magicline payment flow requires scrolling on small screen | Member can't find pay button | Verify viewport at target resolution, inject CSS to pin critical buttons |
| Auto-update happens, member arrives during 30s blank | "Broken kiosk" perception | Show branded updating screen with progress |

---

## "Looks Done But Isn't" Checklist

- [ ] **CSS injection:** Persists across logout redirect, session expiry, `clearStorageData` + reload, `render-process-gone` reload, and update-restart — test all five paths
- [ ] **Auto-login:** Works when session expires server-side mid-session (not only on boot); works when the kiosk reconnects to WiFi after an outage
- [ ] **Idle reset:** Customer field is *empty* after reset (verify in DOM, not just visually); no stale cart items; previous session's cookies gone (verify via `cookies.get`)
- [ ] **Badge capture:** First character of scan not dropped; works when a Magicline modal is open; works when the product search field is focused; 10 consecutive scans all commit correctly
- [ ] **safeStorage:** Decryption failure on boot shows the credential re-entry flow, not a crash
- [ ] **Kiosk lockdown:** Every item from `github.com/ikarus23/kiosk-mode-breakout` fails on the deployed device
- [ ] **Auto-update:** Update installed during a live transaction does NOT interrupt it (hint: it must not be *able* to; verify the safe-window gate)
- [ ] **Long-running:** 7-day uptime test with simulated idle cycles shows flat memory, no duplicate timers, no CPU climb
- [ ] **Logs:** Rotate at a fixed size, don't contain credentials, don't contain member PII, are readable via RDP, include every state transition
- [ ] **Crash recovery:** Kill the renderer with Task Manager → app recovers, auto-login re-fires, customer field is empty
- [ ] **Admin exit:** PIN prompt cannot be dismissed by breakout; wrong PIN locks out; correct PIN actually drops kiosk mode
- [ ] **Power loss:** Pull the plug mid-transaction → reboot → kiosk comes up cleanly, not stuck at Windows login or at a half-updated NSIS screen
- [ ] **Windows Update:** A forced Windows Update reboot during the gym night hours results in the kiosk coming back up, not stuck on "Configuring updates"

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Fragile selectors broke after Magicline update (Pitfall 1) | LOW | RDP in → inspect live DOM → update `fragile-selectors.js` → push new GitHub Release → wait for auto-update window |
| Flash of unhidden UI discovered post-launch (Pitfall 2) | LOW | Add preload-time cover overlay, ship patch |
| Infinite auto-login loop (Pitfall 3) | MEDIUM | RDP in, admin exit, manually log in, patch state machine with loop detection |
| safeStorage decryption failure (Pitfall 4) | LOW if fallback exists, HIGH if not | With fallback: enter credentials on kiosk. Without: RDP in, delete cred file, manually re-register |
| Mid-transaction update restart (Pitfall 5) | MEDIUM (member trust) | Refund/re-run the failed sale manually, ship hotfix gating update behind safe-window |
| Lost badge characters (Pitfall 6) | LOW | Ship patched HID capture; compensate by re-scanning |
| Breakout discovered by customer (Pitfall 7) | HIGH (reputational) | Shell Launcher + GPO hardening pass, full breakout re-test, patch, communicate with owner |
| CPU/memory leak (Pitfalls 8, 9) | LOW | Enable scheduled daily restart, ship in next update |
| Magicline logout stuck state (Pitfall 10) | LOW | Patch auto-login to be reactive; RDP-triggered manual reload as workaround |

---

## Pitfall-to-Phase Mapping

Suggested phase names — the roadmap phase can rename these, but the **ordering** matters because Pitfall N often depends on Pitfall N-1 being solved first.

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| 1: Fragile MUI selectors | Injection & Drift Isolation | Self-diagnosis logs zero matches warning; fragile-selectors file has a single home |
| 2: CSS not persistent across nav | Injection & Drift Isolation | Manual test: 5 reload paths, no FOUUI visible on any |
| 3: Idle reset ↔ auto-login race | Session Lifecycle State Machine | 100 simulated reset cycles, zero half-logged-in states; loop-detection fires on induced bug |
| 4: safeStorage bricking | Credentials & Admin | Force a decrypt failure, observe re-entry flow; integrity marker check works |
| 5: Auto-update interrupting transaction | Auto-Update (must follow Session Lifecycle) | Update triggered during simulated transaction is deferred until safe window |
| 6: NFC HID lost characters | NFC Input Capture | 50 real scans logged at main-process level; first-character-drop bug absent |
| 7: Windows kiosk breakout | OS Hardening | Full `kiosk-mode-breakout` checklist passes on the deployed device |
| 8: MutationObserver CPU loop | Injection & Drift Isolation (alongside 1, 2) | Renderer CPU <5% at idle over 10 minutes |
| 9: Long-running resource leaks | Reliability & Long-Running | 7-day test shows flat memory; scheduled restart logged |
| 10: Magicline server-side logout | Session Lifecycle State Machine (alongside 3) | Force server-side logout, auto-login recovers without member action |

**Phase ordering implication:**
Session Lifecycle State Machine must exist **before** Auto-Update phase (Pitfall 5 depends on Pitfall 3's state signals). Injection & Drift Isolation must exist **before** first customer release (Pitfalls 1, 2, 8). OS Hardening must exist **before** first customer release (Pitfall 7). NFC Input can be parallel to Injection work but must be validated on real hardware before launch (Pitfall 6).

---

## Sources

- [Electron safeStorage API documentation](https://www.electronjs.org/docs/latest/api/safe-storage) — HIGH confidence, authoritative
- [Electron issue #42318: Improve safeStorage documentation](https://github.com/electron/electron/issues/42318) — limitations discussion, MEDIUM-HIGH
- [Electron issue #34614: safeStorage use invalid prior to BrowserWindow](https://github.com/electron/electron/issues/34614) — HIGH
- [Microsoft: DPAPI MasterKey backup failures](https://learn.microsoft.com/en-us/troubleshoot/windows-server/certificates-and-public-key-infrastructure-pki/dpapi-masterkey-backup-failures) — DPAPI key invalidation on password reset, HIGH
- [Electron issue #9776: cookies after clearStorageData](https://github.com/electron/electron/issues/9776) — MEDIUM
- [Electron issue #15928: clearCookies removes all session data](https://github.com/electron/electron/issues/15928) — MEDIUM
- [Electron issue #18585: clearStorageData crash with caching disabled](https://github.com/electron/electron/issues/18585) — MEDIUM
- [Electron issue #24130: clearStorageData doesn't clear localStorage](https://github.com/electron/electron/issues/24130) — MEDIUM
- [electron-builder issue #1589: update on quit rather than restart](https://github.com/electron-userland/electron-builder/issues/1589) — kiosk update restart concern, HIGH
- [electron-builder issue #7785: auto-restart issue Windows 10](https://github.com/electron-userland/electron-builder/issues/7785) — HIGH
- [electron-builder issue #8436: inconsistent auto-update behavior](https://github.com/electron-userland/electron-builder/issues/8436) — MEDIUM
- [MUI: How to customize — hashed class name instability](https://mui.com/material-ui/customization/how-to-customize/) — authoritative on selector stability, HIGH
- [Microsoft: Configure a Single-App Kiosk with Assigned Access](https://learn.microsoft.com/en-us/windows/configuration/assigned-access/configure-single-app-kiosk) — HIGH
- [Microsoft: Prepare a device for kiosk configuration Windows 10/11](https://learn.microsoft.com/en-us/windows/configuration/kiosk-prepare) — HIGH
- [Deep Dive into Windows 11 Kiosks Part 1: Assigned Access (mobile-jon, Jan 2025)](https://mobile-jon.com/2025/01/15/deep-dive-into-windows-11-kiosks-part-1-assigned-access/) — MEDIUM-HIGH, recent
- [Hexnode: Windows kiosk security hardening best practices](https://www.hexnode.com/blogs/hardening-windows-kiosk-mode-security-best-practices-for-enterprise-protection/) — MEDIUM
- [kiosk-mode-breakout (ikarus23/GitHub)](https://github.com/ikarus23/kiosk-mode-breakout) — canonical breakout techniques list, HIGH for threat model
- [l-trondirect: Barcode scanner interfaces — keyboard wedge focus dependency](https://www.l-trondirect.com/blog/barcode-scanners-a-comparison-of-serial-keyboard-wedge-and-usb-interfaces/) — MEDIUM
- [NI forum: HID reader text entry without input focus](https://forums.ni.com/t5/LabVIEW/Barcode-Reader-USB-HID-Interface-text-entry-without-Window/td-p/1129733) — MEDIUM, illustrates focus dependency
- Internal: `BeeStrong_POS_Kiosk_Project.md` — Android prototype, known-fragile selectors, Magicline `data-role` inventory, current HID timing logic (including latent first-character bug)
- Internal: `.planning/PROJECT.md` — Active requirements, constraints, key decisions

---
*Pitfalls research for: Electron Windows kiosk wrapping Magicline SaaS*
*Researched: 2026-04-08*
