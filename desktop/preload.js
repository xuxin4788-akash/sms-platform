const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  server: {
    get: () => ipcRenderer.invoke('server:get'),
    test: (url) => ipcRenderer.invoke('server:test', url),
    save: (url) => ipcRenderer.invoke('server:save', url)
  }
});
