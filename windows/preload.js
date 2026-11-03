const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quireDesktop', {
  onOpenFile: cb => ipcRenderer.on('open-file', (_event, file) => cb(file)),
  ready: () => ipcRenderer.send('renderer-ready'),
  askCamera: () => ipcRenderer.invoke('ask-camera'),
  // Document scanners (Windows): list() -> { ok, devices: [{ id, name }] }
  // scan({ device, source: 'flatbed'|'feeder'|'duplex', dpi, color: 'color'|'grey'|'bw', dialog }) -> { ok, error, warning, pages: [Uint8Array JPEG] }
  scanner: {
    list: () => ipcRenderer.invoke('scanner-list'),
    scan: opts => ipcRenderer.invoke('scanner-scan', opts)
  }
});
