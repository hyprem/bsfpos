---
phase: 6
slug: welcome-screen-lifecycle-redesign
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-14
---

# Phase 6 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Welcome-screen-as-resting-state lifecycle: new `#welcome-screen` host layer, `welcome:show/hide/tap` IPC surface, 10s idle countdown, `sessionReset` welcome-mode branch (6-storage wipe + view destroyed, no recreate), and cold-boot-to-welcome orchestration in `main.js`.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Host renderer ↔ main (IPC) | `welcome:show` / `welcome:hide` (main → host, callback-shaped via preload) and `welcome:tap` (host → main, fire-and-forget) | Control signals only; no credentials, PII, or session tokens |
| Main ↔ Magicline webContents | `createMagiclineView` / `destroyMagiclineView` lifecycle driven by welcome:tap and sessionReset welcome-mode | Magicline session state (cleared on welcome-mode reset via 6-storage wipe) |
| Preload contextBridge | `onShowWelcome` / `onHideWelcome` / `notifyWelcomeTap` entries exposed on `window.kiosk` | Callbacks only; no raw `ipcRenderer` leaked into host.js |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation / Evidence | Status |
|-----------|----------|-----------|-------------|----------------------|--------|
| T-06-01 | Tampering | `#welcome-screen` DOM | accept | host.html bundled in asar; no runtime HTML injection path; Magicline lives in separate webContents partition | closed |
| T-06-02 | Spoofing | `welcome:tap` IPC (renderer side) | mitigate | `src/main/preload.js:69-73` — callback-only `notifyWelcomeTap` uses `ipcRenderer.send` (fire-and-forget); sender validated main-side (T-06-12) | closed |
| T-06-03 | Elevation of Privilege | Preload contextBridge surface | mitigate | `src/main/preload.js:69-73` — only three callbacks added (`onShowWelcome`, `onHideWelcome`, `notifyWelcomeTap`); no raw `ipcRenderer` exposed to host.js | closed |
| T-06-04 | Denial of Service | Rapid welcome taps flooding main | accept | Single-user kiosk, physically rate-limited; main handler idempotent via `createMagiclineView` early-return | closed |
| T-06-05 | Information Disclosure | Welcome layer visible text | accept | CTA is brand copy only ("Zum Kassieren tippen") — no credentials, PII, or session identifiers | closed |
| T-06-06 | Tampering | `hardReset` `mode` parameter injection | mitigate | `src/main/sessionReset.js:77` — `mode = (mode === 'welcome') ? 'welcome' : 'reset'`; anything else silently becomes the safe Phase 4 default | closed |
| T-06-07 | Repudiation | Welcome resets hidden from loop counter | mitigate | `src/main/sessionReset.js:124` — `log.audit('idle.reset', { reason, count, mode })` fires on every reset including welcome-mode, before branch | closed |
| T-06-08 | Denial of Service | Fast-tapped welcome logout loop | accept | Physical tapping pace; welcome-mode reset self-paces at ~500ms Chromium `clearStorageData`; loop guard still catches non-welcome resets | closed |
| T-06-09 | Information Disclosure | Credentials/session surviving welcome logout | mitigate | `src/main/sessionReset.js:161-170` — welcome branch clears all 6 storages (cookies, localstorage, sessionstorage, indexdb, cachestorage, serviceworkers) + `cookies.flushStore()` at :173; harness `test/sessionReset.welcome-harness.test.js` asserts 6-storage wipe × 5 cycles | closed |
| T-06-10 | Elevation of Privilege | Stale Magicline listeners firing after welcome destroy | mitigate | `src/main/magiclineView.js:515-562` — `destroyMagiclineView` removes resize listener, `removeChildView`, `wc.close()`, nulls state (CR-01) | closed |
| T-06-11 | Tampering | Loop-counter filter misclassifying reset as welcome | mitigate | `src/main/sessionReset.js:104-106` — filter predicate requires BOTH `reason === 'idle-expired'` AND `mode === 'welcome'`; crashes and admin resets remain countable | closed |
| T-06-12 | Spoofing | `welcome:tap` IPC (main handler) | mitigate | `src/main/main.js:478-483` — `ipcMain.on('welcome:tap', (ev) => { if (ev.sender !== mainWindow.webContents) { log.warn; return; } … })`; Magicline child wc cannot spoof | closed |
| T-06-13 | Denial of Service | `welcome:tap` flood creating duplicate views | mitigate | `src/main/magiclineView.js:117-120` — `createMagiclineView` early-return if module state already set; `authFlow.start` safe to re-invoke (state-reseed) | closed |
| T-06-14 | Repudiation | Lost audit trail of login-session initiations | mitigate | `src/main/main.js:484` — `log.info('phase6.welcome:tap received — starting login flow')` records every tap | closed |
| T-06-15 | Information Disclosure | Credentials loaded into new wc per tap | accept | authFlow uses Phase 3 `safeStorage` decrypt path; credentials in process memory only for auto-fill duration; never touches disk plaintext | closed |
| T-06-16 | Tampering | `welcome:tap` fired before layers exist in DOM | mitigate | `src/main/main.js:467-471` — cold-boot `welcome:show` deferred via `isLoading() ? once('did-finish-load', …) : …`; host subscribes to `onShowWelcome` in `src/host/host.js:803-804` during DOMContentLoaded init | closed |
| T-06-17 | Elevation of Privilege | `welcome:tap` bypassing auto-updater safe window | accept | Tap path calls only `createMagiclineView` + `authFlow.start` — no `autoUpdater.quitAndInstall`; `updateGate` post-reset hook still fires on `mode='reset'` paths | closed |
| T-06-18 | Repudiation | Harness removal hiding welcome-loop regressions | accept | `test/sessionReset.welcome-harness.test.js` is git-tracked and runs in the canonical `node --test test/*.test.js` suite; removal would surface in PR diff | closed |
| T-06-19 | Tampering | `06-VERIFICATION.md` manually edited to hide failing checks | accept | Single-dev, single-reviewer kiosk project; no adversarial threat model for verification docs | closed |

