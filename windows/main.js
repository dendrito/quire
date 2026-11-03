// Quire PDF Studio: Windows desktop wrapper.
// Loads the shared single-file web app offline. Nothing is uploaded: every
// request that leaves the computer is blocked.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

app.setAppUserModelId('studio.quire.pdf');

let win = null;
let pendingFiles = [];

function pdfArgs(argv) {
  return argv.slice(app.isPackaged ? 1 : 2)
    .filter(a => !a.startsWith('-') && /\.pdf$/i.test(a) && fs.existsSync(a));
}

function sendFile(file) {
  if (!win) { pendingFiles.push(file); return; }
  const data = fs.readFileSync(file);
  win.webContents.send('quire:open-file', {
    name: path.basename(file), path: file, data: new Uint8Array(data)
  });
  app.addRecentDocument(file);
}

// Only one window: opening a PDF from Explorer while the app runs hands it over.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    pdfArgs(argv).forEach(sendFile);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

async function openDialog() {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] },
              { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp'] },
              { name: 'All files', extensions: ['*'] }]
  });
  if (!r.canceled) r.filePaths.forEach(sendFile);
}

function send(cmd) { if (win) win.webContents.send('quire:menu', cmd); }

function buildMenu() {
  const template = [
    { label: '&File', submenu: [
      { label: '&Open…', accelerator: 'Ctrl+O', click: openDialog },
      { label: '&Save', accelerator: 'Ctrl+S', click: () => send('save') },
      { label: 'Save &As…', accelerator: 'Ctrl+Shift+S', click: () => send('save-as') },
      { type: 'separator' },
      { label: '&Print…', accelerator: 'Ctrl+P', click: () => win && win.webContents.print() },
      { type: 'separator' },
      { role: 'quit', label: 'E&xit' }
    ]},
    { label: '&Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: '&View', submenu: [
      { role: 'zoomIn', accelerator: 'Ctrl+=' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' }, { role: 'togglefullscreen' },
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }
    ]},
    { label: '&Help', submenu: [
      { label: 'About Quire PDF Studio', click: () => dialog.showMessageBox(win, {
          type: 'info', title: 'Quire PDF Studio',
          message: `Quire PDF Studio ${app.getVersion()}`,
          detail: 'Works fully offline. Your documents never leave this computer.'
        }) }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function lockDownNetwork() {
  // Local resources are always allowed. The only remote requests allowed are
  // downloads (GET) of code libraries and OCR language data from public CDNs,
  // in case the web app loads any; nothing can be sent out (no POST/PUT).
  const cdn = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|tessdata\.projectnaptha\.com)\//i;
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const local = /^(file|data|blob|devtools|chrome-extension):/i.test(details.url);
    const lib = details.method === 'GET' && cdn.test(details.url);
    cb({ cancel: !(local || lib) });
  });
  // Camera is needed by the batch scanner; deny everything else.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => {
    cb(['media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'Quire PDF Studio',
    backgroundColor: '#f5f5f7',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    const files = pendingFiles; pendingFiles = [];
    files.forEach(sendFile);
  });
  win.on('closed', () => { win = null; });
}

// Save bytes produced by the web app to disk with a native dialog.
ipcMain.handle('quire:save', async (_e, { suggestedName, data, filePath }) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName || 'document.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (r.canceled) return { canceled: true };
    target = r.filePath;
  }
  fs.writeFileSync(target, Buffer.from(data));
  app.addRecentDocument(target);
  return { canceled: false, path: target };
});
ipcMain.handle('quire:open', openDialog);

app.whenReady().then(() => {
  lockDownNetwork();
  buildMenu();
  pendingFiles.push(...pdfArgs(process.argv));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
