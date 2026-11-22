// Limpeza e comparação de títulos (sem dependências: usado também pelo script scripts/build-ratings.mjs).
export const normTitle = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const NOISE =
  /\b(4k|uhd|fhd|full ?hd|hd|sd|hdr|h\.?26[45]|hevc|x26[45]|1080p|720p|2160p|dublad[oa]s?|legendad[oa]s?|dual(?: [aá]udio)?|nacional|leg|dub|pt-?br|subtitled|web-?dl|bluray|remux|imax|trailer|teaser)\b/gi;

// "BR | Tears of Steel (2012) [4K] Dublado" -> { title: "Tears of Steel", year: 2012 }
export function cleanTitle(name) {
  let s = String(name || '');
  const ym = s.match(/[([]\s*((?:19|20)\d{2})\s*[)\]]|\b((?:19|20)\d{2})\s*$/);
  const year = ym ? +(ym[1] || ym[2]) : null;
  s = s
    .replace(/^\s*[A-Z]{2,3}\s*[|:]\s*/, '')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\bS\d{1,2}\s*E\d{1,4}\b.*$/i, '')
    .replace(NOISE, ' ')
    .replace(/[|_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—:|]+$/, '')
    .trim();
  if (year) s = s.replace(new RegExp(`\\s${year}$`), '').trim();
  return { title: s || String(name), year };
}

