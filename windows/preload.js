const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quireDesktop', {
  onOpenFile: cb => ipcRenderer.on('open-file', (_event, file) => cb(file)),
  ready: () => ipcRenderer.send('renderer-ready'),
  askCamera: () => ipcRenderer.invoke('ask-camera')
});
