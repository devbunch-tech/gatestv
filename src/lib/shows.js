// Programas de TV favoritos (lembretes): o perfil marca um programa no guia e o app avisa
// alguns minutos antes de ele começar naquele canal, pela programação (EPG) das listas.
import { baseName } from './zapping';
import { hash } from './m3u';

export const SHOW_LEAD = 5 * 60e3; // avisa 5 min antes
export const SHOW_HORIZON = 48 * 3600e3; // procura na programação das próximas 48 h
export const SHOW_LATE = 10 * 60e3; // ainda avisa se começou há menos de 10 min

// Título comparável: sem acentos, minúsculo, só letras/números separados por espaço.
const words = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export const showNorm = (title) => words(String(title || '').replace(/\s*[-–:|]\s*(ep(is[oó]dio)?\.?\s*\d+|ao vivo|in[eé]dito|reprise)\b.*$/i, ''));

// Programa favorito = título + canal (sem a qualidade: Globo HD e Globo FHD são o mesmo canal).
export function makeShow(prog, item) {
  const norm = showNorm(prog.title);
  const channel = baseName(item.name);
  return { id: hash(channel + '|' + norm), title: prog.title, norm, channel, channelName: item.name, at: Date.now() };
}
export const showIdOf = (prog, item) => hash(baseName(item.name) + '|' + showNorm(prog.title));

const matches = (show, prog) => {
  const n = showNorm(prog.title);
  return n === show.norm || n.startsWith(show.norm + ' ');
};

// Próximas exibições dos programas favoritos: [{ key, show, item, prog, alarmAt }], por horário.
export function upcomingShows(shows, live, programmesFor, now = Date.now()) {
  if (!shows?.length || !live?.length) return [];
  const wanted = new Set(shows.map((s) => s.channel));
  // Um canal por nome (o primeiro da lista que tiver programação).
  const channels = new Map();
  for (const it of live) {
    const b = baseName(it.name);
    if (!wanted.has(b) || channels.has(b)) continue;
    if (programmesFor(it)?.length) channels.set(b, it);
  }
  const out = [];
  for (const show of shows) {
    const item = channels.get(show.channel);
    if (!item) continue;
    for (const prog of programmesFor(item) || []) {
      if (prog.start > now + SHOW_HORIZON) break;
      if (prog.start < now - SHOW_LATE || !matches(show, prog)) continue;
      out.push({ key: `${show.id}@${prog.start}`, show, item, prog, alarmAt: prog.start - SHOW_LEAD });
    }
  }
  return out.sort((a, b) => a.prog.start - b.prog.start);
}

// Próxima exibição de um programa favorito (para mostrar na lista de favoritos).
export function nextAiring(show, live, programmesFor, now = Date.now()) {
  return upcomingShows([show], live, programmesFor, now)[0] || null;
}