// ---------- Classificação indicativa do catálogo ----------
// O mesmo título aparece várias vezes na lista (4K, legendado, em várias categorias): a classificação
// é guardada por título (tipo + nome limpo + ano) e vale para todas as versões, em qualquer aparelho.
// Canais "24H" (uma série passando o dia todo) são classificados pelo nome da série.
const LIVE_NOISE = /^\s*\[?\s*24\s*h(?:oras)?\s*\]?\s*[-–:]?\s*|\s*[-–]?\s*\bT\d{1,2}\b.*$|\s+\bbx\b.*$|\s*\*+\s*$/gi;
export const is24h = (name) => /^\s*\[?\s*24\s*h\b/i.test(name || '') || /\bT\d{1,2}\b.*\bbx\b/i.test(name || '');
export function liveTitle(name) {
  let s = String(name || '');
  for (let i = 0; i < 3; i++) s = s.replace(LIVE_NOISE, '');
  return s.trim();
}
export function ratingKey(type, name, year) {
  if (type === 'live') {
    if (!is24h(name)) return null;
    const t = normTitle(liveTitle(name));
    return t ? `l|${t}|` : null;
  }
  const c = cleanTitle(name);
  const t = normTitle(c.title);
  return t ? `${type === 'movie' ? 'm' : 't'}|${t}|${c.year || year || ''}` : null;
}

// Classificação presumida pela categoria, para o que o TMDB não classificou.
const KIDS_GROUP = /infantil|kids|crian[cç]a|desenho|power rangers|baby/i;
const MILD_GROUP = /anima[cç][aã]o|fam[ií]lia/i;
const MATURE_GROUP = /terror|horror|\+ ?18|adult|er[oó]tic|xxx/i;
// Canais de filmes, séries, reality e novelas sem classificação no guia: 14 anos.
const LIVE_MOVIE_GROUP = /telecine|hbo|\bmax\b|filmes|cine|s[ée]ries|paramount|prime video|reality|fazenda|anime|dorama|novela|com[ée]dia|lives e shows/i;
// Canais de filmes e séries em qualquer categoria (ex.: "Telecine Action 4K" na categoria "4K").
const LIVE_MOVIE_NAME = /telecine|\bhbo\b|\bmax\b|megapix|\btnt\b|\bspace\b|warner|\baxn\b|a&e|\bamc\b|cinemax|universal|paramount|prime video|star channel|\bfx\b|\btcm\b|\bsony\b|\bfox\b|cine ?sky|netflix|\bsyfy\b|film|cine/i;
export function groupAge(it) {
  const groups = it.groups || [it.group];
  const any = (re) => groups.some((g) => re.test(g || ''));
  if (any(MATURE_GROUP)) return 18;
  if (any(KIDS_GROUP)) return 0;
  if (any(MILD_GROUP)) return 10;
  if (it.type === 'live' && (any(LIVE_MOVIE_GROUP) || LIVE_MOVIE_NAME.test(it.name || ''))) return 14;
  return null;
}

// Consulta o TMDB e devolve a idade (0, 10, 12, 14, 16, 18) ou -1 se não deu para saber.
// tmdb(path, params) => JSON. poster: endereço da capa da lista (quando é do TMDB, confirma o título).
const MOVIE_GENRE_AGE = { 27: 18, 10751: 10, 16: 10 }; // terror, família, animação
const TV_GENRE_AGE = { 10762: 0, 10751: 10, 16: 10 }; // infantil, família, animação
const CERT_US = { G: 0, 'TV-Y': 0, 'TV-Y7': 0, 'TV-G': 0, PG: 10, 'TV-PG': 10, 'PG-13': 12, 'TV-14': 14, R: 16, 'NC-17': 18, 'TV-MA': 18 };
// Outros países (quando não há a do Brasil nem a dos EUA): idade arredondada para cima na escala brasileira.
const CERT_OTHER = { U: 0, G: 0, A: 0, TP: 0, APTA: 0, AL: 0, T: 0, PG: 10, '12A': 12, M: 14, MA15: 16, 'R18+': 18, R18: 18, X: 18 };
const toBR = (n) => (n <= 0 ? 0 : n <= 10 ? 10 : n <= 12 ? 12 : n <= 14 ? 14 : n <= 16 ? 16 : 18);
export function certAge(value, other = false) {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s || ['N/A', 'NOT RATED', 'UNRATED', 'NR', 'NONE'].includes(s)) return null;
  if (['L', 'LIVRE', 'AL', 'ER', 'LIV'].includes(s)) return 0;
  if (!other && CERT_US[s] != null) return CERT_US[s];
  if (other) {
    if (CERT_OTHER[s] != null) return CERT_OTHER[s];
    const n = s.match(/d{1,2}/);
    return n ? toBR(+n[0]) : null;
  }
  const m = s.match(/(10|12|14|16|18)/);
  return m ? +m[1] : null;
}
const OTHER_CC = ['PT', 'ES', 'MX', 'AR', 'GB', 'FR', 'DE', 'CA', 'AU', 'NL', 'IT'];
// A mais restritiva entre os três primeiros países que classificaram.
function otherMax(pick) {
  const ages = OTHER_CC.map(pick).filter((a) => a != null).slice(0, 3);
  return ages.length ? Math.max(...ages) : null;
}
export async function classifyTitle(tmdb, { type, name, year, poster }) {
  const tv = type !== 'movie';
  const title = type === 'live' ? liveTitle(name) : cleanTitle(name).title;
  year = type === 'live' ? null : cleanTitle(name).year || year || null;
  const search = async (y) =>
    (await tmdb(tv ? '/search/tv' : '/search/movie', { query: title, ...(y ? (tv ? { first_air_date_year: y } : { year: y }) : {}) })).results || [];
  let results = await search(year);
  if (!results.length && year) results = await search(null);
  if (!results.length) return -1;
  const n = normTitle(title);
  const posterPath = /image\.tmdb\.org\/t\/p\/[^/]+(\/[^/?#]+)/.exec(poster || '')?.[1];
  const yOf = (r) => +(r.release_date || r.first_air_date || '').slice(0, 4) || null;
  const same = (r) => normTitle(r.title || r.name) === n || normTitle(r.original_title || r.original_name) === n;
  const best =
    (posterPath && results.find((r) => r.poster_path === posterPath)) ||
    results.find((r) => same(r) && (!year || Math.abs((yOf(r) || 0) - year) <= 1)) ||
    (results.length === 1 && (!year || Math.abs((yOf(results[0]) || 0) - year) <= 1) ? results[0] : null);
  if (!best) return -1;
  if (best.adult) return 18;
  let cert = null;
  if (tv) {
    const d = await tmdb(`/tv/${best.id}/content_ratings`);
    const pick = (cc, o) => certAge(d.results?.find((r) => r.iso_3166_1 === cc)?.rating, o);
    cert = pick('BR') ?? pick('US') ?? otherMax((cc) => pick(cc, true));
  } else {
    const d = await tmdb(`/movie/${best.id}/release_dates`);
    const pick = (cc, o) => {
      const ages = (d.results?.find((r) => r.iso_3166_1 === cc)?.release_dates || []).map((x) => certAge(x.certification, o)).filter((a) => a != null);
      return ages.length ? Math.max(...ages) : null;
    };
    cert = pick('BR') ?? pick('US') ?? otherMax((cc) => pick(cc, true));
  }
  if (cert != null) return cert;
  const g = best.genre_ids || [];
  const map = tv ? TV_GENRE_AGE : MOVIE_GENRE_AGE;
  if (g.includes(27)) return 18;
  const ages = g.map((x) => map[x]).filter((a) => a != null);
  return ages.length ? Math.max(...ages) : -1;
}
