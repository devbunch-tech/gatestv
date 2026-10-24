// Metadados de filmes/séries/pessoas via TMDB (que também fornece o ID do IMDb)
// e, opcionalmente, nota do IMDb via OMDb.
import { get, set } from 'idb-keyval';
import { ratingToAge } from './parental';
import { imgSize } from '../config/perf';

const API = 'https://api.themoviedb.org/3';
const TTL = 7 * 24 * 3600e3;
let cfg = { tmdbKey: '', omdbKey: '', lang: 'pt-BR' };
const mem = new Map();

export function configureMeta(next) {
  cfg = { ...cfg, ...next };
}
export const hasMetaKey = () => !!cfg.tmdbKey?.trim();
// LITE: troca por tamanhos menores (ver src/config/perf.js).
export const img = (path, size = 'w500') => (path ? `https://image.tmdb.org/t/p/${imgSize(size)}${path}` : '');

function cached(key, fn) {
  if (mem.has(key)) return mem.get(key);
  const p = (async () => {
    try {
      const c = await get('meta:' + key);
      if (c && Date.now() - c.at < TTL) return c.v;
    } catch {
      /* cache indisponível */
    }
    const v = await fn();
    set('meta:' + key, { at: Date.now(), v }).catch(() => {});
    return v;
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}

async function tmdb(path, params = {}) {
  const key = cfg.tmdbKey?.trim();
  if (!key) throw new Error('Chave do TMDB não configurada.');
  const url = new URL(API + path);
  const bearer = key.length > 40; // token de leitura (v4) x api_key (v3)
  if (!bearer) url.searchParams.set('api_key', key);
  url.searchParams.set('language', cfg.lang);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: bearer ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' },
  });
  if (res.status === 401) throw new Error('Chave do TMDB inválida.');
  if (!res.ok) throw new Error(`TMDB respondeu HTTP ${res.status}.`);
  return res.json();
}

