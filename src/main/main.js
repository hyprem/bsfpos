// src/main/main.js
// Bee Strong POS Kiosk — main process entry.
// Phase 1 plan 02: creates the single kiosk BrowserWindow and wires the
// ipcMain 'cash-register-ready' splash stub. Keyboard lockdown, single-instance
// lock, and globalShortcut registrations are added by plan 03 (REPLACES the
// ORCHESTRATION block below — do NOT move createMainWindow).

const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const log = require('./logger');

const isDev = process.env.NODE_ENV === 'development';

// --- createMainWindow -------------------------------------------------------
// Plan 03 imports/consumes this function unchanged. Keep it self-contained.

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    show: false,                      // don't show until ready-to-show → prevents white flash
    kiosk: !isDev,                    // D-07 dev gating
    fullscreen: !isDev,
    frame: isDev,                     // D-07
    autoHideMenuBar: true,
    backgroundColor: '#1A1A1A',       // UI-SPEC dominant color — zero flash at Phase 2 handoff
    paintWhenInitiallyHidden: true,   // ensures ready-to-show fires reliably
    width: isDev ? 420 : undefined,   // D-07 dev dimensions (vertical tablet sim)
    height: isDev ? 800 : undefined,
    resizable: isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,                // D-08: prod has no DevTools path
    },
  });

  // Belt + braces vs autoHideMenuBar
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    log.info('mainWindow ready-to-show — showing');
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('render-process-gone', details);
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'host', 'host.html'));

  // D-03: ipcMain stub for splash lift. Phase 2 fires this from the injection layer.
  // In Phase 1 this handler never fires — splash stays visible forever on a fresh
  // device, which is the correct Phase 1 end state per D-06.
  ipcMain.on('cash-register-ready', () => {
    log.info('cash-register-ready IPC received — lifting splash');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('splash:hide');
    }
  });

  return mainWindow;
}

module.exports = { createMainWindow, isDev };

// --- ORCHESTRATION (plan 03 REPLACES everything below this line) -----------

app.whenReady().then(() => {
  log.info('app ready — creating main window (plan 02 orchestration stub)');
  createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
