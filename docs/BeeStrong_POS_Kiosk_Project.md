# Bee Strong Fitness — POS Kiosk Project

## Project Overview

A self-service POS kiosk for Bee Strong Fitness gym using **Magicline** (SaaS gym management system) as the backend. The kiosk runs on a Chinese OEM POS device that supports **dual boot — either Android 11 or Windows**. The NFC/card reader connects via USB HID. The goal is to lock down the Magicline web UI so customers can only see and interact with the relevant checkout elements.

---

## Hardware

- **Device**: Chinese OEM POS terminal with **dual boot support**
- **OS options**: Android 11 OR Windows (both available on same device)
- **NFC/Card Reader**: Deka brand, connected via **USB HID** (acts as keyboard wedge — outputs keystrokes into focused field)
- **Reader SDK**: Deka SDK (Java `.aar`) — NOT needed since USB HID mode confirmed
- **Screen**: Touchscreen, runs in tablet/vertical mode

---

## OS Decision — Android vs Windows

### Android 11 (current)
- **Kiosk app**: Fully Kiosk Browser PLUS — registers as Android launcher, starts on boot
- **Problem**: WebView was outdated (below Chrome 110 minimum for Magicline) — fixed by sideloading WebView v146
- **Problem**: CSS/JS injection via Fully Kiosk fights React re-renders constantly
- **Problem**: MUI auto-generated class names break on Magicline updates
- **Advantage**: Already set up and partially working

### Windows (recommended for Electron approach)
- **No WebView dependency** — Chrome is standalone, always up to date
- **Electron app** gives permanent CSS injection at browser engine level
- **No fighting React** — `insertCSS` survives re-renders natively
- **NFC HID** works identically — USB keyboard wedge inputs into focused field
- **Remote access** via RDP/TeamViewer for maintenance
- **No licensing costs** if using an existing Windows license

### Recommendation
**Switch to Windows and build the Electron app.** The dual boot capability means no new hardware is needed — just boot into Windows and deploy the Electron kiosk app.

---

## Current Software Stack (Android — partially working)

- **Kiosk Browser**: Fully Kiosk Browser PLUS (fully-kiosk.com) — €7.90 one-time per device
- **WebView**: Android System WebView v146 (manually sideloaded from APKMirror, arm64-v8a)
- **Target URL**: `https://bee-strong-fitness.web.magicline.com/#/cash-register`
- **Auto-login**: Fully Kiosk Web Automation JSON
- **UI hiding**: JavaScript injection via Fully Kiosk "Inject JavaScript" setting

---

## Magicline SaaS Details

- **URL**: `https://bee-strong-fitness.web.magicline.com`
- **Tech stack**: React + Material UI (MUI) — important for input injection
- **Login page selectors**:
  - Username: `[data-role="username"]` (placeholder: "Benutzer / E-Mail-Adresse")
  - Password: `[data-role="password"]` (placeholder: "Passwort")
  - Submit button: `[data-role="login-button"]` (text: "Anmelden")
- **Cash register page**: `/#/cash-register`
- **Key selectors on cash register page**:
  - Customer search field: `[data-role="customer-search"] input` (placeholder: "Name, Mitgliedsnummer")
  - Product search field: `[data-role="product-search"] input` (placeholder: "Produkt- und EAN-Suche")
  - Checkout button: `[data-role="button"]` with text "Jetzt verkaufen"
  - Toolbar: `[data-role="toolbar"]`
  - Categories tree: `[data-role="categories"]`
  - Disposal/product area: `[data-role="disposal"]`

---

## Fully Kiosk Web Automation JSON (Auto-login)

```json
[
  {
    "status": 1,
    "url": "https://bee-strong-fitness.web.magicline.com*",
    "action": "FILL_FIELD",
    "target": "ID",
    "id": "[data-role='username']",
    "value": "YOUR_EMAIL"
  },
  {
    "status": 1,
    "url": "https://bee-strong-fitness.web.magicline.com*",
    "action": "FILL_FIELD",
    "target": "ID",
    "id": "[data-role='password']",
    "value": "YOUR_PASSWORD"
  },
  {
    "status": 1,
    "url": "https://bee-strong-fitness.web.magicline.com*",
    "action": "CLICK",
    "target": "ID",
    "id": "[data-role='login-button']",
    "value": ""
  }
]
```

---

## Current JavaScript Injection Script (Fully Kiosk)

This script is pasted into Fully Kiosk → Settings → Advanced Web Settings → Inject JavaScript.

