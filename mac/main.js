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

// Send to Zotero: pass items to the Zotero app on this computer through its connector server (the one the Zotero browser
// button uses). It runs here, in the main process, so the renderer's offline block stays as it is and Zotero sees a local client.
ipcMain.handle('zotero-save', async (_event, items) => {
  const base = 'http://127.0.0.1:23119/connector/';
  const H = { 'Content-Type': 'application/json', 'X-Zotero-Connector-API-Version': '3' };
  try {
    const ping = await fetch(base + 'ping', { method: 'POST', headers: H, body: '{}', signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (!ping) return { ok: false, error: 'Zotero is not running. Open the Zotero app and try again.' };
    const sessionID = 'quire-' + Date.now().toString(36);
    const r = await fetch(base + 'saveItems', { method: 'POST', headers: H, body: JSON.stringify({ sessionID, uri: 'quire://library', items: (items || []).map((it, i) => ({ id: 'q' + i, ...it })) }), signal: AbortSignal.timeout(20000) });
    if (r.status === 201) return { ok: true };
    return { ok: false, error: r.status === 500 ? 'Zotero could not save the items. Is a library or collection selected?' : `Zotero answered ${r.status}` };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
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

  // Offline guarantee: refuse every request that would leave this computer. The one exception is downloading an OCR
  // language the user picked in the language manager (a read-only GET of a public model file; nothing is sent).
  const OCR_DOWNLOAD = /^https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@tesseract\.js-data\/[a-z_]+@1\.0\.0\/4\.0\.0_best_int\/[a-z_]+\.traineddata\.gz$/;
  // Estante, the owner's own Calibre server, runs on this computer; Send to Estante may reach its API there.
  const ESTANTE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\//;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = /^(https?|wss?|ftp):/i.test(details.url) && !(details.method === 'GET' && OCR_DOWNLOAD.test(details.url)) && !ESTANTE.test(details.url);
    if (blocked) console.warn('Blocked network request:', details.url);
    callback({ cancel: blocked });
  });

  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
