/* ===========================================================================
   PrintTrack kiosk shell.
   Runs the dashboard fullscreen on the dedicated shop PC — no browser chrome.

   Dev:   ELECTRON_START_URL=http://localhost:3100 electron electron/main.js
   Prod:  build the React app first (npm run build), then: electron electron/main.js
          (loads ../build/index.html — HashRouter works over file://)
   =========================================================================== */
const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

const START_URL = process.env.ELECTRON_START_URL;

function createWindow() {
  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: !START_URL,            // true kiosk in production, windowed in dev
    backgroundColor: '#0c0d10',   // matches the app background (no white flash)
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });

  if (START_URL) {
    win.loadURL(START_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'build', 'index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();

  // Escape hatch out of kiosk mode for the operator (Ctrl/Cmd+Shift+Q).
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
