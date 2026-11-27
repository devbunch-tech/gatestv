// Ponte segura entre a página e o app do Windows (só o que a página precisa).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('GatesDesktop', {
  shutdown: () => ipcRenderer.invoke('gates:shutdown'),
  quit: () => ipcRenderer.invoke('gates:quit'),
  otaInfo: () => ipcRenderer.invoke('gates:ota-info'),
  otaCheck: () => ipcRenderer.invoke('gates:ota-check'),
  otaApply: () => ipcRenderer.invoke('gates:ota-apply'),
  captureFrame: (opts) => ipcRenderer.invoke('gates:capture', opts), // { image (JPEG base64), w, h } | null
});