*Status: 19 closed · 0 open*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-06-01 | T-06-01 | Bundled asar immutable at runtime; no injection path | nico | 2026-04-14 |
| AR-06-02 | T-06-04 | Physical rate-limit on a single-user kiosk; main handler idempotent | nico | 2026-04-14 |
| AR-06-03 | T-06-05 | Welcome CTA is brand copy only, no sensitive data | nico | 2026-04-14 |
| AR-06-04 | T-06-08 | Welcome-mode reset is physically self-pacing; non-welcome loop guard unaffected | nico | 2026-04-14 |
| AR-06-05 | T-06-15 | Phase 3 `safeStorage` posture already covers credential lifecycle; no new exposure | nico | 2026-04-14 |
| AR-06-06 | T-06-17 | Tap path contains no `quitAndInstall`; auto-updater safe-window gate lives on reset-mode path | nico | 2026-04-14 |
| AR-06-07 | T-06-18 | Harness file is git-tracked; any removal is visible in PR diff | nico | 2026-04-14 |
| AR-06-08 | T-06-19 | Single-dev single-reviewer project; no adversarial verification-doc threat model | nico | 2026-04-14 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-14 | 19 | 19 | 0 | gsd-security-auditor (/gsd-secure-phase 6) |

### Audit 2026-04-14 — Verification notes

- All 11 `mitigate` threats verified with file:line evidence in current `master` tree.
- All 8 `accept` threats recorded in the Accepted Risks Log with rationale.
- No unregistered threat flags in Phase 6 SUMMARY files.
- NFC-05 guarantee (badge keystrokes ignored on welcome) verified: `src/host/host.js:764-765` wires only `pointerdown`/`touchstart` on `#welcome-screen`; no `keydown` forwarding.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-14
