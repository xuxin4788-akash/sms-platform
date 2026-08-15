const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getInitial: (cb) => {
    ipcRenderer.once('config:initial', (_e, data) => cb(data));
  },
  testServer: (url) => ipcRenderer.invoke('server:test', url),
  saveServer: (url) => ipcRenderer.invoke('server:save', url)
});
