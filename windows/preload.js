const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('quireDesktop', {
  onOpenFile: cb => ipcRenderer.on('open-file', (_event, file) => cb(file)),
  ready: () => ipcRenderer.send('renderer-ready'),
  askCamera: () => ipcRenderer.invoke('ask-camera'),
  // Interface size from Settings: the window's zoom, so text, icons and pages all scale and stay sharp.
  setZoom: f => webFrame.setZoomFactor(Math.max(.8, Math.min(2, +f || 1))),
  // Send to Zotero: zotero(items in Zotero's item JSON) -> { ok, error }
  // Trusted timestamp: timestamp(url, request bytes) -> { bytes } or { error }
  timestamp: (url, req) => ipcRenderer.invoke('timestamp', url, req),
  zotero: items => ipcRenderer.invoke('zotero-save', items),
  // Document scanners (Windows): list() -> { ok, devices: [{ id, name }] }
  // scan({ device, source: 'flatbed'|'feeder'|'duplex', dpi, color: 'color'|'grey'|'bw', paper: 'auto'|'a4'|'letter'|'legal'|'a5', max, dialog }) -> { ok, error, warning, pages: [Uint8Array JPEG] }
  scanner: {
    list: () => ipcRenderer.invoke('scanner-list'),
    scan: opts => ipcRenderer.invoke('scanner-scan', opts)
  }
});
