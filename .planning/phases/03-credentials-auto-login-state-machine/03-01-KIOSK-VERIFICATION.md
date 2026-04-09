# Phase 3 Wave 0 — Kiosk Verification

> Split: Probe B (this file) runs on any Chromium dev box. Probes A and C
> require the real POS terminal and are tracked in plan 03-09.

## TabTip

- Auto-invoke on text-input focus: DEFERRED — see 03-09
- Manual `tabtip.exe` launch: DEFERRED — see 03-09
- Verdict: DEFERRED — Phase 3 proceeds assuming manual `tabtip.exe` works at the standard path

## Magicline failed-login DOM

**Measured on dev-box Chromium against `https://bee-strong-fitness.web.magicline.com/#/login`
on 2026-04-09.**

- Hash after failed submit: `#/` (NOT `#/login` — Magicline rewrites the hash even though the form stays visible)
- `[data-role="username"]` behavior: **stays mounted** (no unmount/remount)
- MutationObserver log: `[]` (zero `username-removed` / `username-added` events)
- Second `login-detected` would fire: **NO** — the form is updated in place, not remounted
- **Verdict: primary failure signal = watchdog** (text-match as a fast secondary signal — see below)

### Additional findings (NEW — not in 03-RESEARCH.md)

**🚨 Magicline shows reCAPTCHA after the very first failed login attempt.** The exact error
banner text on a wrong submit is:

> Benutzername oder Passwort sind nicht korrekt oder es gab zuvor einen fehlerhaften
> Login-Versuch. Überprüfe bitte die Eingabe und bestätige zusätzlich die 'Ich bin kein
> Roboter'-Checkbox.

**Implications for Phase 3 architecture:**

1. **The kiosk cannot auto-retry after a login failure.** Once reCAPTCHA appears, a human
   must physically tap the "I'm not a robot" checkbox before another submit will be accepted.
   No injection-based workaround is possible — reCAPTCHA v2 is purpose-built to defeat
   scripted fills.

2. **On cached-credential auto-login failure (e.g. Magicline account password rotated
   externally, or ciphertext corruption slips past our checks), the state machine must
   NOT silently retry.** It must:
   - Clear the cached ciphertext
   - Transition directly to `CREDENTIALS_UNAVAILABLE` (not to a retry loop)
   - Require admin PIN + manual re-entry via the credentials overlay
   - On re-entry, the admin is physically present and can solve reCAPTCHA by touching
     the checkbox inside the child WebContentsView before resubmitting

3. **On first-run credential entry, if the admin types the password wrong once, reCAPTCHA
   appears immediately.** The credentials overlay + child Magicline view must be able to
   hand off focus so the admin can tap reCAPTCHA. Since the child view is a real Chromium
   `WebContentsView`, the reCAPTCHA iframe will render and accept touch events natively —
   no special handling needed beyond making the view visible and interactable during the
   recovery path.

4. **Failure detection is now TEXT + watchdog, not just watchdog.** The error string
   `'Benutzername oder Passwort sind nicht korrekt'` is a fast deterministic signal that
   beats the watchdog by several seconds. Plan 03-04 should:
   - **Primary signal:** MutationObserver for the error substring (500 ms typical latency)
   - **Fallback signal:** 6-8 second watchdog (in case Magicline updates the German text
     and the substring match silently fails)
   - Either signal transitions the state machine to the login-failed path

5. **Fragile-selectors dependency:** The error-text substring above must be stored in
   `src/inject/fragile-selectors.js` alongside the login button / username / password
   selectors, so it's easy to re-verify and update on Magicline drift.

## scrypt Benchmark

- Median ms at N=16384: DEFERRED — see 03-09
- In 50–250 ms band: DEFERRED — see 03-09
- Chosen N: 16384 (research default — to be confirmed or retuned by 03-09)
- CPU model (if known): DEFERRED — see 03-09
