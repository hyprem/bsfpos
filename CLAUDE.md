<!-- GSD:project-start source:PROJECT.md -->
## Project

**Bee Strong POS Kiosk**

A self-service POS kiosk app for Bee Strong Fitness gym. It runs on a single Windows-based POS terminal and wraps the Magicline cloud cash register web UI in a locked-down Electron shell, so gym members can buy products themselves by scanning their NFC badge — using Magicline's existing web interface as the backend without any custom POS logic of our own.

**Core Value:** A gym member can walk up, scan their badge, have a product scanned (or self-selected), pay, and walk away — without any staff interaction and without ever seeing or being able to break out of the locked Magicline cash register page.

### Constraints

- **Tech stack**: Electron (latest stable), Node, HTML/CSS/JS — chosen because the existing prototype JS ports directly and `insertCSS`/`executeJavaScript` survive React re-renders
- **Target OS**: Windows on the existing dual-boot POS terminal — no new hardware, just reboot from Android side
- **Backend**: Magicline SaaS at `bee-strong-fitness.web.magicline.com` — we don't control it; selectors and behavior may shift on Magicline updates
- **Hardware**: Touchscreen kiosk in vertical/tablet orientation; Deka NFC reader as USB HID keyboard wedge (no SDK)
- **Devices**: Exactly one device — no multi-tenant abstractions
- **Budget**: Self-built; no recurring SaaS costs (no Sentry, no hosted update server). Auto-update via free GitHub Releases
- **Security**: Magicline credentials must never be stored plaintext on disk; use Windows DPAPI via Electron `safeStorage`. Hidden admin exit must require a PIN
- **Reliability**: Must auto-recover from crashes, idle timeouts, and Magicline session expiry without staff intervention — staff visit for maintenance only
- **Maintenance**: Remote access via RDP/TeamViewer; no local debugging UI other than the hidden admin exit
- **Magicline drift**: Fragile MUI `css-xxxxx` selectors will break on some Magicline updates — design must isolate them so they're easy to re-verify and update
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## TL;DR — Prescriptive Stack
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Electron** | `^41.1.1` (latest stable, Mar 2026) — pin to `~41.x` | Chromium runtime that hosts the Magicline page and exposes `insertCSS` / `executeJavaScript` / `session` / `safeStorage` | The entire project decision hinges on `webContents.insertCSS` being engine-level (survives React re-renders) and `safeStorage` being built-in. Electron 39–41 are the currently supported stable lines; 41 is the newest. Pin to the minor so `electron-updater` protocol, Chromium version, and your CSS selector assumptions stay stable between builds. |
| **Node.js** | `>=20.18 LTS` (matches Electron 41's bundled Node) | Main-process runtime | Only relevant for the build host and any small native tooling — production Node is whatever Electron bundles. Use Node 20 LTS on the build machine; avoid 22 unless Electron 41 explicitly bundles it. |
| **Plain HTML/CSS/JS** for owned overlays (idle "still there?", PIN prompt, error/login screen) | — | Branded UI surfaces the kiosk itself renders (not Magicline content) | These overlays are 3–5 static screens with a countdown and a PIN input. A bundler + framework would be pure ceremony. Static HTML loaded via `BrowserView`/second `BrowserWindow` or injected as an in-page overlay `<div>` is simpler, has zero build step, and ports directly from the existing prototype mindset. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **electron-builder** | `^26.8.1` | Build + package the Windows NSIS installer, generate `latest.yml` metadata that `electron-updater` consumes | Standard packager in the Electron ecosystem; its `nsis` target is the Windows default and integrates natively with `electron-updater` + GitHub Releases publisher. Use the `nsis` target (not `nsis-web`) so the installer is a single `.exe` users can sideload onto the kiosk over RDP. |
| **electron-updater** | `^6.8.3` | Check GitHub Releases on boot, download + apply updates, restart | Part of the `electron-builder` family, consumes the `latest.yml` that the builder publishes. With `provider: github` and a public repo there is zero infra to host — exactly the "no recurring SaaS costs" constraint in PROJECT.md. Call `autoUpdater.checkForUpdatesAndNotify()` in `app.whenReady()`. |
| **electron-log** | `^5.2.x` | Rotating file logs for badge scans, sales, idle resets, login events, update events, errors | Zero-dependency, built-in file rotation via `maxSize` (default 1 MB, old file becomes `main.old.log`). Writes to `%AppData%/Bee Strong POS/logs/` so it's accessible over RDP without a debug UI. Install as a transport for `console` + a dedicated `events` transport for audit-style lines. v5 requires Electron 13+, trivially satisfied. |
| **Electron `safeStorage` API** | built-in (Electron core) | DPAPI-encrypted Magicline username + password at rest | **Built into Electron** — no extra dependency, no native compilation. On Windows it uses DPAPI with the current user's logon credential as key, which exactly matches the "only this Windows user can decrypt" requirement. Call `safeStorage.isEncryptionAvailable()` before first write; persist the ciphertext as a base64 string inside `electron-store`. |
| **electron-store** | `^10.1.x` (CommonJS-compatible line) | Non-secret config: the `safeStorage` ciphertext blob, admin PIN hash, last-known Magicline URL, idle timeout overrides, "first run complete" flag | Simple JSON persistence in `app.getPath('userData')`, schema validation, atomic writes. **Version note:** electron-store `11.x` is ESM-only and requires Electron 30+. Because this project is single-file `main.js` CommonJS, **pin to `^10.1.x`** to avoid a forced ESM migration. If/when the project moves to `"type": "module"`, bump to `^11.0.2`. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| **npm** (bundled with Node 20) | Package management | No need for pnpm/yarn on a single-dev project. Commit `package-lock.json`. |
| **electron** (devDep) | Local `electron .` runs | Install as `devDependencies` — `electron-builder` will bundle the matching runtime. Never list `electron` under `dependencies`. |
| **@electron/rebuild** | Only if a native module sneaks in later | **Not needed for the recommended stack** (no `keytar`, no `node-hid`). Listed here only so you know what to reach for if scope creeps. |
| **GitHub Actions** (free tier) | CI to build + publish the NSIS installer to GitHub Releases | `electron-builder --win --publish always` with a `GH_TOKEN` secret. One workflow file on tag push. |
| **EditorConfig + Prettier** | Consistency | Optional, taste-level. Skip for velocity. |
## Installation
# Project bootstrap
# Runtime (all are dependencies — bundled into the app package)
# Electron itself + packager are devDependencies
### Minimum `package.json` build block
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Electron 41** | Tauri 2.x / Microsoft Edge WebView2 / native C# host | Never, for this project. PROJECT.md has already explicitly rejected these — and rightly so: Tauri uses the system WebView2, which reintroduces exactly the "WebView version drift" pain the Android prototype hit. Edge WebView2 does not expose an equivalent of `insertCSS`/`executeJavaScript` as a first-class, survive-re-render primitive. |
| **`safeStorage` (built-in)** | `keytar` | **Never.** `keytar` is **archived and unmaintained since Dec 2022**, VS Code and Element have both migrated off it, and it requires native compilation. Only reach for it if you need credentials accessible to *other* processes on the same machine (we don't). |
| **`electron-builder` NSIS** | Squirrel.Windows / `update-electron-app` / MSIX | Squirrel is the older default and has rough edges with per-user installs; `update-electron-app` is a thin wrapper that needs an update.electronjs.org feed (extra infra); MSIX requires Microsoft Store signing overhead. `electron-builder` + GitHub Releases is the path with the least infra and the cleanest Release → Install → Auto-update loop. |
| **`electron-updater` → GitHub** | Self-hosted update server (Hazel, Nuts) | Only if the repo must be private AND you don't want to embed a PAT. For a public single-tenant kiosk, GitHub Releases is strictly better. |
| **`electron-log`** | `winston` + `winston-daily-rotate-file` | Winston is fine but adds a dependency tree and has known quirks with Electron packaging + log rotation maxFiles. `electron-log` is purpose-built, zero-dep, and rotates correctly. |
| **`electron-store` 10.x (CJS)** | `electron-store` 11.x (ESM) | Bump only if you adopt `"type": "module"` in `package.json`. Not worth the disruption for a single-file main process. |
| **`electron-store`** | `conf` directly | `electron-store` **is** `conf` with the Electron userData path wired up. Use `electron-store` — same library, less setup. |
| **Plain HTML overlays** | React + Vite / Svelte + Vite for overlays | Only if overlays grow beyond ~5 screens or need real component state. For the current requirement set (idle overlay, PIN prompt, error/login-in-progress) plain HTML + one CSS file is faster and has zero build step to maintain. |
| **USB HID as keyboard wedge** (no library) | `node-hid` | **Never, unless the wedge breaks.** The Deka reader is confirmed-working as a HID keyboard wedge in the prototype — keystrokes arrive in `document.addEventListener('keydown', …)` for free. `node-hid` requires native compilation per Electron ABI and hand-parsing raw report descriptors. Adding it is a rewrite for zero user-visible benefit. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`keytar` / `node-keytar`** | Archived Dec 2022, unmaintained, native compilation, fails on recent Electron major bumps. VS Code, Element, CheckerNetwork all migrated off it. | Electron built-in `safeStorage` (DPAPI on Windows). |
| **`node-hid`** | Native module (per-Electron-version rebuilds via `@electron/rebuild`), brittle permission model on Windows, no added value since the reader is already a HID keyboard wedge emitting keystrokes into the focused `<input>`. | Capture `keydown` events in the injected JS; use `<50 ms` inter-key timing (already proven in the Android prototype) to distinguish badge scans from human typing. |
| **`robotjs` / `@nut-tree/nut-js` for input simulation** | Native compilation, privilege issues, the PROJECT.md explicitly decided against key/tab simulation in favor of selector-based React-native value setters. | `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` + `dispatchEvent('input'/'change')` — already proven against the live Magicline UI. |
| **React / Vue / Svelte for the kiosk shell** | The "app" is a thin wrapper around a third-party React app. A second React runtime for 3 overlay screens is pure ceremony, adds a bundler, and obscures the injection code. | Plain HTML/CSS/JS files loaded via `mainWindow.loadFile()` or rendered as injected overlay `<div>`s. |
| **Webpack / Vite / esbuild for the main process** | `main.js` is CommonJS and runs in Node — no bundling needed. Source maps across a bundled main process complicate crash debugging over RDP. | Ship `main.js`, `preload.js`, `inject.js`, `inject.css` as-is. |
| **TypeScript (initial)** | Adds a build step and `.d.ts` dependencies for a ~500-line main process. Re-evaluate if the file grows beyond ~1500 lines or multiple contributors join. | JSDoc type annotations in plain `.js` — gets you most of the IDE help at zero build cost. |
| **Sentry / Bugsnag / any SaaS crash reporter** | PROJECT.md rules out recurring SaaS costs, and RDP access to `%AppData%/Bee Strong POS/logs/` is sufficient for a single device. | `electron-log` with a rotating file transport + a dedicated `audit.log` for sales/badge events. |
| **`electron-reload` / `electron-reloader`** | Dev-convenience only; has caused packaging surprises when accidentally shipped. Just `Ctrl+C` + `npm start` during development. | Nothing. |
| **`auto-launch` npm package** | Reinvents what Electron already exposes. | `app.setLoginItemSettings({ openAtLogin: true, name: 'Bee Strong POS' })` in main process, fallback to the NSIS installer's Startup shortcut. |
| **Custom Chromium flags to "disable all shortcuts"** | Doesn't catch OS-level shortcuts (Win+D, Win+Tab, Ctrl+Alt+Del). | Combine `kiosk: true` + `globalShortcut.register` for specific combos (Alt+F4, Ctrl+W, F11) + Windows kiosk account / AssignedAccess for OS-level lockdown. Document explicitly that **Ctrl+Alt+Del cannot be trapped** from userspace — that's a Windows security guarantee, handled via a locked-down Windows user account at the OS layer. |
## Stack Patterns by Variant
- **Do not** silently fall back to plaintext. PROJECT.md forbids plaintext credentials.
- Show the branded error overlay, log `safestorage_unavailable` to `audit.log`, refuse to auto-login, and require admin PIN entry to re-try.
- Root cause is almost always: first launch under a different Windows user than where credentials were originally encrypted. Document this in the admin runbook.
- Do not ship a new Electron build. Selectors live in `inject.css` / `inject.js` — hot-fix them in the repo, tag a patch version, `electron-updater` pushes it to the kiosk within one boot cycle. This is the core reason auto-update is non-optional.
- Then (and only then) adopt **Svelte + Vite** for the overlay layer, build to a single `overlay.html` + `overlay.js` loaded from disk. Svelte over React because smaller runtime, no VDOM re-render surprises, compiles to plain DOM — philosophically consistent with "injection over frameworks." Still keep `main.js` and the Magicline-side injection in plain JS.
- Switch `electron-updater` from the public `github` provider to the `generic` provider pointed at a self-hosted static host (Cloudflare R2 + a 10-line worker, or a GitHub Pages site fed by a private-repo Action that copies releases across). Avoid embedding GitHub PATs in the client — that is the failure mode of electron-builder issue #2314.
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `electron@41.x` | `electron-builder@26.8.x` | 26.x is the current line and supports the latest Electron releases. |
| `electron@41.x` | `electron-updater@6.8.x` | Same family as `electron-builder`; versions track together. |
| `electron@41.x` | `electron-log@5.2.x` | v5 requires Electron 13+ / Node 14+. Satisfied. |
| `electron@41.x` | `electron-store@10.1.x` (CJS) | Use 10.x while `main.js` stays CommonJS. |
| `electron@41.x` | `electron-store@11.0.2` (ESM) | Requires Electron 30+ AND `"type": "module"`. Skip for now. |
| `electron@41.x` | `safeStorage` API | Built-in since Electron 15, stable, DPAPI on Windows. |
| Node 20 LTS | Electron 41 build toolchain | Use Node 20 on the build host; Electron bundles its own Node for runtime. |
## Confidence Assessment
| Recommendation | Confidence | Basis |
|----------------|------------|-------|
| Electron 41 as runtime | HIGH | Confirmed against electronjs.org releases + endoflife.date |
| electron-builder 26.8.1 + NSIS | HIGH | Confirmed against npm + electron.build docs |
| electron-updater 6.8.3 + GitHub provider | HIGH | Confirmed against npm + electron.build auto-update docs |
| `safeStorage` over `keytar` | HIGH | keytar archived Dec 2022 (multiple authoritative migration issues cited: VS Code #185677, element-desktop #1947, CheckerNetwork #1656) |
| electron-log 5 | HIGH | Confirmed against megahertz/electron-log README + file transport docs |
| electron-store 10.x pin | HIGH | 11.x ESM-only break confirmed in release notes; project is CJS |
| Plain HTML overlays (no framework) | MEDIUM | Opinionated call based on requirement scope (≤5 screens) — re-evaluate if scope grows |
| No `node-hid` | HIGH | Reader confirmed as HID keyboard wedge in working Android prototype |
## Sources
- [Electron Releases](https://releases.electronjs.org/) — 41.1.1 stable confirmed (Mar 31, 2026)
- [Electron endoflife.date](https://endoflife.date/electron) — currently supported lines 39/40/41
- [electron-builder on npm](https://www.npmjs.com/package/electron-builder) — 26.8.1 latest
- [electron-builder NSIS target docs](https://www.electron.build/index.html) — Windows default target
- [electron-builder auto-update docs](https://www.electron.build/auto-update.html) — GitHub provider setup
- [electron-updater on npm](https://www.npmjs.com/package/electron-updater) — 6.8.3 latest
- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage) — DPAPI on Windows, per-user decryption
- [Freek Van der Herten — Replacing Keytar with safeStorage in Ray](https://freek.dev/2103-replacing-keytar-with-electrons-safestorage-in-ray) — migration pattern
- [VS Code issue #185677 — Move off of Keytar](https://github.com/microsoft/vscode/issues/185677) — evidence keytar is dead
- [element-desktop #1947](https://github.com/element-hq/element-desktop/issues/1947) — keytar deprecation
- [electron-log on npm](https://www.npmjs.com/package/electron-log) — v5 line
- [electron-log file transport docs](https://github.com/megahertz/electron-log/blob/master/docs/transports/file.md) — rotation via `maxSize`
- [electron-store on npm](https://www.npmjs.com/package/electron-store) — 11.0.2 ESM-only, pin to 10.x for CJS
- [electron-store releases](https://github.com/sindresorhus/electron-store/releases) — v11 ESM break
- [Electron kiosk mode issue #38286](https://github.com/electron/electron/issues/38286) — known keyboard shortcut escapes, mitigation patterns
- [Electron keyboard shortcuts docs](https://www.electronjs.org/docs/tutorial/keyboard-shortcuts) — `globalShortcut` + `before-input-event`
- [electron-builder #2314 — private repo updater](https://github.com/electron-userland/electron-builder/issues/2314) — cautionary note on PAT embedding
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
