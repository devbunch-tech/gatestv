// Transmitir para Chromecast / Google TV (só no app Android de celular e tablet: a ponte nativa
// CastClient.java fala o protocolo do Chromecast). O Chromecast busca o vídeo direto do servidor.
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

// Aparelho escolhido: vale entre as trocas de canal/episódio (o player é remontado a cada troca).
export const castSession = { device: null };

const TYPES = { m3u8: 'application/x-mpegURL', mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', ts: 'video/mp2t', mov: 'video/quicktime' };

// Endereço que o Chromecast vai abrir: o do servidor da lista (nunca o proxy deste aparelho). Ao vivo
// do Xtream vai em HLS (.m3u8), que o Chromecast toca; o .ts direto ele não toca.
export function castMedia(item, start = 0) {
  const live = item.type === 'live';
  const url = live ? playableUrl(item, 1) : item.url;
  const ext = (/\.(\w+)(?:[?#].*)?$/.exec(url)?.[1] || '').toLowerCase();
  const image = /^https?:\/\//.test(item.logo || '') ? item.logo : '';
  return {
    url,
    contentType: TYPES[ext] || (live ? 'application/x-mpegURL' : 'video/mp4'),
    title: item.series ? `${item.series.name} · T${item.series.season}E${item.series.episode}` : item.displayName || item.name,
    image,
    live,
    start: live ? 0 : Math.max(0, Math.floor(start)),
  };
}

export const castStart = (device, item, start) => N()?.castStart(device.id, JSON.stringify(castMedia(item, start)));
