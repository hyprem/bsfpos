# Feature Research

**Domain:** Single-device self-service POS kiosk wrapping a third-party SaaS web UI (Magicline) at a gym, driven by NFC member badge on a Windows touchscreen terminal.
**Researched:** 2026-04-08
**Confidence:** HIGH (most features derive directly from the validated Android prototype and PROJECT.md decided requirements; industry cross-check via kiosk UX literature — see Sources)

## Framing

This product is unusual for a "kiosk" in two important ways, and every feature recommendation below is colored by them:

1. **We do not own the checkout UI.** Magicline's cash register page is the UI. We are a lockdown shell around it. Anything that would mean "build a checkout screen" is automatically an anti-feature — the entire business case for this project is to avoid duplicating Magicline.
2. **Staff are not present at the kiosk.** There is no cashier to bail members out. Every failure mode must self-heal or be obvious enough for a member to walk away and come back later. "Call an attendant" is not an option.

That means table-stakes features here are disproportionately about **resilience, reset, and escape hatches** rather than about rich checkout UX. Checkout UX is Magicline's job and we deliberately don't touch it.

## Feature Landscape

### Table Stakes (Users Expect These — or the Kiosk Is Unusable)

Missing any of these means the product either breaks on day one, strands a member mid-transaction, or requires staff intervention on every quirk — which defeats the whole point.

