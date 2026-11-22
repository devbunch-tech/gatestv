// Trailers de lançamentos no player de filmes e séries:
//  - antes de começar: 1 trailer de lançamento da plataforma, 1 de lançamento nos cinemas do Brasil
//    e 1 crítica de filme/série do canal Ei Nerd;
//  - a cada 12 min assistidos: 2 trailers seguidos, e depois volta ao ponto em que parou.
// Só entram trailers de títulos adicionados recentemente à plataforma (os mesmos de
// "Filmes/Séries adicionados recentemente" no Início) e só se o trailer for dublado ou
// legendado em português do Brasil (vídeo marcado pt-BR no TMDB; os de Portugal ficam de fora).
import { recentUnique } from './home';
import { cinemaBR, cleanTitle, findTitle, getDetails, hasMetaKey, movieTrailersBR, normTitle } from './meta';
import { NO_LOCAL_PROXY, fetchText } from './net';

export const BREAK_EVERY = 12 * 60; // segundos assistidos entre um intervalo e outro
export const BREAK_COUNT = 2; // trailers em cada intervalo
export const PREROLL_COUNT = 2; // trailers da plataforma antes de começar (mais 1 do cinema = 3)
export const PREROLL_WAIT = 6; // segundos esperando o trailer de abertura antes de desistir
export const BREAK_SKIP_AFTER = 5; // segundos até liberar o "Pular"
export const BREAK_MAX = 180; // segundos: se o trailer não avisar que acabou, segue em frente
export const REVIEW_MAX = 30 * 60; // a crítica do Ei Nerd é mais longa (dá para pular depois de 5 s)
const RECENT = 80; // lançamentos considerados (os mais recentes adicionados, sem repetir título)
const TRIES = 16; // títulos consultados no TMDB por escolha
export const MAX_AGE = 16; // trailers só de títulos com classificação abaixo de 16 anos

const ADULT = /adult|\+18|xxx|er[oó]tic/i;
// Trailer dublado ou legendado em PT-BR (as distribuidoras publicam as duas versões marcadas pt-BR).
export const isPtBrTrailer = (v) => v.lang === 'pt' && v.region === 'BR';
// Entre eles, o dublado primeiro.
const DUB = /dublad|\bdub\b/i;
const dubFirst = (a, b) => DUB.test(b.name || '') - DUB.test(a.name || '');

// Vídeos que já passaram (mesmo pulados) não passam de novo por SEEN_DAYS: ficam guardados no
// aparelho. "reserved" evita escolher o mesmo vídeo duas vezes antes de ele aparecer na tela.
const SEEN = 'gates:trailers:seen';
const SEEN_DAYS = 30;
const reserved = new Set();
function seenMap() {
  try {
    return JSON.parse(localStorage.getItem(SEEN) || '{}');
  } catch {
    return {};
  }
}
const wasSeen = (key) => reserved.has(key) || key in seenMap();
// Chamado quando o vídeo aparece na tela.
export function markSeen(key) {
  const m = seenMap();
  const old = Date.now() - SEEN_DAYS * 864e5;
  for (const k of Object.keys(m)) if (m[k] < old) delete m[k];
  m[key] = Date.now();
  try {
    localStorage.setItem(SEEN, JSON.stringify(m));
  } catch {
    /* armazenamento cheio */
  }
}
// Classificação conhecida e abaixo de 16 anos (sem classificação também fica de fora).
// E nunca acima do limite do perfil (ex.: Melissa, 12 anos: trailers só até 12).
let profileLimit = null;
export const setTrailerAgeLimit = (n) => (profileLimit = n ?? null);
const ageOk = (cert) => cert != null && cert < MAX_AGE && (profileLimit == null || cert <= profileLimit);
const KIND = { movie: 'FILME', series: 'SÉRIE' };

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
  if (!ageOk(d?.cert)) return null;
  const t = (d?.trailers || []).filter((v) => isPtBrTrailer(v) && !wasSeen(v.key)).sort(dubFirst)[0];
  return t?.key
    ? { key: t.key, title: d.title || title, kind: 'trailer', label: `NO CATÁLOGO · ${KIND[type]}`, where: 'catalog', catalogId: it.id, cert: d.cert }
    : null;
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

// Só vídeos que ainda não passaram (sem repetir: se acabarem, não passa nenhum).
function takeNew(list, count) {
  const out = list.filter((t) => !wasSeen(t.key)).slice(0, count);
  out.forEach((t) => reserved.add(t.key));
  return out;
}

// ---------- Abertura: também um lançamento dos cinemas e uma crítica do Ei Nerd ----------

