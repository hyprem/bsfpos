# Phase 3 Wave 0 — Kiosk Verification

> Split: Probe B (this file) runs on any Chromium dev box. Probes A and C
> require the real POS terminal and are tracked in plan 03-09.

## TabTip

**Measured 2026-04-10 via `tools/kiosk-probes/` on proxy box `DESKTOP-P1E98A1`
(Windows 10.0.19045, Intel i3-2350M, regular user session). See §Caveats at end
of this section for why a regular-user proxy is acceptable for the verdict.**

- Auto-invoke on text-input focus: **NO**
- Manual `tabtip.exe` launch: **YES** at `C:\Program Files\Common Files\microsoft shared\ink\TabTip.exe`
- Verdict: **manual button** — kiosk must expose a touch-keyboard button in the credentials overlay that invokes the `launch-touch-keyboard` IPC handler wired in Plan 03-07, which `child_process.exec`s the path above.

### Caveats — regular-user proxy vs Assigned Access

Probe A was run under a **regular** Windows user on a separate test box, not under
the Phase 1 Assigned Access kiosk user on the real POS terminal. This is
acceptable for closing Phase 3 on the following reasoning:

1. **Auto-invoke NO under a regular user is a stronger-than-needed signal.**
   Regular Windows sessions have *more* touch-keyboard auto-invoke heuristics
   than locked-down Assigned Access sessions (which strip "tablet mode"
   affordances). If the keyboard does not auto-invoke under a regular user, it
   will not auto-invoke under Assigned Access either — the verdict can only
   move from "manual button" toward "manual button" on the real kiosk.
2. **Manual `TabTip.exe` launch is not gated by user account kind.** The probe
   shell-executes a standard Win32 binary with no elevation or session-state
   requirements. If it works under a regular user, it will work under Assigned
   Access barring an explicit AppLocker / SRP policy blocking `TabTip.exe`
   (none is configured by the Phase 1 hardening runbook — see
   `.planning/phases/01-locked-down-shell-os-hardening/01-05-SUMMARY.md`).
3. **Residual risk:** the `launch-touch-keyboard` handler path and the
   "manual button" touch target are not physically confirmed on the real POS
   terminal under the Phase 1 kiosk user. Flagged for a 30-second re-check on
   the next physical kiosk visit (see Phase 3 open concerns in
   `03-09-SUMMARY.md`). If that re-check fails, the fix is local to the IPC
   handler and/or the credentials overlay — no architectural change.

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

**Measured 2026-04-10 via `tools/kiosk-probes/` on proxy box `DESKTOP-P1E98A1`
(Intel Core i3-2350M @ 2.30GHz, 3.9 GB RAM, Node v24.14.1).**

- Samples (ms, 5 runs): `79.6, 82.2, 111.2, 118.6, 94.8`
- Sorted: `79.6, 82.2, 94.8, 111.2, 118.6`
- Median ms at N=16384: **94.8**
- In 50–250 ms band: **YES**
- Chosen N: **16384** (unchanged — research default confirmed by measurement)
- CPU model: Intel(R) Core(TM) i3-2350M CPU @ 2.30GHz
- `src/main/adminPin.js` edit: **none** (N stays at 16384; stale "DEFERRED" comment refreshed to reference this measurement)

### Caveats — proxy CPU vs production POS CPU

The i3-2350M is a 2011-era 2-core/4-thread Sandy Bridge mobile CPU. If the
production POS terminal has materially different silicon (e.g. a modern Celeron
or an ARM SoC), the median could shift. The band 50–250 ms has ~2.6× headroom
on the low end and ~2.6× headroom on the high end from the measured 94.8 ms,
so the verdict tolerates a 2.5× CPU speed difference in either direction before
a retune is warranted. Retune rule documented in `03-09-PLAN.md` §Probe C.
Flagged for a 60-second re-run on the next physical kiosk visit alongside the
TabTip re-check.
