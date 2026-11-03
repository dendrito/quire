const { app, BrowserWindow, shell, ipcMain, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, 'app');
let win = null;
let rendererReady = false;
const pending = [];

app.setAppUserModelId('local.quire.pdfstudio');

// The app is served from a private app:// address instead of file://, so OCR's background
// workers and data files load the same way they would from a web server, but from inside the app.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// On Windows, a PDF opened from Explorer ("Open with", double-click, drag onto the icon)
// arrives as a command-line argument.
function pdfsIn(argv) {
  return argv.slice(1).filter(a => !a.startsWith('-') && /\.pdf$/i.test(a) && fs.existsSync(a));
}

// Send PDFs to the page.
function flush() {
  if (!win || !rendererReady) return;
  while (pending.length) {
    const file = pending.shift();
    try {
      win.webContents.send('open-file', { name: path.basename(file), data: fs.readFileSync(file) });
      app.addRecentDocument(file);
    } catch (e) {
      console.error('Could not read', file, e);
    }
  }
}

// One window only: opening another PDF while the app runs sends it to the open window as a new tab.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    pending.push(...pdfsIn(argv));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      flush();
    }
  });
}

pending.push(...pdfsIn(process.argv));

// The scanner asks before opening the camera. Windows has no per-app prompt for desktop apps
// (it uses Settings > Privacy > Camera), so the answer is always yes here.
ipcMain.handle('ask-camera', async () => true);

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
    autoHideMenuBar: true,
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

  // Offline guarantee: refuse every request that would leave this computer.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = /^(https?|wss?|ftp):/i.test(details.url);
    if (blocked) console.warn('Blocked network request:', details.url);
    callback({ cancel: blocked });
  });

  // Media access is limited to the camera (for the scanner); the microphone stays off. Other permissions keep Electron's defaults.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permission !== 'media' || (details.mediaTypes || []).every(t => t === 'video'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => permission !== 'media' || !details || !details.mediaType || details.mediaType === 'video');

  createWindow();
});

app.on('window-all-closed', () => app.quit());
