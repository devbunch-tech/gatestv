// Ponte segura entre a página da narração e o app do Windows (GATES Narração).
// Tudo devolve Promise. Eventos para a página (window): 'gates-narr-mode' {mode} e
// 'gates-narr-action' {id} — disparados pelo main (electron/narracao.cjs).
const { contextBridge, ipcRenderer } = require('electron');

const ota = {
  otaInfo: () => ipcRenderer.invoke('gates:ota-info'),
  otaCheck: () => ipcRenderer.invoke('gates:ota-check'),
  otaApply: () => ipcRenderer.invoke('gates:ota-apply'),
};

contextBridge.exposeInMainWorld('GatesNarr', {
  setMode: (mode) => ipcRenderer.invoke('gates-narr:mode', mode), // 'mini' | 'full'
  getMode: () => ipcRenderer.invoke('gates-narr:get-mode'),
  setCorner: (corner) => ipcRenderer.invoke('gates-narr:corner', corner), // 'tl' | 'tr' | 'bl' | 'br'
  audioApps: () => ipcRenderer.invoke('gates-narr:audio-apps'), // [{id, name, title, volume, muted, active}]
  audioStatus: () => ipcRenderer.invoke('gates-narr:audio-status'), // {ok, error}
  setAppVolume: (id, volume) => ipcRenderer.invoke('gates-narr:app-volume', id, volume), // volume 0-1
  setAppMute: (id, muted) => ipcRenderer.invoke('gates-narr:app-mute', id, muted),
  win: (action) => ipcRenderer.invoke('gates-narr:win', action), // 'min' | 'max' | 'close'
  // Foto da tela onde está a janela: { image (JPEG base64), w, h, win, page } (retângulos em px do quadro).
  captureScreen: (opts) => ipcRenderer.invoke('gates-narr:capture', opts),
  quit: () => ipcRenderer.invoke('gates:quit'),
  ...ota,
});

// A tela "Procurar atualizações" (src/lib/updates.js) e a busca por voz reconhecem o app do
// Windows por window.GatesDesktop.
contextBridge.exposeInMainWorld('GatesDesktop', { quit: () => ipcRenderer.invoke('gates:quit'), ...ota });
