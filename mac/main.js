const { app, BrowserWindow, shell, ipcMain, protocol, net, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, 'app');
let win = null;
let rendererReady = false;
const pending = [];

// The app is served from a private app:// address instead of file://, so OCR's background
// workers and data files load the same way they would from a web server, but from inside the app.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// Send PDFs opened from Finder ("Open With", double-click, drag onto the Dock icon) to the page.
function flush() {
  if (!win || !rendererReady) return;
  while (pending.length) {
    const file = pending.shift();
    try {
      win.webContents.send('open-file', { name: path.basename(file), data: fs.readFileSync(file) });
    } catch (e) {
      console.error('Could not read', file, e);
    }
  }
}

app.on('open-file', (event, file) => {
  event.preventDefault();
  pending.push(file);
  if (app.isReady() && !win) createWindow();
  flush();
});

// The scanner asks for the camera through macOS's own permission prompt the first time it opens.
ipcMain.handle('ask-camera', async () => {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return true;
  try { return await systemPreferences.askForMediaAccess('camera'); } catch { return false; }
});

ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  flush();
});

function createWindow() {
  rendererReady = false;
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'Quire PDF Studio',
    backgroundColor: '#eceff3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  });
  win.loadURL('app://quire/index.html');
  // Links open in the default browser; the app window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) event.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  protocol.handle('app', request => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(APP_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(APP_DIR + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // Media access is limited to the camera (for the scanner); the microphone stays off. Other permissions keep Electron's defaults.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permission !== 'media' || (details.mediaTypes || []).every(t => t === 'video'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => permission !== 'media' || !details || !details.mediaType || details.mediaType === 'video');

  // Offline guarantee: refuse every request that would leave this computer.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = /^(https?|wss?|ftp):/i.test(details.url);
    if (blocked) console.warn('Blocked network request:', details.url);
    callback({ cancel: blocked });
  });

  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
