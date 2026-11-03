// Bridge between the web app and Windows. The web app works without it (in a
// browser), and uses it when present to read/write files with native dialogs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quireDesktop', {
  platform: 'win32',
  open: () => ipcRenderer.invoke('quire:open'),
  save: (data, suggestedName, filePath) =>
    ipcRenderer.invoke('quire:save', { data, suggestedName, filePath }),
  onOpenFile: cb => ipcRenderer.on('quire:open-file', (_e, f) => cb(f)),
  onMenu: cb => ipcRenderer.on('quire:menu', (_e, cmd) => cb(cmd))
});

// Files opened from Explorer arrive as a File and are dropped onto the page, so
// the web app's existing drag-and-drop loader handles them unchanged.
ipcRenderer.on('quire:open-file', (_e, f) => {
  const deliver = () => {
    const file = new File([f.data], f.name, { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector('[data-drop-target]') || document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', deliver);
  else deliver();
});
