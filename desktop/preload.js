const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getInitial: () => ipcRenderer.invoke('server:get'),
  testServer: (url) => ipcRenderer.invoke('server:test', url),
  saveServer: (url) => ipcRenderer.invoke('server:save', url)
});
