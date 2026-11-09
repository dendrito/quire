const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('quireDesktop', {
  onOpenFile: cb => ipcRenderer.on('open-file', (_event, file) => cb(file)),
  ready: () => ipcRenderer.send('renderer-ready'),
  askCamera: () => ipcRenderer.invoke('ask-camera'),
  // Interface size from Settings: the window's zoom, so text, icons and pages all scale and stay sharp.
  setZoom: f => webFrame.setZoomFactor(Math.max(.8, Math.min(2, +f || 1))),
  // Document scanners (Image Capture): list() -> { ok, devices: [{ id, name, caps }] }
  // scan({ device, source, dpi, color, paper, max }) -> { ok, pages: [bytes], error, warning, simplex }
  // The Mac has no maker's scanner window to open, so dialog is false.
  scanner: {
    dialog: false,
    list: () => ipcRenderer.invoke('scanner-list'),
    scan: opts => ipcRenderer.invoke('scanner-scan', opts)
  },
  // Send to Zotero: zotero(items in Zotero's item JSON) -> { ok, error }
  // Trusted timestamp: timestamp(url, request bytes) -> { bytes } or { error }
  timestamp: (url, req) => ipcRenderer.invoke('timestamp', url, req),
  zotero: items => ipcRenderer.invoke('zotero-save', items)
});
