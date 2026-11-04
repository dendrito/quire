const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quireDesktop', {
  onOpenFile: cb => ipcRenderer.on('open-file', (_event, file) => cb(file)),
  ready: () => ipcRenderer.send('renderer-ready'),
  askCamera: () => ipcRenderer.invoke('ask-camera'),
  // Send to Zotero: zotero(items in Zotero's item JSON) -> { ok, error }
  zotero: items => ipcRenderer.invoke('zotero-save', items)
});
