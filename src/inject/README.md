# src/inject/ — Magicline Drift Patch Blast Radius

## The Contract

**When Magicline breaks after an update, edit ONLY files in this directory.**
**Never edit `src/main/` in response to a Magicline drift incident.**

This directory is the single blast radius for Magicline DOM drift. The main process in `src/main/magiclineView.js` reads these files as raw strings and injects them into the Magicline child view via `webContents.insertCSS` and `webContents.executeJavaScript`. It never cares about their content — it just ships them.

## Files

- **`inject.css`** — Stable `[data-role=...]` hide rules (top section) + fragile MUI `css-xxxxx` hide rules (bottom section). Passed to `webContents.insertCSS`. Duplicates the fragile selector strings from `fragile-selectors.js` — keep both in sync when patching.
- **`inject.js`** — Dynamic element hiding (Rabatt button by text, discount icon by SVG path), MUI React-native value setter, boot-time selector self-check, scoped MutationObserver, cash-register-ready detection. Concatenated with `fragile-selectors.js` and passed to `webContents.executeJavaScript` in the main world.
- **`fragile-selectors.js`** — The single source of truth for drift-prone selectors. A plain JS fragment (NOT a CommonJS module) that declares `var FRAGILE_SELECTORS = [...]` and `var STABLE_SELECTORS = [...]`. Prepended to `inject.js` at runtime so those arrays are in scope for the self-check.

## Drift Response Playbook

1. A drift incident surfaces as a `magicline.drift:` warning in `%AppData%/Bee Strong POS/logs/main.log` and a branded "Kasse vorübergehend nicht verfügbar" overlay on the kiosk.
2. RDP into the kiosk → admin exit (Phase 5) → open DevTools on the Magicline child view.
3. Inspect the broken UI element. Find the new selector. Prefer a structural or text-based match (more stable) over another `css-xxxxx` (guaranteed to drift again).
4. Edit ONLY files in this directory:
   - Update the selector in `fragile-selectors.js` (for the self-check).
   - Update the matching CSS rule in the FRAGILE section of `inject.css` (for the hide pass).
5. Tag a patch release. `electron-updater` ships it to the kiosk on next boot.
6. PR review: the diff MUST be limited to `src/inject/`. Any change outside this directory on a drift-patch PR is a red flag — reject the PR.

## What NOT to put here

- Main-process code (BrowserWindow / WebContentsView / IPC wiring) — that is `src/main/magiclineView.js` and is off-limits during drift response.
- Credentials, env vars, or any secret — the inject scripts run in Magicline's main world and are not privileged.
- `require()` calls — the main world has no Node API.