async function omdb(imdbId) {
  const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(cfg.omdbKey.trim())}`);
  const data = await res.json();
  if (data.Response === 'False') throw new Error(data.Error || 'OMDb: erro');
  return data;
}

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

const yearOf = (r) => +(r.release_date || r.first_air_date || '').slice(0, 4) || null;

const toCredit = (r, type) => ({
  type,
  id: r.id,
  title: r.title || r.name,
  originalTitle: r.original_title || r.original_name,
  year: yearOf(r),
  poster: r.poster_path,
  popularity: r.popularity || 0,
  character: r.character || '',
  job: r.job || '',
});

export function findTitle({ title, year, type = 'multi' }) {
  return cached(`find:${type}:${normTitle(title)}:${year || ''}`, async () => {
    const search = async (y) => {
      if (type === 'movie')
        return (await tmdb('/search/movie', { query: title, year: y })).results.map((r) => ({ ...r, media_type: 'movie' }));
      if (type === 'tv')
        return (await tmdb('/search/tv', { query: title, first_air_date_year: y })).results.map((r) => ({ ...r, media_type: 'tv' }));
      return (await tmdb('/search/multi', { query: title })).results.filter((r) => ['movie', 'tv'].includes(r.media_type));
    };
    let results = await search(year);
    if (!results.length && year && type !== 'multi') results = await search(null);
    if (!results.length) return null;
    const n = normTitle(title);
    const score = (r) =>
      (normTitle(r.title || r.name) === n || normTitle(r.original_title || r.original_name) === n ? 100 : 0) +
      (year && yearOf(r) === year ? 50 : 0) +
      Math.min(30, (r.popularity || 0) / 10);
    const best = results.slice(0, 10).sort((a, b) => score(b) - score(a))[0];
    return { type: best.media_type, id: best.id };
  });
}

function certification(d, type) {
  if (type === 'movie') {
    const pick = (cc) =>
      d.release_dates?.results?.find((r) => r.iso_3166_1 === cc)?.release_dates?.map((x) => x.certification).find(Boolean);
    return pick('BR') || pick('US') || null;
  }
  const pick = (cc) => d.content_ratings?.results?.find((r) => r.iso_3166_1 === cc)?.rating;
  return pick('BR') || pick('US') || null;
}

export function getDetails(type, id) {
  return cached(`d3:${type}:${id}`, async () => {
    const append =
      type === 'movie'
        ? 'credits,videos,release_dates,external_ids,recommendations,watch/providers'
        : 'aggregate_credits,credits,videos,content_ratings,external_ids,recommendations,watch/providers';
    const d = await tmdb(`/${type}/${id}`, { append_to_response: append, include_video_language: 'pt,en,null' });

    const cast =
      type === 'tv' && d.aggregate_credits?.cast?.length
        ? d.aggregate_credits.cast.map((c) => ({ id: c.id, name: c.name, character: c.roles?.[0]?.character, profile: c.profile_path }))
        : (d.credits?.cast || []).map((c) => ({ id: c.id, name: c.name, character: c.character, profile: c.profile_path }));
    const directors =
      type === 'movie'
        ? (d.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => ({ id: c.id, name: c.name }))
        : (d.created_by || []).map((c) => ({ id: c.id, name: c.name }));
    // Trailer em português do Brasil primeiro (BR > pt > títulos em português > inglês).
    const ptName = (v) => /dublad|legendad|trailer oficial|em portugu|pt-?br/i.test(v.name || '');
    const rank = (v) =>
      (v.iso_639_1 === 'pt' ? (v.iso_3166_1 === 'BR' ? 0 : 0.6) : ptName(v) ? 1 : 3) + (v.type === 'Trailer' ? 0 : 1) + (v.official ? 0 : 0.5);
    const trailers = (d.videos?.results || [])
      .filter((v) => v.site === 'YouTube' && ['Trailer', 'Teaser'].includes(v.type))
      .sort((a, b) => rank(a) - rank(b))
      .map((v) => ({ key: v.key, name: v.name, lang: v.iso_639_1 }));
    const certLabel = certification(d, type);
    const br = d['watch/providers']?.results?.BR;
    const prov = (list) => (list || []).sort((a, b) => a.display_priority - b.display_priority).map((x) => ({ id: x.provider_id, name: x.provider_name, logo: x.logo_path }));
    const providers = br ? { link: br.link, flatrate: prov(br.flatrate), free: prov(br.free), ads: prov(br.ads), rent: prov(br.rent), buy: prov(br.buy) } : null;

    const out = {
      type,
      id: d.id,
      title: d.title || d.name,
      originalTitle: d.original_title || d.original_name,
      year: yearOf(d),
      overview: d.overview,
      tagline: d.tagline,
      poster: d.poster_path,
      backdrop: d.backdrop_path,
      runtime: d.runtime || d.episode_run_time?.[0] || null,
      genres: (d.genres || []).map((g) => g.name),
      vote: d.vote_average,
      voteCount: d.vote_count,
      certLabel,
      cert: ratingToAge(certLabel),
      providers,
      imdbId: d.external_ids?.imdb_id || d.imdb_id || null,
      trailers,
      cast: cast.slice(0, 30),
      directors,
      seasons: d.number_of_seasons || null,
      recommendations: (d.recommendations?.results || []).slice(0, 20).map((r) => toCredit(r, r.media_type || type)),
    };
    if (!out.overview) {
      try {
        out.overview = (await tmdb(`/${type}/${id}`, { language: 'en-US' })).overview;
      } catch {
        /* sem sinopse */
      }
    }
    if (cfg.omdbKey?.trim() && out.imdbId) {
      try {
        const o = await omdb(out.imdbId);
        out.imdbRating = o.imdbRating !== 'N/A' ? o.imdbRating : null;
        out.imdbVotes = o.imdbVotes !== 'N/A' ? o.imdbVotes : null;
        if (out.cert == null) out.cert = ratingToAge(o.Rated);
      } catch {
        /* OMDb opcional */
      }
    }
    return out;
  });
}

export function getPerson(id) {
  return cached(`p:${id}`, async () => {
    const p = await tmdb(`/person/${id}`, { append_to_response: 'combined_credits,external_ids' });
    let bio = p.biography;
    if (!bio) {
      try {
        bio = (await tmdb(`/person/${id}`, { language: 'en-US' })).biography;
      } catch {
        /* sem biografia */
      }
    }
    const seen = new Map();
    for (const c of [...(p.combined_credits?.cast || []), ...(p.combined_credits?.crew || [])]) {
      if (c.media_type !== 'movie' && c.media_type !== 'tv') continue;
      const k = c.media_type + ':' + c.id;
      const cr = toCredit(c, c.media_type);
      const prev = seen.get(k);
      if (prev) {
        prev.character ||= cr.character;
        prev.job ||= cr.job;
      } else seen.set(k, cr);
    }
    return {
      id: p.id,
      name: p.name,
      bio,
      birthday: p.birthday,
      deathday: p.deathday,
      place: p.place_of_birth,
      profile: p.profile_path,
      department: p.known_for_department,
      imdbId: p.external_ids?.imdb_id || p.imdb_id || null,
      credits: [...seen.values()].sort((a, b) => b.popularity - a.popularity),
    };
  });
}

export async function testMetaKeys() {
  const out = {};
  try {
    await tmdb('/configuration');
    out.tmdb = 'ok';
  } catch (e) {
    out.tmdb = e.message;
  }
  if (cfg.omdbKey?.trim()) {
    try {
      await omdb('tt0111161');
      out.omdb = 'ok';
    } catch (e) {
      out.omdb = e.message;
    }
  }
  return out;
}
