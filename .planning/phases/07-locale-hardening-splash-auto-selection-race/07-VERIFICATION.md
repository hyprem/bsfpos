# Phase 07 Verification — Locale Hardening & Splash Auto-Selection Race

**Phase:** 07-locale-hardening-splash-auto-selection-race
**Status:** Code complete — live-kiosk UAT deferred
**Requirements:** LOCALE-01, SPLASH-01

> **Deferral note (2026-04-14):** Kiosk will continue running Windows in German (production default). L1 (English-Windows locale proof) is not needed for current deployment. L2–R2 behavioural checks deferred to the next scheduled kiosk maintenance visit. Tracked in `07-HUMAN-UAT.md` so they surface in `/gsd-progress` and `/gsd-audit-uat`.

## Automated verification (runs on every CI / local `node --test`)

| Test file | Requirement | Expected |
|-----------|-------------|----------|
| test/fragileSelectors.test.js | LOCALE-01 | LOCALE_STRINGS.de shape correct, 3 keys non-empty |
| test/magiclineView.sentinel.test.js | LOCALE-01 / SPLASH-01 | parseAutoSelectSentinel allowlist, 8 cases pass |
| test/logger.audit.test.js | LOCALE-01 | Existing log.audit format regression — auto-select.result emits canonical format |

Run: `node --test test/fragileSelectors.test.js test/magiclineView.sentinel.test.js test/logger.audit.test.js`

## Manual kiosk verification

See `docs/runbook/v1.1-KIOSK-VISIT.md` → Phase 07 verification section.

| Check ID | Description | Pass / Fail / Blocked | Date | Notes |
|----------|-------------|-----------------------|------|-------|
| L1 | Locale de-DE on English Windows | | | |
| L2 | 5 happy-path cycles all emit result=ok | | | |
| S1 | Splash pointer block swallows member taps | | | |
| S2 | Forced failure degrades within 5500 ms | | | |
| S3 | Admin PIN reachable during pending state | | | |
| R1 | Cold-boot path unchanged | | | |
| R2 | Idle-recovery path unchanged | | | |

## Gaps / open items
(filled after kiosk visit)