// Trailer de um filme em cartaz ou estreando nos cinemas do Brasil, só dublado ou legendado em PT-BR.
// Filme do catálogo com o mesmo título (para "também no catálogo" e "Assistir depois").
const titleIndex = new WeakMap();
function catalogMovieByTitle(catalog, ...titles) {
  if (!catalog?.movies) return null;
  let idx = titleIndex.get(catalog);
  if (!idx) {
    idx = new Map();
    for (const it of catalog.movies) {
      const k = normTitle(cleanTitle(it.displayName || it.name).title);
      if (k && !idx.has(k)) idx.set(k, it.id);
    }
    titleIndex.set(catalog, idx);
  }
  for (const t of titles) {
    const id = t && idx.get(normTitle(t));
    if (id) return id;
  }
  return null;
}

export async function pickCinemaTrailer(catalog) {
  if (!hasMetaKey()) return null;
  const list = shuffle(await cinemaBR().catch(() => [])).slice(0, TRIES);
  const found = (
    await Promise.all(
      list.map(async (m) => {
        const d = await getDetails('movie', m.id).catch(() => null);
        if (!ageOk(d?.cert)) return null;
        const t = (await movieTrailersBR(m.id).catch(() => [])).filter((v) => isPtBrTrailer(v) && !wasSeen(v.key)).sort(dubFirst)[0];
        if (!t?.key) return null;
        const catalogId = catalogMovieByTitle(catalog, m.title, d?.originalTitle);
        return { key: t.key, title: m.title, kind: 'trailer', label: catalogId ? 'NOS CINEMAS · TAMBÉM NO CATÁLOGO' : 'NOS CINEMAS · FILME', where: 'cinema', catalogId, cert: d.cert };
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

// ---------- Sobre o que vai passar: crítica do Ei Nerd e entrevista oficial ----------

// Título do conteúdo em português e o original (pelo TMDB), já normalizados para comparar.
async function contentInfo(content) {
  if (!content?.name) return null;
  const { title, year } = cleanTitle(content.name);
  const titles = new Set([normTitle(title)]);
  let display = title;
  let original = '';
  if (hasMetaKey()) {
    const found = await findTitle({ title, year, type: content.type === 'series' ? 'tv' : 'movie' }).catch(() => null);
    const d = found && (await getDetails(found.type, found.id).catch(() => null));
    if (d?.title) {
      display = d.title;
      titles.add(normTitle(d.title));
    }
    if (d?.originalTitle) {
      original = d.originalTitle;
      titles.add(normTitle(d.originalTitle));
    }
  }
  return { display, original, titles: [...titles].filter((t) => t.length >= 3) };
}
// O nome do vídeo cita o conteúdo (título inteiro, como palavras).
const aboutContent = (videoTitle, info) => {
  const v = ` ${normTitle(videoTitle)} `;
  return info.titles.some((t) => v.includes(` ${t} `));
};

const secsOf = (txt) => String(txt || '').split(':').reduce((s, x) => s * 60 + (+x || 0), 0);

// Vídeos de uma página do YouTube (busca geral ou busca dentro de um canal).
function ytVideos(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    const v = o.videoRenderer;
    if (v?.videoId) {
      const owner = v.ownerText?.runs?.[0] || v.longBylineText?.runs?.[0];
      out.push({
        key: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '',
        secs: secsOf(v.lengthText?.simpleText),
        channel: owner?.text || '',
        channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId || '',
        verified: (v.ownerBadges || []).some((b) => /VERIFIED|ARTIST/.test(b.metadataBadgeRenderer?.style || '')),
      });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  return out;
}

const YT_CACHE = 'gates:yt:'; // resultados de busca guardados por 3 dias
async function ytSearch(url) {
  try {
    const c = JSON.parse(localStorage.getItem(YT_CACHE + hashKey(url)) || 'null');
    if (c && Date.now() - c.at < 3 * 864e5) return c.list;
  } catch {
    /* sem cache */
  }
  const list = await fetchText(url, !NO_LOCAL_PROXY)
    .then(ytVideos)
    .catch(() => null);
  if (!list) return [];
  try {
    localStorage.setItem(YT_CACHE + hashKey(url), JSON.stringify({ at: Date.now(), list: list.slice(0, 30) }));
  } catch {
    /* armazenamento cheio */
  }
  return list;
}
const hashKey = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

// O dono do vídeo deixa tocar fora do YouTube? (oEmbed responde erro quando não deixa.)
const embedOk = (key) =>
  fetchText(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + key)}`, !NO_LOCAL_PROXY)
    .then((t) => /"html"/.test(t))
    .catch(() => false);
async function firstEmbeddable(list) {
  for (const v of list.slice(0, 4)) if (await embedOk(v.key)) return v;
  return null;
}

// Crítica do Ei Nerd SOBRE este filme/série (das playlists de críticas, dos envios recentes ou da
// busca dentro do canal). Sem uma crítica do próprio conteúdo, não passa nenhuma.
const REVIEW_ANY = /opini[aã]o sincera|\breview\b|cr[ií]tica|an[aá]lise|vale a pena|assisti\b|[ée] bom\?|decepcion|obra[- ]prima/i;
const NOT_REVIEW = /trailer|teaser|vem a[ií]|vazou|vazamento|rumor|teoria|easter egg|curiosidade|bastidores|data de estreia/i;
export async function pickEiNerdReview(content) {
  const info = await contentInfo(content);
  if (!info?.titles.length) return null;
  const ok = (v) => aboutContent(v.title, info) && REVIEW_ANY.test(v.title) && !NOT_REVIEW.test(v.title);
  let list = (await eiNerdReviews()).filter(ok);
  if (!list.length) {
    const found = await ytSearch(`https://www.youtube.com/@einerdtv/search?query=${encodeURIComponent(info.display)}&hl=pt-BR&gl=BR`);
    list = found
      .filter((v) => (!v.channelId || v.channelId === EI_NERD) && v.secs >= 120 && ok(v))
      .map((v) => ({ key: v.key, title: v.title, label: 'CRÍTICA · EI NERD', max: REVIEW_MAX }));
  }
  const v = await firstEmbeddable(list.filter((x) => !wasSeen(x.key)));
  if (v) reserved.add(v.key);
  return v ? { ...v, label: 'CRÍTICA · EI NERD', max: REVIEW_MAX } : null;
}

// Entrevista oficial (elenco, direção, dubladores) sobre este filme/série: até 8 min, de canal
// verificado (distribuidoras, streamings e produtores de conteúdo), português primeiro.
export const INTERVIEW_MAX = 8 * 60;
const INTERVIEW = /entrevista|interview|elenco|\bcast\b|dublador|bate[- ]papo|conversa|fala(m)? sobre|press junket|junket|bastidores|behind the scenes|making of/i;
const NOT_INTERVIEW = /trailer|teaser|cr[ií]tica|review|react|rea[cç][aã]o|an[aá]lise|teoria|explicad|resumo|opini[aã]o|vale a pena|\bshorts?\b|#shorts/i;
const OFFICIAL = /pictures|studios?\b|filmes|films?\b|netflix|prime video|amazon mgm|hbo|\bmax\b|disney|pixar|marvel|paramount|universal|warner|sony|lionsgate|a24|apple tv|globoplay|star\+|diamond|paris filmes|imagem filmes|california filmes/i;
const PT = /entrevista|elenco|dublador|bate[- ]papo|conversa|fala(m)? sobre|bastidores|[ãõçáéíóú]/i;
export async function pickInterview(content) {
  const info = await contentInfo(content);
  if (!info?.titles.length) return null;
  const ok = (v) => v.verified && v.secs >= 45 && v.secs <= INTERVIEW_MAX && aboutContent(v.title, info) && INTERVIEW.test(v.title) && !NOT_INTERVIEW.test(v.title);
  const search = (q) => ytSearch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=pt-BR&gl=BR`).then((l) => l.filter(ok));
  let list = await search(`${info.display} entrevista elenco`);
  if (!list.length && info.original && normTitle(info.original) !== normTitle(info.display)) list = await search(`${info.original} cast interview`);
  const rank = (v) => (PT.test(v.title) ? 0 : 2) + (OFFICIAL.test(v.channel) ? 0 : 1);
  list = [...new Map(list.map((v) => [v.key, v])).values()].sort((a, b) => rank(a) - rank(b));
  const v = await firstEmbeddable(list.filter((x) => !wasSeen(x.key)));
  if (v) reserved.add(v.key);
  return v ? { key: v.key, title: v.title, label: `ENTREVISTA · ${v.channel.toUpperCase()}`, max: INTERVIEW_MAX + 30, cc: !PT.test(v.title) } : null;
}

// Abertura, nesta ordem: 2 lançamentos da plataforma e 1 dos cinemas, entrevista sobre o
// conteúdo e crítica do Ei Nerd sobre ele. Devolve uma promessa por fonte (null = ficou de fora),
// para o player começar pelo primeiro pronto e ir juntando os outros na fila.
export const PREROLL_SLOW = 15; // segundos para a entrevista e a crítica (buscas no YouTube)
export function prerollSources(catalog, type, opts = {}, content = null) {
  const within = (p, secs) => Promise.race([p.catch(() => null), new Promise((r) => setTimeout(() => r(null), secs * 1000))]);
  // 3 trailers: plataforma, cinema e plataforma de novo (os dois primeiros são obrigatórios).
  const platform = pickTrailers(catalog, type, { ...opts, count: PREROLL_COUNT });
  return [
    within(platform.then((l) => (l[0] ? { ...l[0], mandatory: true } : null)), PREROLL_WAIT),
    within(pickCinemaTrailer(catalog).then((t) => (t ? { ...t, mandatory: true } : null)), PREROLL_WAIT),
    within(platform.then((l) => l[1] || null), PREROLL_WAIT),
    within(pickInterview(content), PREROLL_SLOW),
    within(pickEiNerdReview(content), PREROLL_SLOW),
  ];
}