| # | Feature | Why Expected | Complexity | Notes |
|---|---------|--------------|------------|-------|
| T1 | **Fullscreen kiosk lockdown** (no chrome, no address bar, no keyboard shortcut escapes, no alt-tab, no right-click dev tools) | Members must not be able to exit the Magicline page, browse the web, or see Electron internals. Without this there is no product. | LOW | Electron `kiosk: true` + `fullscreen: true` + disabling common shortcuts via `before-input-event`. Already decided in PROJECT.md. |
| T2 | **Auto-login to Magicline on boot and after every reset** | A member can never be asked to log into Magicline. Every reset path must land on the cash register, logged in, ready for a badge scan. | MEDIUM | Detect login page → selector-based form fill using React-native value setter (NOT keystroke simulation — Magicline is MUI/React-controlled). Credentials from `safeStorage`. Driven by PROJECT.md. |
| T3 | **Encrypted credential storage** (Windows DPAPI via Electron `safeStorage`) | Magicline staff credentials cannot sit in plaintext on a public-facing device. Compliance and trust baseline. | LOW | `safeStorage.encryptString` → write to disk. Set via admin menu first-run or install time. |
| T4 | **NFC badge capture with HID timing gate** (<50ms inter-key interval) | Members expect "tap badge → I'm identified." The reader is a keyboard wedge; without a timing gate the kiosk can't distinguish a badge scan from a stray key event. | MEDIUM | Already ported-ready from Android prototype. 50ms heuristic + Enter/Tab stripping + minimum length (>3) filter. |
| T5 | **Badge → customer search field injection via React-native setter** | Direct `.value = x` does not update MUI/React state. Without the `Object.getOwnPropertyDescriptor` setter trick the customer field looks filled but Magicline hasn't seen it. | MEDIUM | Validated in prototype. Fires `input` + `change` events after native setter call. |
| T6 | **Permanent CSS hide of non-checkout UI** (sidebar, topbar, global search, categories, customer search box, three-dot menu, Rabatt group, discount icon) | Members must not see admin navigation, discount buttons, or customer browsing. Without this they can wander into Magicline's full UI and break things. | MEDIUM | `webContents.insertCSS` runs engine-level and survives React re-renders — this is *the* reason for Electron over Fully Kiosk. Selectors inventoried in BeeStrong_POS_Kiosk_Project.md. |
| T7 | **Dynamic element hiding via JS + MutationObserver** (Rabatt button group, discount SVG path) | A handful of elements can only be identified by text content or SVG path, not by selector. They rerender on state changes. Without an observer they flash back in. | MEDIUM | Ported from prototype. Observer scoped to `document.body` childList+subtree. |
| T8 | **Post-sale reset** (3 seconds after `Jetzt verkaufen` click → clear customer field) | Without this, the next member's badge scan adds items to the previous member's cart or charges the wrong account. This is a safety-critical reset. | LOW | Click listener on "Jetzt verkaufen" button text → delayed `setMuiValue('')` on customer search input. Already in prototype. |
| T9 | **Idle "are you still there?" overlay** (60s of no input → fullscreen translucent overlay with countdown and "Tap to continue") | Self-service kiosk convention: abandoned carts must time out, but a legitimate slow member (fumbling for a badge, reading a label) must be able to rescue their session with one tap. | MEDIUM | Own overlay in Electron BrowserWindow, not injected into Magicline. Countdown visible. Accessibility: large tap target. |
| T10 | **Idle hard reset** (countdown expires → clear Electron session cookies+storage → reload → auto-login fires) | The only reliable way to drop Magicline cart state (which we don't control) is to drop the whole session. Without this, abandoned carts survive across members. | MEDIUM | `session.defaultSession.clearStorageData()` then `mainWindow.reload()`. Auto-login T2 handles recovery. |
| T11 | **Crash recovery** (on `render-process-gone` → auto reload) | A crash in front of a member without recovery means the kiosk is bricked until staff arrive. Unacceptable for an unattended device. | LOW | Single event listener. Already in PROJECT.md. |
| T12 | **Auto-start on Windows boot** | Gym opens, device powers on, kiosk must be live without staff logging in. | LOW | `app.setLoginItemSettings({ openAtLogin: true })` or NSIS installer registry entry. |
| T13 | **Hidden admin exit** (secret hotkey → PIN prompt → drop kiosk mode) | Staff and maintainer need to update credentials, view logs, reboot, or re-verify fragile selectors against a new Magicline build. Without a hatch they can only do this by pulling power and booting into Android. | LOW | Ctrl+Shift+F12 listener → modal PIN → `setKiosk(false)` + show minimal admin panel. |
| T14 | **Touch-first sizing on own overlays** (large tap targets ≥44px, high contrast, readable font sizes) | Magicline's own UI is already touch-sized, but our overlays (idle, error, admin PIN) must match. Small buttons on a self-service device are the #1 documented kiosk anti-pattern. | LOW | CSS on the overlay layer only. Does not touch Magicline content. |
| T15 | **Local rotating log files** (errors, badge scans, sales, idle resets, logins, updates) | This is the only diagnostic channel — no Sentry, no remote crash reporting. When "it didn't charge me" happens two weeks from now, logs are the only truth. | LOW | `electron-log` or equivalent, rotated by size. RDP-accessible path. |

### Differentiators (Competitive Advantage / Operator & Member Trust)

These aren't strictly required for a walk-up-scan-pay flow, but they meaningfully raise member trust, reduce staff tickets, and make the kiosk feel like a real product rather than a hack.

| # | Feature | Value Proposition | Complexity | Notes |
|---|---------|-------------------|------------|-------|
| D1 | **Bee Strong branded idle / login / error overlays** | The member sees a Bee Strong product, not a rough Electron window. Mid-transaction errors feel intentional instead of "is this thing broken?" | LOW | Branding applies only to overlays we own. Explicit PROJECT.md decision not to restyle Magicline content itself — that decision is correct and should be preserved. |
| D2 | **Auto-update from GitHub Releases via `electron-updater`** | Selector drift when Magicline ships updates can be pushed as an app update without physically visiting the gym. Critical given the fragile MUI `css-xxxxx` selectors. | MEDIUM | Check on boot, silent download, apply on next idle reset. Free (no hosted update server). PROJECT.md decided. |
| D3 | **Visible "updating… / logging in… / kiosk ready" status line for staff** | A staff member walking past the device should be able to tell at a glance: is it live, reconnecting, updating, or stuck? Prevents "is this broken?" tickets. | LOW | Small corner status chip on overlays — never over the Magicline UI during a transaction. |
| D4 | **Online/offline indicator and offline mode screen** | If Magicline is unreachable (gym Wi-Fi drops), members should see "Kasse vorübergehend nicht verfügbar" rather than a Chromium error page. | LOW | `navigator.onLine` + `webContents.on('did-fail-load')` → show branded offline overlay. When network returns → reload. |
| D5 | **Magicline session-expired detection → silent re-login** | Magicline sessions expire. Without this, an overnight-idle kiosk shows the login page to the first morning member. The idle reset (T10) mostly covers this, but an explicit detect-and-reauth is more robust and faster. | LOW | MutationObserver on login page markers → trigger T2 flow without full session clear. |
| D6 | **Audit logging of completed sales** (timestamp, badge ID prefix, cart total if scrapable from DOM) | Not a replacement for Magicline's own records, but a local "did the kiosk think this sale went through" log. Huge value during member disputes or after a crash. | MEDIUM | DOM-scraped fields only. Do NOT store full badge numbers — store prefix/hash. See anti-feature A5. |
| D7 | **Badge scan visual + audio feedback** (brief pulse overlay + short "beep") | Members need to know the scan registered. Silent scans cause double-scans and confusion. Convention for every self-checkout. | LOW | Inject a CSS-only pulse on the customer search area, or overlay it. Small WAV for beep. Respect gym ambient noise — volume configurable in admin panel. |
| D8 | **Selector-health self-check on boot** (verify each critical `[data-role]` and fragile `css-xxxxx` selector resolves; log loudly if not) | The single biggest operational risk is a Magicline update shifting the `css-p8umht` / `css-qo4f3u` / `css-1b1c5ke` classes. Proactive detection turns "silent UI leak" into "loud log entry + optional admin alert." | MEDIUM | Small verify script after `did-finish-load`. Flag missing selectors per log line. |
| D9 | **Admin panel: update credentials, view logs, test badge scan, exit kiosk** | Ties T13 into a usable maintenance surface. Without it, "admin exit" is just "close app" and the maintainer still needs a second tool to do anything. | MEDIUM | Minimal local HTML page served in the same Electron window after PIN. |
| D10 | **Branded pre-scan "welcome / please scan your badge" screen** | Eliminates the ambiguity of a member walking up to a cash register UI they've never seen. A soft landing screen that disappears on first badge scan teaches the flow. | MEDIUM | Overlay layer on top of Magicline until a badge is detected. Disappears on first valid scan. Optional — may conflict with staff product-scan workflow if staff also use this terminal, so gate behind a config flag. |
| D11 | **Configurable idle timeout and reset behavior via admin panel** | Gym operator may want 45s vs 60s vs 90s depending on foot traffic observation. Hardcoded values force a rebuild. | LOW | JSON config file next to `safeStorage` blob. |

### Anti-Features (Seem Good, Actually Problematic Here)

This section is deliberately aggressive. Every anti-feature below has a concrete reason why it breaks this specific product. Preserving the "wrap Magicline, don't rebuild it" discipline is the entire project thesis.

| # | Feature | Why Requested | Why Problematic | Alternative |
|---|---------|---------------|-----------------|-------------|
| A1 | **Custom product catalogue / own checkout UI** | "Let's just build a clean checkout — Magicline's UI is ugly." | Duplicates Magicline product/price/tax/membership logic; every Magicline product change becomes a code change; tax and member-credit rules are non-trivial; Magicline vending API has no catalogue endpoint. This is the #1 scope killer for this project. | Wrap Magicline. Hide what you don't want. Let Magicline stay the source of truth. (PROJECT.md explicitly rejects this — keep it rejected.) |
| A2 | **Restyling Magicline's content area** (custom colors, fonts, layouts inside the iframe/page) | "Make the cash register match the Bee Strong brand." | Every Magicline update shifts MUI class names and breaks the overrides. Compounds the fragile `css-xxxxx` problem across the entire page instead of isolating it to a known hide list. | Brand only our overlays (D1). Leave Magicline content as-is. |
| A3 | **Integrating Magicline `/open-api/device/vending/` endpoints** | "The API is official, we should use it." | Confirmed unsuitable: vending API is for actual vending machines, has no product catalogue, unclear whether it accepts badge UIDs as identification, unclear whether it's permitted for custom kiosk UIs. Duplicates A1 risk with extra API-shape uncertainty. | Not now. Revisit only if Magicline publishes a kiosk API. |
| A4 | **Real-time remote monitoring / Sentry / hosted dashboards** | "Observability is best practice." | Single device, single location, RDP available, no recurring budget. A hosted crash reporter is ongoing cost for near-zero marginal value. Every outage question can be answered from a log file read over RDP. | Local rotating logs (T15), read via RDP. Revisit only if fleet grows past one device. |
| A5 | **Storing full badge numbers in logs or audit** | "For dispute resolution we need to know who it was." | Badge numbers are member PII / credentials. A leaked log is a security incident. The Magicline side already has authoritative "who bought what" data. | Log only a hash or the last 3 digits of badge IDs; cross-reference Magicline's own transaction log for disputes. |
| A6 | **Multi-device / multi-gym / per-device branding config** | "What if we sell this to another gym?" | Premature abstraction. There's one device at one location, per PROJECT.md. Every hook for multi-tenancy is a hook that has to be kept working. | Hard-code the URL, the branding, and the credentials location. If a second device ever happens, abstract *then*. |
| A7 | **Custom on-screen PIN pad / signature capture / cash drawer integration** | "It's a POS, POSes have these." | Magicline already handles payment flows. This is a badge-based self-checkout — payment is on the member's account, not cash. Adding a PIN pad or signature capture duplicates Magicline's payment confirmation and invites legal/PCI scope. | None. Members pay via badge→account; nothing else on the terminal. |
| A8 | **Showing full Magicline error dialogs to members** | "Errors should be transparent." | Magicline errors are in staff language ("Sitzung abgelaufen", stack traces on network errors, internal field names). They confuse members and expose implementation detail. | Our own branded "Sorry, please try again or ask staff" overlay on known failure DOM markers. Fall back to idle reset (T10) if state is unrecoverable. |
| A9 | **"Print receipt" integration** (member-facing receipt printer) | "Retail POS has receipts." | Magicline already emails/records the transaction on the member account. A physical printer adds hardware, paper maintenance, failure modes, and zero marginal value for a member account-based flow. | Rely on Magicline's own member-account-side records. |
| A10 | **Voice commands / biometric / face recognition** | "Modern UX." | Privacy nightmare, accessibility liability, unreliable in a gym (noise, sweat, hats), completely unnecessary when members already carry an NFC badge that works. | Keep NFC as the one auth path. |
| A11 | **Language switcher / i18n framework** | "What if a member speaks Turkish?" | Magicline's own UI is German only. Adding an i18n layer on our overlays only creates a mismatch ("our overlay is in English but the cash register behind it is in German"). One audience, one language. | German-only overlays, matching Magicline. Revisit only if Magicline adds multi-language. |
| A12 | **In-app software update UI with release notes for members** | "Users like knowing about updates." | The kiosk has no user account, no notifications, no member-facing update concept. Updates should be silent and invisible to members (see D2+D3). | Silent auto-update, visible only in a staff status chip (D3) and the admin log (T15). |
| A13 | **"Did you mean…?" product search autocomplete or suggestions** | "Enhance Magicline's search." | Magicline already has a product search. Anything we build on top duplicates it and needs a local catalogue (→ A1). | Nothing. Staff scan products via their own barcode; members don't search products. |
| A14 | **Exposed product-search field for members** | "Members should be able to browse and buy." | The product grid / category tree / product search is explicitly hidden in the prototype. Members picking products opens the door to abuse (selecting expensive items on someone else's cart). | Staff-only product entry (via barcode scanner wedged into `[data-role="product-search"]`). Member flow is badge-scan-only for pre-loaded carts or staff-scanned products. |
| A15 | **Showing a "total" large-text overlay over Magicline's cart** | "Members can't find the total." | Requires scraping Magicline's cart state and re-rendering it. Every Magicline DOM shift breaks it. Magicline already shows the total. | Let Magicline's own UI show the total; ensure it's not hidden by our CSS. |

## Feature Dependencies

```
Auto-login (T2)
    └──requires──> Encrypted credential storage (T3)
    └──requires──> Fullscreen kiosk lockdown (T1)  [no bypass to admin URLs]

NFC badge capture (T4)
    └──requires──> React-native value setter (T5)
    └──requires──> CSS hide list (T6)  [customer-search box must stay in DOM but be visually hidden — still targetable by selector]

Post-sale reset (T8)
    └──requires──> React-native value setter (T5)

Idle hard reset (T10)
    └──requires──> Idle overlay (T9)
    └──requires──> Auto-login (T2)    [reload will land on login page]

Crash recovery (T11)
    └──requires──> Auto-login (T2)

Admin exit (T13)
    └──enables──> Admin panel (D9)
    └──enables──> Credential rotation (T3 re-entry)
    └──enables──> Selector re-verification workflow (D8)

Selector health check (D8)
    └──enhances──> CSS hide list (T6)
    └──enhances──> Dynamic element hiding (T7)
    └──flags──> Need for auto-update (D2)

Auto-update (D2)
    └──requires──> Crash recovery (T11)  [bad updates must self-heal]
    └──requires──> Logging (T15)         [update events must be auditable]

Offline mode (D4)
    └──enhances──> Crash recovery (T11)
    └──enhances──> Idle hard reset (T10)

Badge scan feedback (D7)
    └──enhances──> NFC badge capture (T4)

Audit logging (D6)
    └──requires──> Logging (T15)
    └──conflicts──> Storing full badge numbers (A5)   [must store hash only]

CRITICAL HIDDEN DEPENDENCY:
CSS hide of [data-role="customer-search"] (T6)
    MUST use visibility/display-hiding that KEEPS the input in the DOM,
    because T4/T5 inject into [data-role="customer-search"] input.
    `display: none` on the parent wrapper is OK as long as the input
    is still query-selectable and dispatchable. This is already how
    the prototype works — flag it loudly so nobody "optimizes" it away.
```

### Dependency Notes

- **T2 requires T1:** auto-login must happen inside a locked window or a member could see the credentials flash past or alt-tab out mid-fill.
- **T4+T5 depend on T6 leaving the customer-search input present in the DOM.** The PROJECT.md hide list does `[data-role="customer-search"] { display: none }` on the wrapper — this still leaves the inner `input` in the DOM tree and query-selectable, which is what the injection relies on. **Any future refactor of the hide list must preserve this.** This is the single subtlest coupling in the whole project.
- **T10 strictly depends on T2.** A session clear + reload that lands on the login page without auto-login leaves the kiosk dead. These two must be tested together, not independently.
- **D2 (auto-update) must not run during a live transaction.** Tie updates to idle-reset boundaries (update check on boot and on idle hard reset only).
- **D6 (audit log) and A5 (full badge numbers) are in direct tension.** D6 must be implemented with hashing/prefix-only or it becomes A5.
- **D8 (selector health) effectively defines when D2 (auto-update) is most valuable** — a detected selector miss is the trigger to ship a hotfix.

## MVP Definition

### Launch With (v1) — "A member can self-checkout unattended"

The minimum required for the kiosk to replace a staff interaction for its core use case. Everything here is a table-stake feature; MVP is a strict subset of the Table Stakes table.

- [ ] T1 Fullscreen kiosk lockdown
- [ ] T2 Auto-login on boot + after reset
- [ ] T3 Encrypted credential storage (safeStorage)
- [ ] T4 NFC badge capture with HID timing gate
- [ ] T5 React-native setter injection into customer search
- [ ] T6 Permanent CSS hide list
- [ ] T7 Dynamic element hiding (Rabatt / discount)
- [ ] T8 Post-sale reset (3s after "Jetzt verkaufen")
- [ ] T9 Idle "still there?" overlay at 60s
- [ ] T10 Idle hard reset (session clear + reload + auto-login)
- [ ] T11 Crash recovery
- [ ] T12 Auto-start on Windows boot
- [ ] T13 Hidden admin exit with PIN
- [ ] T14 Touch-first sizing on own overlays
- [ ] T15 Local rotating logs

### Add Shortly After Validation (v1.x) — "Operational trust"

Add once the core flow is proven on the real device with real members. These turn a working prototype into a maintainable product.

- [ ] D1 Branded overlays (idle / login-in-progress / error)
- [ ] D2 Auto-update from GitHub Releases — **trigger: first observed Magicline selector drift**
- [ ] D7 Badge scan visual + audio feedback — **trigger: first report of "did it scan me?"**
- [ ] D8 Selector-health self-check on boot — **trigger: first silent UI leak from Magicline update**
- [ ] D9 Admin panel (credentials, logs, test scan, exit) — **trigger: first time credentials must be rotated in the field**
- [ ] D4 Offline mode screen — **trigger: first Wi-Fi outage during gym hours**
- [ ] D5 Magicline session-expired silent re-login — **trigger: first "login page showed to a member" incident**

### Future Consideration (v2+) — "Polish and nice-to-have"

- [ ] D3 Staff-visible status chip — defer until there's evidence staff are unsure about kiosk state
- [ ] D6 Local audit log of completed sales (hash-only) — defer unless disputes arise
- [ ] D10 Branded welcome / pre-scan landing screen — defer; may interfere with staff product scanning and needs A/B validation
- [ ] D11 Configurable idle timeout — defer until operator expresses a concrete need different from 60s

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| T1 Kiosk lockdown | HIGH | LOW | P1 |
| T2 Auto-login | HIGH | MEDIUM | P1 |
| T3 safeStorage creds | HIGH | LOW | P1 |
| T4 NFC capture | HIGH | MEDIUM | P1 |
| T5 React-native setter | HIGH | MEDIUM | P1 |
| T6 CSS hide list | HIGH | MEDIUM | P1 |
| T7 Dynamic element hiding | HIGH | MEDIUM | P1 |
| T8 Post-sale reset | HIGH | LOW | P1 |
| T9 Idle overlay | HIGH | MEDIUM | P1 |
| T10 Idle hard reset | HIGH | MEDIUM | P1 |
| T11 Crash recovery | HIGH | LOW | P1 |
| T12 Auto-start | HIGH | LOW | P1 |
| T13 Admin exit + PIN | HIGH | LOW | P1 |
| T14 Touch sizing overlays | HIGH | LOW | P1 |
| T15 Local logs | MEDIUM | LOW | P1 |
| D1 Branded overlays | MEDIUM | LOW | P2 |
| D2 Auto-update | HIGH | MEDIUM | P2 |
| D4 Offline mode screen | MEDIUM | LOW | P2 |
| D5 Session-expired re-login | MEDIUM | LOW | P2 |
| D7 Scan feedback | MEDIUM | LOW | P2 |
| D8 Selector health check | HIGH | MEDIUM | P2 |
| D9 Admin panel | MEDIUM | MEDIUM | P2 |
| D3 Staff status chip | LOW | LOW | P3 |
| D6 Audit log (hashed) | LOW | MEDIUM | P3 |
| D10 Welcome screen | LOW | MEDIUM | P3 |
| D11 Configurable timeouts | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch — kiosk is not usable unattended without these
- P2: Should have; add within weeks of launch as evidence arrives
- P3: Nice to have; only build if validated demand

## Competitor / Convention Analysis

There is no close competitor because the category is "wrap a third-party SaaS UI on a locked-down single device" — this is normally a hack, not a product category. But two reference classes are instructive:

| Feature | Retail SCO (Walmart, Carrefour) | Gym kiosk (Gantner, Aila, Elatec fitness) | Our Approach |
|---------|---------------------------------|-------------------------------------------|--------------|
| Auth method | Card insert / barcode scan | NFC wristband / badge / mobile wallet | NFC HID badge (same class) |
| Idle timeout | 30-60s → attendant call | 30-60s → screen reset | 60s → overlay → hard reset (no attendant) |
| Product selection | Member scans items | Usually check-in only, not purchase | Staff-scanned or pre-loaded via Magicline; members don't select |
| Payment | Card reader, cash drawer, receipt printer | Member account debit | Member account via Magicline (no local payment hardware) |
| Attendant escape | "Call for help" button → attendant | Staff at front desk | None — self-healing reset + RDP remote fix |
| Branding scope | Full custom UI (owned) | Full custom UI (owned) | Overlays only — Magicline content untouched |
| Accessibility | High contrast, audio, large fonts (ADA) | Similar | High contrast + large tap targets on overlays; Magicline's own a11y is their job |
| Update mechanism | Fleet management system | Fleet management system | Single-device auto-update from GitHub Releases |

**The key insight:** retail SCO and gym check-in kiosks are *apps that own their UI*. We are not. We're a lockdown shell. That means the **interesting features are the reset/recovery/lockdown features, not the checkout UX features.** Anyone who pulls us toward "let's make the checkout screen nicer" is dragging us toward A1/A2.

## Accessibility Notes (applies to our own overlays only)

Magicline's in-content accessibility is Magicline's responsibility — we explicitly don't retheme their content (A2). But every overlay we *do* own must meet kiosk touch conventions:

- Minimum tap target 44×44 CSS px, ideally 60+ for a kiosk context
- Contrast ratio ≥ 4.5:1 for text, ≥ 3:1 for large text and UI components
- Font size ≥ 20px for body copy on the idle overlay (kiosk viewing distance)
- No hover-only affordances — every action must be tap-discoverable
- Screen-reader labels on the idle overlay button and admin PIN prompt are out of scope (this is a gym kiosk with no audio output per spec, no assistive tech expected to connect to it), but don't actively block them — use semantic HTML, not `<div onclick>`.

## Sources

- PROJECT.md (internal) — decided requirements and out-of-scope list, 2026-04-08
- BeeStrong_POS_Kiosk_Project.md (internal) — validated Android prototype, NFC timing, selector inventory, reset logic
- [Self-Service Kiosk Design and UI Tips — Hashmato](https://hashmato.com/self-service-kiosk-design-user-interface-tips/) — touch target and workflow conventions (MEDIUM confidence, marketing source cross-checked against others)
- [Kiosk UX/UI Design Checklist — AVIXA Xchange](https://xchange.avixa.org/posts/kiosk-ux-ui-design-checklist) — kiosk UX checklist including idle and touch interaction (MEDIUM)
- [Self-Checkout: The Good, Bad and Ugly — Kiosk Industry](https://kioskindustry.org/self-checkout-the-good-bad-and-ugly/) — common anti-patterns in self-checkout (MEDIUM)
- [Digital Kiosks — Inclusive Self-Service Experiences, Level Access](https://www.levelaccess.com/blog/unlocking-kiosk-accessibility-tips-for-inclusive-compliant-self-service-experiences/) — kiosk accessibility baseline (MEDIUM)
- [Self-Service Kiosks in Fitness Centers — Aila Tech](https://www.ailatech.com/blog/how-self-service-kiosks-in-fitness-centers-can-streamline-workflows-and-increase-member-satisfaction/) — gym-specific kiosk use cases (MEDIUM, vendor source)
- [Gantner 24/7 Gym Check-In](https://www.gantner.com/en/solutions/access-control-systems/check-in-systems-for-fitnessclubs) — reference for gym NFC check-in conventions (MEDIUM)
- [Elatec Fitness RFID Authentication](https://www.elatec-rfid.com/en-us/industries/fitness) — NFC credential options in fitness (MEDIUM)

**Confidence note:** Table stakes T1–T15 are HIGH confidence because they're either already working in the Android prototype (validated empirically) or explicitly decided in PROJECT.md. Differentiators D1–D11 are MEDIUM confidence — industry convention plus project fit. Anti-features A1–A15 are HIGH confidence because each is either already explicitly out of scope in PROJECT.md or violates the project's core thesis ("wrap, don't rebuild").

---
*Feature research for: self-service NFC POS kiosk wrapping Magicline SaaS cash register on Windows Electron*
*Researched: 2026-04-08*
