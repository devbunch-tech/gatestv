// Ponte segura entre a página e o app do Windows (só o que a página precisa).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('GatesDesktop', {
  shutdown: () => ipcRenderer.invoke('gates:shutdown'),
  quit: () => ipcRenderer.invoke('gates:quit'),
});
