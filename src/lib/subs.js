// Legendas em português buscadas no nosso servidor (OpenSubtitles, guardadas para todos os
// aparelhos: cloud/src/subs.js).
const BASE = (import.meta.env.VITE_LICENSE_API || 'https://gatesapptv.pages.dev').replace(/\/$/, '');

// Ligada pelo usuário: continua ligada nos próximos episódios/filmes até ele desligar.
export const subsSession = { on: false };

const MESSAGES = {
  not_found: 'Nenhuma legenda em português encontrada para este título.',
  quota: 'O limite diário de legendas foi atingido. Tente de novo amanhã.',
  no_meta: 'Não foi possível identificar este título para buscar a legenda.',
};
export const subsMessage = (code) => MESSAGES[code] || 'Não foi possível buscar a legenda agora. Tente de novo em instantes.';

// Endereço da busca: filme pelo código do IMDb/TMDB; episódio pelo da série + temporada/episódio.
export function subsQuery(item, meta) {
  if (!meta) return null;
  const q = new URLSearchParams();
  if (item.series) {
    if (!item.series.season || !item.series.episode) return null;
    if (meta.imdbId) q.set('pimdb', meta.imdbId);
    if (meta.id) q.set('ptmdb', meta.id);
    q.set('s', item.series.season);
    q.set('e', item.series.episode);
  } else {
    if (meta.imdbId) q.set('imdb', meta.imdbId);
    if (meta.id) q.set('tmdb', meta.id);
  }
  return q.has('imdb') || q.has('tmdb') || q.has('pimdb') || q.has('ptmdb') ? q.toString() : null;
}

const time = (s) => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s);
  return m ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : NaN;
};

// WebVTT -> [{ start, end, text }] em ordem de tempo.
export function parseVtt(vtt) {
  const cues = [];
  for (const block of vtt.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = time(a);
    const end = time(b);
    const text = lines.slice(i + 1).join('\n').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && text) cues.push({ start, end, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export async function fetchSubs(query) {
  const r = await fetch(`${BASE}/api/v1/subs?${query}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || 'failed');
  }
  const cues = parseVtt(await r.text());
  if (!cues.length) throw new Error('not_found');
  return cues;
}

// Falas no instante t (busca binária: legendas têm milhares de falas).
export function cuesAt(cues, t) {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  const out = [];
  for (let i = hi; i >= 0 && i > hi - 4; i--) if (cues[i].start <= t && t < cues[i].end) out.unshift(cues[i]);
  return out;
}