```javascript
(function () {
  var resetTimer;
  var badgeBuffer = '';
  var bufferTimer;
  var lastKeyTime = 0;
  var BADGE_SPEED_MS = 50;

  function setMuiValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function injectCSS() {
    if (document.getElementById('fk-hide-style')) return;
    var style = document.createElement('style');
    style.id = 'fk-hide-style';
    style.innerHTML = [
      'nav.SidebarWrapper-sc-bb205641-0 { display: none !important; }',
      '[data-role="topbar"] { display: none !important; }',
      '[data-role="global-search-button"] { display: none !important; }',
      '[data-role="categories"] { display: none !important; }',
      '[data-role="customer-search"] { display: none !important; }',
      '.MuiBox-root.css-p8umht { display: none !important; }',
      '.css-qo4f3u { display: none !important; }',
      '.MuiTypography-h5.css-1b1c5ke { display: none !important; }',
      '[data-role="toolbar"] [data-role="icon-button"] { display: none !important; }',
      '.LayoutContainer-sc-5eddc1f5-0 { margin-left: 0 !important; }'
    ].join('');
    document.head.appendChild(style);
  }

  function hideDynamicElements() {
    // Hide Rabatt/Pfandrückgabe/Wertgutschein button group
    var buttons = document.querySelectorAll('[data-role="button"]');
    buttons.forEach(function (btn) {
      if (btn.textContent.trim() === 'Rabatt') {
        var group = btn.closest('.MuiButtonGroup-root');
        if (group && group.style.display !== 'none') {
          group.style.setProperty('display', 'none', 'important');
        }
      }
    });

    // Hide discount tag icon button in cart
    var allPaths = document.querySelectorAll('path');
    allPaths.forEach(function (path) {
      if (path.getAttribute('d') &&
          path.getAttribute('d').indexOf('m21.41 11.41') === 0) {
        var svg = path.closest('svg');
        if (svg) {
          var parentBtn = svg.closest('button');
          if (parentBtn && parentBtn.style.display !== 'none') {
            parentBtn.style.setProperty('display', 'none', 'important');
          } else if (!parentBtn && svg.style.display !== 'none') {
            svg.style.setProperty('display', 'none', 'important');
          }
        }
      }
    });
  }

  function resetSession() {
    var input = document.querySelector('[data-role="customer-search"] input');
    if (input) {
      setMuiValue(input, '');
    }
  }

  function startResetTimer() {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      resetSession();
    }, 60000);
  }

  document.addEventListener('pointerdown', function () {
    startResetTimer();
  });

  document.addEventListener('keydown', function (e) {
    var now = Date.now();
    var timeSinceLast = now - lastKeyTime;
    lastKeyTime = now;

    var focused = document.activeElement;
    var customerInput = document.querySelector('[data-role="customer-search"] input');
    var productInput = document.querySelector('[data-role="product-search"] input');

    if (focused === productInput) return;

    clearTimeout(bufferTimer);
    if (e.key !== 'Enter' && e.key !== 'Tab' && e.key.length === 1) {
      if (timeSinceLast < BADGE_SPEED_MS || badgeBuffer.length > 0) {
        badgeBuffer += e.key;
      }
    }

    bufferTimer = setTimeout(function () {
      if (badgeBuffer.length > 3 && customerInput) {
        setMuiValue(customerInput, badgeBuffer);
      }
      badgeBuffer = '';
    }, 100);
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-role="button"]');
    if (btn && btn.textContent.trim() === 'Jetzt verkaufen') {
      setTimeout(function () {
        resetSession();
      }, 3000);
    }
  });

  function isCashRegister() {
    return window.location.hash.includes('/cash-register') ||
           !!document.querySelector('[data-role="customer-search"]');
  }

  var domObserver = new MutationObserver(function () {
    if (isCashRegister()) {
      injectCSS();
      hideDynamicElements();
    }
  });

  domObserver.observe(document.body, { childList: true, subtree: true });

  var initObserver = new MutationObserver(function () {
    if (isCashRegister()) {
      initObserver.disconnect();
      injectCSS();
      hideDynamicElements();
      startResetTimer();
    }
  });

  initObserver.observe(document.body, { childList: true, subtree: true });

  if (isCashRegister()) {
    injectCSS();
    hideDynamicElements();
    startResetTimer();
  }

})();
```

---

## Known Issues with Current Approach

1. **MUI auto-generated CSS classes** (`css-p8umht`, `css-qo4f3u`, `css-1b1c5ke`) can change when Magicline updates — need to re-inspect and update selectors
2. **Dynamic React re-renders** cause hidden elements to reappear — MutationObserver helps but is a constant battle
3. **CSS injection via Fully Kiosk** runs once on load — dynamic elements added later by React need JS observer approach
4. **Fully Kiosk on Chinese OEM Android** — some lockdown features limited without device owner provisioning

