// Smart TVs Samsung (Tizen) e LG (webOS): teclas do controle e saída do app.
import { PLATFORM } from './device';

// Tizen só entrega ao app as teclas de mídia, de canal e numéricas que forem registradas.
const TIZEN_KEYS = [
  'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
  'MediaTrackNext', 'MediaTrackPrevious', 'ChannelUp', 'ChannelDown', 'Info',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

export function initSmartTv() {
  const html = document.documentElement;
  html.classList.add('smarttv', 'smarttv-' + PLATFORM);
  if (PLATFORM === 'tizen') {
    for (const k of TIZEN_KEYS) {
      try {
        window.tizen.tvinputdevice.registerKey(k);
      } catch {
        /* tecla inexistente neste modelo */
      }
    }
  }
  // gap em flexbox só existe a partir do Chromium 84 (TVs 2022+); antes disso o CSS usa margens.
  try {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    d.appendChild(document.createElement('div'));
    d.appendChild(document.createElement('div'));
    document.body.appendChild(d);
    if (d.scrollHeight !== 1) html.classList.add('no-flexgap');
    d.remove();
  } catch {
    /* ignore */
  }
}

// "Voltar" na tela inicial: fecha o app.
export function exitApp() {
  try {
    if (PLATFORM === 'tizen') return window.tizen.application.getCurrentApplication().exit();
  } catch {
    /* ignore */
  }
  try {
    if (PLATFORM === 'webos' && window.webOS?.platformBack) return window.webOS.platformBack();
  } catch {
    /* ignore */
  }
  window.close();
}
