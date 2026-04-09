# Plan 03-01 — Wave 0 Probe B verification — SUMMARY

## Outcome

Probe B (Magicline failed-login DOM behavior) was executed by the user against
`https://bee-strong-fitness.web.magicline.com/#/login` from a dev-box Chromium
on 2026-04-09. The verdict file
`.planning/phases/03-credentials-auto-login-state-machine/03-01-KIOSK-VERIFICATION.md`
was written with the Probe B section populated and the TabTip / scrypt sections
marked `DEFERRED — see 03-09` per the plan split.

## Failure detection verdict

**Primary signal:** MutationObserver / text-match on the Magicline error banner
substring `'Benutzername oder Passwort sind nicht korrekt'`.

**Fallback signal:** 6-8 second watchdog timer armed at submit, disarmed on
`CASH_REGISTER_READY`.

The form does **not** unmount/remount on failure — `[data-role="username"]` stays
in the DOM and no second `login-detected` will fire. A `login-detected` re-fire
strategy is therefore ruled out.

## 🚨 NEW FINDING — reCAPTCHA blocks auto-retry

Not anticipated by 03-RESEARCH.md or 03-CONTEXT.md:

**Magicline shows a reCAPTCHA "I'm not a robot" checkbox after the very first
failed login attempt.** The exact error text includes:

> "…bestätige zusätzlich die 'Ich bin kein Roboter'-Checkbox."

This has material implications for Phase 3 design:

- The kiosk **cannot silently auto-retry** after a login failure. reCAPTCHA v2 is
  designed to defeat scripted retries and no injection-based workaround exists.
- On cached-credential failure the auth state machine MUST clear the ciphertext
  and route directly to `CREDENTIALS_UNAVAILABLE` (admin PIN + re-entry via the
  credentials overlay) — not to a retry loop.
- On first-run entry, if the admin mistypes once, reCAPTCHA appears immediately.
  The child `WebContentsView` will render it natively and accept touch events, so
  no special code path is needed — but the credentials overlay must be able to
  temporarily yield focus to the Magicline view so the admin can solve it.
- The error substring and reCAPTCHA selector both belong in
  `src/inject/fragile-selectors.js` so Magicline drift is easy to fix.

## Impact on downstream plans

- **03-04 (auth state machine):** failure detection path becomes text-match + watchdog.
  The state machine must NOT contain any "auto-retry on failure" branch — any
  failure transitions straight to `CREDENTIALS_UNAVAILABLE`.
- **03-05 (injection layer):** add a MutationObserver hooked to the error
  substring. Signal name suggestion: `login-failed`. Add reCAPTCHA iframe /
  container selector to `fragile-selectors.js`.
- **03-06 (host UI):** the credentials overlay flow on failure must include a
  short-lived "solve the reCAPTCHA in the background, then retry" affordance.
  Simpler alternative: force admin to clear+re-enter instead of retry.
- **03-07 (main.js wire-up):** ensure the child view is interactable (not blocked
  by host-window overlays) during the `CREDENTIALS_UNAVAILABLE` recovery path.
- **03-08 (phase acceptance):** acceptance test 5 (safeStorage failure → PIN
  recovery) must walk through the reCAPTCHA tap in the child view.

## Files

- `.planning/phases/03-credentials-auto-login-state-machine/03-01-KIOSK-VERIFICATION.md` (new)
- `.planning/phases/03-credentials-auto-login-state-machine/03-01-SUMMARY.md` (this file)

## Still deferred to 03-09

- Probe A — TabTip auto-invoke on real kiosk under Assigned Access user
- Probe C — `crypto.scryptSync` benchmark on real kiosk CPU (may retune `SCRYPT_PARAMS.N`)