---

## Proposed Solution — Electron Windows App

### Why Electron

- CSS/JS injected via `insertCSS` / `executeJavaScript` at browser engine level — **permanent, survives React re-renders**
- No MutationObserver fighting needed
- Full window control — fullscreen, no title bar, no address bar
- NFC HID input handled natively via Node.js
- Auto-login via Electron session
- Auto-start on Windows boot
- Cross-platform (Windows + Linux)
- Tech stack already known — HTML/CSS/JS

### Electron App Architecture

```
bee-strong-kiosk/
├── package.json
├── main.js          ← Electron main process
├── preload.js       ← Bridge between Node and renderer
├── inject.js        ← All CSS/JS injection logic (ported from above)
├── inject.css       ← All CSS hide rules
└── assets/
    └── icon.png
```

### main.js skeleton

```javascript
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: true,           // true kiosk mode — no way out
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.loadURL('https://bee-strong-fitness.web.magicline.com');

  mainWindow.webContents.on('did-finish-load', () => {
    // Inject CSS permanently
    const css = fs.readFileSync(path.join(__dirname, 'inject.css'), 'utf8');
    mainWindow.webContents.insertCSS(css);

    // Inject JS permanently
    const js = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
    mainWindow.webContents.executeJavaScript(js);
  });

  // Reload on crash
  mainWindow.webContents.on('render-process-gone', () => {
    mainWindow.reload();
  });
}

app.whenReady().then(createWindow);

// Auto-login via session cookies if needed
app.on('ready', () => {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: details.requestHeaders });
  });
});
```

### inject.css (all hide rules — permanent via insertCSS)

```css
nav.SidebarWrapper-sc-bb205641-0 { display: none !important; }
[data-role="topbar"] { display: none !important; }
[data-role="global-search-button"] { display: none !important; }
[data-role="categories"] { display: none !important; }
[data-role="customer-search"] { display: none !important; }
[data-role="toolbar"] [data-role="icon-button"] { display: none !important; }
.MuiBox-root.css-p8umht { display: none !important; }
.css-qo4f3u { display: none !important; }
.MuiTypography-h5.css-1b1c5ke { display: none !important; }
.LayoutContainer-sc-5eddc1f5-0 { margin-left: 0 !important; }
```

### inject.js (NFC + dynamic element hiding — no MutationObserver needed for CSS)

```javascript
(function () {
  var resetTimer;
  var badgeBuffer = '';
  var bufferTimer;
  var lastKeyTime = 0;
  var BADGE_SPEED_MS = 50;

  function setMuiValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function hideDynamicElements() {
    // Rabatt button group
    document.querySelectorAll('[data-role="button"]').forEach(function (btn) {
      if (btn.textContent.trim() === 'Rabatt') {
        var group = btn.closest('.MuiButtonGroup-root');
        if (group) group.style.setProperty('display', 'none', 'important');
      }
    });

    // Discount icon
    document.querySelectorAll('path').forEach(function (path) {
      if (path.getAttribute('d') && path.getAttribute('d').indexOf('m21.41 11.41') === 0) {
        var svg = path.closest('svg');
        if (svg) {
          var btn = svg.closest('button');
          if (btn) btn.style.setProperty('display', 'none', 'important');
          else svg.style.setProperty('display', 'none', 'important');
        }
      }
    });
  }

  function resetSession() {
    var input = document.querySelector('[data-role="customer-search"] input');
    if (input) setMuiValue(input, '');
  }

  function startResetTimer() {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(resetSession, 60000);
  }

  document.addEventListener('pointerdown', startResetTimer);

  // NFC/HID badge capture
  document.addEventListener('keydown', function (e) {
    var now = Date.now();
    var timeSinceLast = now - lastKeyTime;
    lastKeyTime = now;

    var focused = document.activeElement;
    var productInput = document.querySelector('[data-role="product-search"] input');
    if (focused === productInput) return;

    clearTimeout(bufferTimer);
    if (e.key !== 'Enter' && e.key !== 'Tab' && e.key.length === 1) {
      if (timeSinceLast < BADGE_SPEED_MS || badgeBuffer.length > 0) {
        badgeBuffer += e.key;
      }
    }

    bufferTimer = setTimeout(function () {
      if (badgeBuffer.length > 3) {
        var input = document.querySelector('[data-role="customer-search"] input');
        if (input) setMuiValue(input, badgeBuffer);
      }
      badgeBuffer = '';
    }, 100);
  });

  // Transaction complete
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-role="button"]');
    if (btn && btn.textContent.trim() === 'Jetzt verkaufen') {
      setTimeout(resetSession, 3000);
    }
  });

  // Watch for dynamic React renders
  new MutationObserver(hideDynamicElements)
    .observe(document.body, { childList: true, subtree: true });

  hideDynamicElements();
  startResetTimer();
})();
```

