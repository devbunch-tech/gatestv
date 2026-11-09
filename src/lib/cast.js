// Transmitir para Chromecast / Google TV e Smart TVs DLNA (só no app Android de celular e tablet:
// CastClient.java fala o protocolo do Chromecast e DlnaClient.java o DLNA/UPnP). A TV busca o vídeo
// direto do servidor. APKs antigos (sem DLNA) continuam listando só os Chromecast.
import { DEVICE } from './device';
import { playableUrl } from './health';

const N = () => (typeof window !== 'undefined' ? window.GatesAndroid : null);
export const canCast = typeof N()?.castStart === 'function' && DEVICE !== 'tv';

const parse = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
export const castDiscover = () => N()?.castDiscover();
export const castDevices = () => parse(N()?.castDevices(), []);
export const castStatus = () => parse(N()?.castStatus(), { state: 'idle' });
export const castPause = () => N()?.castPause();
export const castStop = () => N()?.castStop();
// Espelhar a tela do celular (Smart View / Transmitir do Android). Só nos APKs que têm o atalho.
export const canMirror = canCast && typeof N()?.mirrorScreen === 'function';
export const mirrorScreen = () => !!N()?.mirrorScreen();
export const isDlna = (device) => device?.kind === 'dlna';

// Aparelho escolhido: vale entre as trocas de canal/episódio (o player é remontado a cada troca).
export const castSession = { device: null };

const TYPES = { m3u8: 'application/x-mpegURL', mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', ts: 'video/mp2t', mov: 'video/quicktime' };

// Endereço que o Chromecast vai abrir: o do servidor da lista (nunca o proxy deste aparelho). Ao vivo
// do Xtream vai em HLS (.m3u8), que o Chromecast toca; o .ts direto ele não toca.
// Smart TVs (DLNA) tocam melhor o .ts original ao vivo do que o HLS.
export function castMedia(item, start = 0, device = null) {
  const live = item.type === 'live';
  const url = live && !isDlna(device) ? playableUrl(item, 1) : item.url;
  const ext = (/\.(\w+)(?:[?#].*)?$/.exec(url)?.[1] || '').toLowerCase();
  const image = /^https?:\/\//.test(item.logo || '') ? item.logo : '';
  return {
    url,
    contentType: TYPES[ext] || (live ? (isDlna(device) ? 'video/mp2t' : 'application/x-mpegURL') : 'video/mp4'),
    title: item.series ? `${item.series.name} · T${item.series.season}E${item.series.episode}` : item.displayName || item.name,
    image,
    live,
    start: live ? 0 : Math.max(0, Math.floor(start)),
  };
}

export const castStart = (device, item, start) => N()?.castStart(device.id, JSON.stringify(castMedia(item, start, device)));
