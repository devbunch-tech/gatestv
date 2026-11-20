// Trailers de lançamentos no player de filmes e séries:
//  - antes de começar: 1 trailer de lançamento da plataforma, 1 de lançamento nos cinemas do Brasil
//    e 1 crítica de filme/série do canal Ei Nerd;
//  - a cada 12 min assistidos: 2 trailers seguidos, e depois volta ao ponto em que parou.
// Só entram trailers de títulos adicionados recentemente à plataforma (os mesmos de
// "Filmes/Séries adicionados recentemente" no Início) e só se o trailer for dublado ou
// legendado em português do Brasil (vídeo marcado pt-BR no TMDB; os de Portugal ficam de fora).
import { recentUnique } from './home';
import { cinemaBR, cleanTitle, findTitle, getDetails, hasMetaKey, movieTrailersBR } from './meta';
import { NO_LOCAL_PROXY, fetchText } from './net';

export const BREAK_EVERY = 12 * 60; // segundos assistidos entre um intervalo e outro
export const BREAK_COUNT = 2; // trailers em cada intervalo
export const PREROLL_COUNT = 1; // trailers antes de começar
export const PREROLL_WAIT = 6; // segundos esperando o trailer de abertura antes de desistir
export const BREAK_SKIP_AFTER = 5; // segundos até liberar o "Pular"
export const BREAK_MAX = 180; // segundos: se o trailer não avisar que acabou, segue em frente
export const REVIEW_MAX = 30 * 60; // a crítica do Ei Nerd é mais longa (dá para pular depois de 5 s)
const RECENT = 30; // lançamentos considerados (os mais recentes adicionados, sem repetir título)
const TRIES = 12; // títulos consultados no TMDB por escolha

const ADULT = /adult|\+18|xxx|er[oó]tic/i;
// Trailer dublado ou legendado em PT-BR (as distribuidoras publicam as duas versões marcadas pt-BR).
export const isPtBrTrailer = (v) => v.lang === 'pt' && v.region === 'BR';
// Entre eles, o dublado primeiro.
const DUB = /dublad|\bdub\b/i;
const dubFirst = (a, b) => DUB.test(b.name || '') - DUB.test(a.name || '');

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
  return takeNew(unique, count);
}

// Primeiro os que ainda não passaram nesta sessão.
function takeNew(list, count) {
  const out = [...list.filter((t) => !shown.has(t.key)), ...list.filter((t) => shown.has(t.key))].slice(0, count);
  out.forEach((t) => shown.add(t.key));
  return out;
}

// ---------- Abertura: também um lançamento dos cinemas e uma crítica do Ei Nerd ----------

// Trailer de um filme em cartaz ou estreando nos cinemas do Brasil, só dublado ou legendado em PT-BR.
export async function pickCinemaTrailer() {
  if (!hasMetaKey()) return null;
  const list = shuffle(await cinemaBR().catch(() => [])).slice(0, TRIES);
  const found = (
    await Promise.all(
      list.map(async (m) => {
        const t = (await movieTrailersBR(m.id).catch(() => [])).filter(isPtBrTrailer).sort(dubFirst)[0];
        return t?.key ? { key: t.key, title: m.title, label: 'NOS CINEMAS' } : null;
      })
    )
  ).filter(Boolean);
  return takeNew(found, 1)[0] || null;
}

// Ei Nerd: só vídeos de crítica de filme ou série do próprio canal (nunca shorts nem outros assuntos).
const EI_NERD = 'UCt_4wzTQqmcUvemNkeO0plA';
// Playlists de críticas do canal (o canal abre uma por ano). Novas entram aqui.
const EI_NERD_REVIEWS = ['PLfNkggzMsXM7HlbSTlfVyBuKKmKlY8KN6']; // "Reviews 2026"
// Nos envios recentes do canal, só os que são claramente crítica.
const REVIEW_TITLE = /opini[aã]o sincera|\breview\b|cr[ií]tica/i;
const feed = (q) => `https://www.youtube.com/feeds/videos.xml?${q}`;
let eiNerdCache = null; // { at, list }

function parseFeed(xml) {
  return xml
    .split('<entry>')
    .slice(1)
    .map((e) => {
      const g = (re) => (e.match(re) || [])[1] || '';
      const title = g(/<title>([^<]*)<\/title>/)
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return { key: g(/<yt:videoId>([\w-]{11})<\/yt:videoId>/), channel: g(/<yt:channelId>([^<]+)<\/yt:channelId>/), link: g(/<link rel="alternate" href="([^"]+)"/), title };
    })
    .filter((v) => v.key && v.channel === EI_NERD && !/\/shorts\//.test(v.link));
}

async function eiNerdReviews() {
  if (eiNerdCache && Date.now() - eiNerdCache.at < 6 * 3600e3) return eiNerdCache.list;
  const useProxy = !NO_LOCAL_PROXY;
  const get = (url) => fetchText(url, useProxy).then(parseFeed).catch(() => []);
  const [lists, uploads] = await Promise.all([
    Promise.all(EI_NERD_REVIEWS.map((id) => get(feed(`playlist_id=${id}`)))),
    get(feed(`channel_id=${EI_NERD}`)),
  ]);
  const all = [...lists.flat(), ...uploads.filter((v) => REVIEW_TITLE.test(v.title))];
  const list = [...new Map(all.map((v) => [v.key, { key: v.key, title: v.title, label: 'CRÍTICA · EI NERD', max: REVIEW_MAX }])).values()];
  if (list.length) eiNerdCache = { at: Date.now(), list };
  return list;
}

// Uma crítica do Ei Nerd (das mais recentes, sem repetir na sessão enquanto houver outras).
export async function pickEiNerdReview() {
  const list = (await eiNerdReviews()).slice(0, 10);
  return takeNew(shuffle(list), 1)[0] || null;
}

// Abertura completa, nesta ordem: lançamento da plataforma, lançamento nos cinemas e crítica do Ei Nerd.
// Cada fonte tem até PREROLL_WAIT segundos; a que não responder fica de fora.
export async function pickPreroll(catalog, type, opts = {}) {
  const within = (p) => Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(null), PREROLL_WAIT * 1000))]);
  const list = await Promise.all([
    within(pickTrailers(catalog, type, { ...opts, count: PREROLL_COUNT }).then((l) => l[0] || null)),
    within(pickCinemaTrailer()),
    within(pickEiNerdReview()),
  ]);
  return [...new Map(list.filter(Boolean).map((t) => [t.key, t])).values()];
}
