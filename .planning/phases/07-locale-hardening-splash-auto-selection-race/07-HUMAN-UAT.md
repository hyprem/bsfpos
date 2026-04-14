---
status: partial
phase: 07-locale-hardening-splash-auto-selection-race
source: [07-VERIFICATION.md, 07-06-PLAN.md]
started: 2026-04-14
updated: 2026-04-14
---

## Current Test

[deferred — awaiting next scheduled kiosk maintenance visit]

## Tests

### 1. L1 — Locale de-DE on English-US Windows
expected: With Windows display language set to English-US, Magicline UI renders in German; `navigator.language === 'de-DE'`; first request carries `Accept-Language: de-DE,de;q=0.9`; audit log contains `event=startup.locale lang=de`.
result: [pending — deferred; production kiosk stays on German Windows, so L1 is low priority]

### 2. L2 — 5 consecutive auto-select cycles all emit result=ok
expected: 5 cycles of welcome→tap→register→idle→welcome; each emits exactly one `event=auto-select.result result=ok`; zero `result=fail` or `result=timeout`; splash never stuck.
result: [pending]

### 3. S1 — Splash pointer block swallows member taps during auto-select window
expected: During auto-select pending window, taps on splash do NOT reach Magicline; `.bsk-layer--splash` has `auto-select-pending` class applied; chain still completes with `result=ok`.
result: [pending]

### 4. S2 — Forced failure degrades cleanly within 5500 ms
expected: DevTools removal of Self-Checkout option → `result=fail step=step3-self-checkout` within 1.5 s → splash hides via degraded path within ≤5500 ms of welcome:tap → manual register picker usable.
result: [pending]

### 5. S3 — Admin PIN reachable during pending state
expected: Ctrl+Shift+F12 during auto-select pending window opens the admin PIN modal above the splash and accepts input.
result: [pending]

### 6. R1 — Cold-boot path unchanged
expected: Full reboot → welcome renders immediately → splash not stuck → `event=startup.complete` audit line present.
result: [pending]

### 7. R2 — Idle-recovery path unchanged
expected: 60 s idle → overlay tap → `sessionReset.hardReset reason=idle-expired` → new welcome cycle runs clean → splash gate re-arms.
result: [pending]

### 8. DOM-survey — Live Magicline fragile selector audit (deferred from Plan 07-01)
expected: Fill in `docs/runbook/v1.1-KIOSK-VISIT.md` Phase 07 DOM survey block — record `data-*`, `aria-*`, `id`, `role` attributes of the 3 auto-select buttons; record `location.hash` on register-selection and cash-register pages; check stable/unstable conclusion box.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps

None yet — re-run during next kiosk maintenance visit. If any check fails then, open gap-closure via `/gsd-plan-phase 07 --gaps`.
