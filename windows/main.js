const { app, BrowserWindow, shell, ipcMain, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const os = require('os');
const { execFile } = require('child_process');

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

// Document scanners, through Windows Image Acquisition (scanner/wia.ps1, run by the built-in PowerShell).
// Settings travel in environment variables, never inside the script text.
const WIA_SCRIPT = fs.readFileSync(path.join(__dirname, 'scanner', 'wia.ps1'), 'utf8');
function runWia(env, timeoutMs) {
  return new Promise(resolve => {
    const encoded = Buffer.from(WIA_SCRIPT, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        const line = String(stdout || '').trim().split(/\r?\n/).pop();
        try { resolve(JSON.parse(line)); }
        catch { resolve({ ok: false, error: err && err.killed ? 'The scanner took too long to answer.' : 'Could not reach Windows scanning.' }); }
      });
  });
}
ipcMain.handle('scanner-list', async () => {
  if (process.platform !== 'win32') return { ok: false, devices: [], error: 'Scanners are supported in the Windows app.' };
  return runWia({ QUIRE_SCAN_ACTION: 'list' }, 30000);
});
ipcMain.handle('scanner-scan', async (_event, opts = {}) => {
  if (process.platform !== 'win32') return { ok: false, pages: [], error: 'Scanners are supported in the Windows app.' };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-scan-'));
  try {
    const r = await runWia({
      QUIRE_SCAN_ACTION: opts.dialog ? 'dialog' : 'scan',
      QUIRE_SCAN_DEVICE: String(opts.device || ''),
      QUIRE_SCAN_SOURCE: ['flatbed', 'feeder', 'duplex'].includes(opts.source) ? opts.source : 'flatbed',
      QUIRE_SCAN_DPI: String(Math.max(75, Math.min(1200, parseInt(opts.dpi, 10) || 300))),
      QUIRE_SCAN_COLOR: ['color', 'grey', 'bw'].includes(opts.color) ? opts.color : 'color',
      QUIRE_SCAN_MAX: String(Math.max(0, Math.min(500, parseInt(opts.max, 10) || 0))),
      QUIRE_SCAN_PAPER: ['a4', 'letter', 'legal', 'a5'].includes(opts.paper) ? opts.paper : 'auto',
      QUIRE_SCAN_OUT: out
    }, 15 * 60 * 1000);
    // Only files inside our own temporary folder are read back.
    const pages = (r.files || []).filter(f => path.dirname(path.resolve(f)) === out).map(f => new Uint8Array(fs.readFileSync(f)));
    return { ok: !!r.ok, error: r.error || '', warning: r.warning || '', pages };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
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