---

## Magicline Vending API (for future custom POS)

Three POST endpoints available under `/open-api/device/vending/`:

### 1. Check authorization
`POST /open-api/device/vending/authorize`
Check if customer is authorized to use the vending device.

### 2. Product sale (dry-run possible)
`POST /open-api/device/vending/sale`

```json
{
  "identification": {},
  "transactionId": "uuid-here",
  "productId": "1",
  "price": 4.00,
  "shouldExecuteAction": false
}
```

Response includes `authorized`, `consumptionCredit`, `transactionId`, `price`.

Set `shouldExecuteAction: false` for dry-run (check only), `true` to actually charge.

### 3. Top up credit
`POST /open-api/device/vending/topup`
Top up customer's consumption credit.

**Note**: No product catalogue endpoint exists. Products must be hardcoded locally matching Magicline's configured prices exactly.

---

## Element Hide Reference

| Element | Selector type | Selector | Stable |
|---|---|---|---|
| Left sidebar | CSS stable | `nav.SidebarWrapper-sc-bb205641-0` | ✅ |
| Topbar | CSS stable | `[data-role="topbar"]` | ✅ |
| Global search | CSS stable | `[data-role="global-search-button"]` | ✅ |
| Category tree | CSS stable | `[data-role="categories"]` | ✅ |
| Customer search | CSS stable | `[data-role="customer-search"]` | ✅ |
| Three-dot menu | CSS stable | `[data-role="toolbar"] [data-role="icon-button"]` | ✅ |
| Rabatt button group | JS by text | Find button text "Rabatt" → hide parent `.MuiButtonGroup-root` | ✅ |
| Discount icon | JS by SVG path | Find path starting `m21.41 11.41` → hide parent button | ✅ |
| Product grid tablet | CSS fragile | `.MuiBox-root.css-p8umht` | ⚠️ |
| Kategorien button | CSS fragile | `.css-qo4f3u` | ⚠️ |
| Category h5 heading | CSS fragile | `.MuiTypography-h5.css-1b1c5ke` | ⚠️ |

---

## NFC / Badge Scan Logic

- Reader connects via **USB HID** — outputs keystrokes like a keyboard
- Badge scan fires characters at **< 50ms intervals** (human typing is much slower)
- Script uses timing to distinguish badge scan from human typing
- If product search field is focused → keystrokes go there naturally (staff scanning products)
- If any other state → capture buffer → inject into `[data-role="customer-search"] input`
- Uses React native input setter to bypass controlled input state:

```javascript
const setter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
).set;
setter.call(input, value);
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

---

## Reset Logic

- **After transaction**: Click listener on "Jetzt verkaufen" → 3 second delay → clear customer field
- **After 1 minute idle**: `setTimeout` 60000ms → clear customer field, reset on any `pointerdown`
- **On page reload / boot**: Fully Kiosk auto-starts → loads cash register URL → script runs

---

## Electron Setup Commands

```bash
mkdir bee-strong-kiosk
cd bee-strong-kiosk
npm init -y
npm install electron --save-dev
npm install electron-builder --save-dev
```

### package.json scripts

```json
{
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build:win": "electron-builder --win",
    "build:linux": "electron-builder --linux"
  },
  "build": {
    "appId": "com.beestrong.pos",
    "productName": "Bee Strong POS",
    "win": {
      "target": "nsis"
    },
    "linux": {
      "target": "AppImage"
    }
  }
}
```

### Auto-start on Windows boot

Add to package.json build config:
```json
"win": {
  "target": "nsis",
  "runAfterFinish": true
}
```

Or add registry entry in main.js:
```javascript
const { app } = require('electron');
app.setLoginItemSettings({
  openAtLogin: true,
  name: 'Bee Strong POS'
});
```

---

## TODO / Open Questions

- [ ] Confirm Magicline kiosk staff account credentials with minimum permissions
- [ ] Test Electron `insertCSS` vs MutationObserver approach for dynamic elements
- [ ] Test NFC HID badge scan timing on actual device with Electron
- [ ] Verify `css-p8umht`, `css-qo4f3u`, `css-1b1c5ke` selectors after next Magicline update
- [ ] Ask Magicline: does vending API `identification` field accept badge UID directly?
- [ ] Ask Magicline: is vending API permitted for custom kiosk UI (not automated vending machine)?
- [ ] Consider auto-update mechanism for the Electron app
- [ ] Windows auto-start and crash recovery testing
