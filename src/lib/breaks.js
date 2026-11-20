// Trailers de lançamentos no player de filmes e séries:
//  - antes de começar: 1 trailer;
//  - a cada 12 min assistidos: 2 trailers seguidos, e depois volta ao ponto em que parou.
// Só entram trailers de títulos adicionados recentemente à plataforma (os mesmos de
// "Filmes/Séries adicionados recentemente" no Início) e só se o trailer for dublado ou
// legendado em português do Brasil (vídeo marcado pt-BR no TMDB; os de Portugal ficam de fora).
import { recentUnique } from './home';
import { cleanTitle, findTitle, getDetails, hasMetaKey } from './meta';

export const BREAK_EVERY = 12 * 60; // segundos assistidos entre um intervalo e outro
export const BREAK_COUNT = 2; // trailers em cada intervalo
export const PREROLL_COUNT = 1; // trailers antes de começar
export const PREROLL_WAIT = 6; // segundos esperando o trailer de abertura antes de desistir
export const BREAK_SKIP_AFTER = 5; // segundos até liberar o "Pular"
export const BREAK_MAX = 180; // segundos: se o trailer não avisar que acabou, segue em frente
const RECENT = 30; // lançamentos considerados (os mais recentes adicionados, sem repetir título)
const TRIES = 12; // títulos consultados no TMDB por escolha

const ADULT = /adult|\+18|xxx|er[oó]tic/i;
// Trailer dublado ou legendado em PT-BR (as distribuidoras publicam as duas versões marcadas pt-BR).
export const isPtBrTrailer = (v) => v.lang === 'pt' && v.region === 'BR';
// Entre eles, o dublado primeiro.
const dubFirst = (a, b) => /dublad/i.test(b.name || '') - /dublad/i.test(a.name || '');

// Trailers já mostrados nesta sessão: evita repetir enquanto houver outros.
const shown = new Set();

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function trailerOf(it, type) {
  const name = it.displayName || it.series?.name || it.name;
  const { title, year } = cleanTitle(name);
  const found = await findTitle({ title, year, type: type === 'series' ? 'tv' : 'movie' }).catch(() => null);
  if (!found) return null;
  const d = await getDetails(found.type, found.id).catch(() => null);
  const t = (d?.trailers || []).filter(isPtBrTrailer).sort(dubFirst)[0];
  return t?.key ? { key: t.key, title: d.title || title } : null;
}

// Até `count` trailers diferentes de lançamentos do tipo pedido: [{ key (YouTube), title }].
export async function pickTrailers(catalog, type, { count = 1, exclude, isRestricted } = {}) {
  if (!hasMetaKey()) return []; // sem TMDB não dá para confirmar o idioma do trailer
  const pool = (type === 'series' ? catalog.series : catalog.movies).filter(
    (it) => it.id !== exclude && !(it.groups || [it.group]).some((g) => ADULT.test(g || '')) && !isRestricted?.(it)
  );
  const base = shuffle(recentUnique(pool, RECENT)).slice(0, TRIES);
  const found = (await Promise.all(base.map((it) => trailerOf(it, type).catch(() => null)))).filter(Boolean);
  const unique = [...new Map(found.map((t) => [t.key, t])).values()];
  // Primeiro os que ainda não passaram nesta sessão.
  const out = [...unique.filter((t) => !shown.has(t.key)), ...unique.filter((t) => shown.has(t.key))].slice(0, count);
  out.forEach((t) => shown.add(t.key));
  return out;
}
