---
phase: 04-nfc-input-idle-session-lifecycle
plan: 01
status: complete
requirements: [NFC-01, NFC-02, NFC-03, NFC-04, NFC-05, NFC-06, IDLE-01, IDLE-02]
---

# Plan 04-01 Summary — badgeInput + idleTimer

Two pure main-process state-machine modules, fully unit-testable without Electron.
Foundation for Wave 2 wiring (Plan 04-03 attaches them to real webContents).

## Key Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/main/idleTimer.js` | 101 | IDLE/OVERLAY_SHOWING/RESETTING state machine |
| `src/main/badgeInput.js` | 131 | NFC keystroke coalesce + inject |
| `test/idleTimer.test.js` | 191 | 10 unit tests (state machine + lazy sessionReset) |
| `test/badgeInput.test.js` | 280 | 16 unit tests (NFC-03 regression, arbitration, Pitfalls 6/7) |

## Tests

- `node --test test/idleTimer.test.js` — **10/10 pass**
- `node --test test/badgeInput.test.js` — **16/16 pass**
- No test imports real Electron; sessionReset is stubbed via `require.cache` override.

## Constants Used (D-04 defaults)

| Constant | Value | Rationale |
|----------|-------|-----------|
| `BADGE_SPEED_MS` | 50 | D-04 default, tunable via `nfcBadgeSpeedMs` in Plan 03 |
| `COMMIT_TIMEOUT_MS` | 100 | D-04 silent-timeout flush |
| `MIN_BADGE_LENGTH` | 3 | D-04 length gate — `buffer.length > 3` commits |
| `IDLE_TIMEOUT_MS` | 60_000 | IDLE-01 |
| `OVERLAY_TIMEOUT_MS` | 30_000 | IDLE-01 (host.js owns countdown) |

## Key Design Decisions Honored

- **D-03 sentinel-null**: `let lastKeyTime = null`; `timeSinceLast = lastKeyTime === null ? 0 : (now - lastKeyTime)`. First keystroke is always buffered. Regression test proves the exact prototype bug is fixed.
- **Pitfall 6**: `lastKeyTime = null` on every commit so subsequent scans re-enter the sentinel path.
- **Pitfall 7**: `if (wc.isDestroyed()) return;` before `executeJavaScript` — prevents post-reset commit throws.
- **T-04-01 tampering mitigation**: committed payload interpolated via `JSON.stringify(committed)` — embedded quotes/backslashes cannot break out of the JS string literal.
- **T-04-03 info disclosure**: log line emits `length=N` only, never committed buffer content. Phase 5 ADMIN-05 alignment.
- **NFC-05**: `idleTimer.bump()` fires on EVERY `keyDown`, including product-search pass-through mode.
- **NFC-06**: `setProductSearchFocused(true)` makes keystrokes bypass the coalesce buffer.
- **No side effects at require time**: neither module schedules timers or registers listeners on require. Verified by test-only `require('./badgeInput')` / `require('./idleTimer')` executing without scheduling anything.
- **Lazy `require('./sessionReset')`** in `idleTimer.expired()` breaks the potential circular dependency with Plan 04-02.

## Deviations

None. Both modules match the RESEARCH.md Code Examples skeletons verbatim.

## window.__bskiosk_setMuiValue dependency

Already exposed by `src/inject/inject.js` from Phase 2. No new inject-side work needed for this plan; `badgeInput.commitBuffer()` can call it immediately once `attachBadgeInput(wc)` runs on the Magicline view's `webContents`.

## Commits

| Commit | Message |
|--------|---------|
| `75b320d` | test(04-01): add failing tests for idleTimer state machine |
| `258e784` | feat(04-01): implement idleTimer state machine (NFC-01/IDLE-01) |
| `e36140a` | test(04-01): add failing tests for badgeInput sentinel-null + arbitration (TDD RED) |
| `aeaf353` | feat(04-01): implement badgeInput with NFC-03 sentinel-null fix |

## Enables

- **Plan 04-03** can now call `attachBadgeInput(wc)` on the Magicline view's webContents and call `idleTimer.init(mainWindow)` + `idleTimer.start()` from the `CASH_REGISTER_READY` start-idle-timer executor.
- **Plan 04-02** (sessionReset) can be required lazily by `idleTimer.expired()` without circular-dep concerns.
