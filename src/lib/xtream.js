// Integração Xtream Codes via player_api.php: categorias, datas de inclusão, séries
// (episódios carregados sob demanda) e EPG pelo xmltv.php.
import { WEB_BUILD, WEB_HINT, blockedByBrowser, isExternal } from './net';

export function parseXtreamUrl(url) {
  try {
    const u = new URL(url);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (!username || !password || !/\/(get|player_api|xmltv)\.php$/i.test(u.pathname)) return null;
    return { server: u.origin, username, password, output: u.searchParams.get('output') || 'ts' };
  } catch {
    return null;
  }
}

export const xtreamM3UUrl = (c) =>
  `${c.server}/get.php?${new URLSearchParams({ username: c.username, password: c.password, type: 'm3u_plus', output: c.output || 'ts' })}`;
export const xtreamEpgUrl = (c) =>
  `${c.server}/xmltv.php?${new URLSearchParams({ username: c.username, password: c.password })}`;

async function api(c, params, useProxy) {
  const url = `${c.server}/player_api.php?${new URLSearchParams({ username: c.username, password: c.password, ...params })}`;
  const target = useProxy && isExternal(url) ? '/proxy?raw=1&url=' + encodeURIComponent(url) : url;
  if (blockedByBrowser(url)) throw new Error('Este servidor Xtream usa um endereço http://, que os navegadores bloqueiam por segurança. ' + WEB_HINT);
  let res;
  try {
    res = await fetch(target);
  } catch {
    if (WEB_BUILD) throw new Error('O servidor Xtream não permite o acesso pelo navegador. ' + WEB_HINT);
    throw new Error('Não foi possível acessar o servidor Xtream. Confira o endereço (com http://), o usuário e a senha, e se a internet deste aparelho não bloqueia o servidor.');
  }
  if (!res.ok) throw new Error(`Servidor Xtream respondeu HTTP ${res.status}.`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Resposta inválida do servidor Xtream (não é JSON).');
  }
}

const ts = (v) => (+v > 0 ? +v * 1000 : 0);
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

export async function fetchXtreamCatalog(c, plId, useProxy) {
  const info = await api(c, {}, useProxy);
  if (info?.user_info && +info.user_info.auth === 0) throw new Error('Usuário ou senha do Xtream inválidos.');
  if (info?.user_info?.status && !/active/i.test(info.user_info.status))
    throw new Error(`Conta Xtream com status “${info.user_info.status}”.`);

  const [lc, vc, sc, live, vod, series] = await Promise.all([
    api(c, { action: 'get_live_categories' }, useProxy),
    api(c, { action: 'get_vod_categories' }, useProxy),
    api(c, { action: 'get_series_categories' }, useProxy),
    api(c, { action: 'get_live_streams' }, useProxy),
    api(c, { action: 'get_vod_streams' }, useProxy),
    api(c, { action: 'get_series' }, useProxy),
  ]);
  const cats = (list) => new Map(arr(list).map((x) => [String(x.category_id), x.category_name]));
  const [lcm, vcm, scm] = [cats(lc), cats(vc), cats(sc)];
  const base = `${c.server}`;
  const cred = `${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}`;
  const liveExt = c.output === 'm3u8' ? 'm3u8' : 'ts';
  const items = [];

  for (const s of arr(live)) {
    items.push({
      id: `${plId}-l${s.stream_id}`,
      playlistId: plId,
      type: 'live',
      name: s.name || 'Canal',
      url: `${base}/live/${cred}/${s.stream_id}.${liveExt}`,
      group: lcm.get(String(s.category_id)) || 'Sem categoria',
      logo: s.stream_icon || '',
      tvgId: s.epg_channel_id || '',
      chno: s.num ? String(s.num) : '',
      added: ts(s.added),
    });
  }
  for (const s of arr(vod)) {
    items.push({
      id: `${plId}-m${s.stream_id}`,
      playlistId: plId,
      type: 'movie',
      name: s.name || 'Filme',
      url: `${base}/movie/${cred}/${s.stream_id}.${s.container_extension || 'mp4'}`,
      group: vcm.get(String(s.category_id)) || 'Filmes',
      // A lista costuma pôr o filme em várias categorias (ex.: "Netflix" e "Ação").
      groups: catNames(s.category_ids, vcm),
      year: +s.year || null,
      logo: s.stream_icon || '',
      added: ts(s.added),
      score: +s.rating || null,
      tmdbId: s.tmdb_id || s.tmdb || null,
    });
  }
  for (const s of arr(series)) {
    items.push({
      id: `${plId}-s${s.series_id}`,
      playlistId: plId,
      type: 'series',
      shell: true,
      xtreamSeriesId: s.series_id,
      name: s.name || 'Série',
      group: scm.get(String(s.category_id)) || 'Séries',
      groups: catNames(s.category_ids, scm),
      runtime: +String(s.episode_run_time || '').replace(/D.*$/, '') || null,
      logo: s.cover || '',
      added: ts(s.last_modified),
      plot: s.plot || '',
      cast: s.cast || '',
      genre: s.genre || '',
      year: +(String(s.releaseDate || s.release_date || '').slice(0, 4)) || null,
      backdrop: arr(s.backdrop_path)[0] || '',
      trailer: s.youtube_trailer || '',
      score: +s.rating || null,
    });
  }
  return { items, info: info?.user_info || null };
}

// Nomes das categorias de um item (category_ids); vazio quando a lista só informa uma.
function catNames(ids, map) {
  const names = [...new Set((Array.isArray(ids) ? ids : []).map((id) => map.get(String(id))).filter(Boolean))];
  return names.length > 1 ? names : undefined;
}

export async function fetchXtreamEpisodes(c, shell, useProxy) {
  const data = await api(c, { action: 'get_series_info', series_id: shell.xtreamSeriesId }, useProxy);
  const cred = `${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}`;
  const out = [];
  const seasons = data?.episodes && typeof data.episodes === 'object' ? data.episodes : {};
  for (const [seasonKey, eps] of Object.entries(seasons)) {
    for (const ep of arr(eps)) {
      const season = +ep.season || +seasonKey || 1;
      const title = String(ep.title || '')
        .replace(new RegExp(`^${shell.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–:]?\\s*`, 'i'), '')
        .replace(/^S\d+\s*E\d+\s*[-–:]?\s*/i, '');
      out.push({
        id: `${shell.playlistId}-e${ep.id}`,
        playlistId: shell.playlistId,
        type: 'series',
        seriesId: shell.id,
        name: `${shell.name} S${String(season).padStart(2, '0')}E${String(ep.episode_num).padStart(2, '0')}`,
        url: `${c.server}/series/${cred}/${ep.id}.${ep.container_extension || 'mp4'}`,
        group: shell.group,
        logo: ep.info?.movie_image || shell.logo,
        series: { name: shell.name, season, episode: +ep.episode_num || 0, title },
        plot: ep.info?.plot || '',
        duration: +ep.info?.duration_secs || 0,
      });
    }
  }
  out.sort((a, b) => a.series.season - b.series.season || a.series.episode - b.series.episode);
  return out;
}

// Detalhes de um filme (get_vod_info) ou série (get_series_info): duração, sinopse, fundo…
export async function fetchXtreamInfo(c, item, useProxy) {
  const toMin = (v) => {
    if (!v) return null;
    if (/^\d+$/.test(String(v))) return +v > 400 ? Math.round(+v / 60) : +v; // segundos ou minutos
    const m = /^(\d+):(\d+)(?::(\d+))?$/.exec(String(v));
    return m ? +m[1] * 60 + +m[2] : null;
  };
  if (item.type === 'movie') {
    const vodId = /-m(\d+)$/.exec(item.id)?.[1] || /\/(\d+)\.\w+$/.exec(item.url || '')?.[1];
    if (!vodId) return null;
    const d = await api(c, { action: 'get_vod_info', vod_id: vodId }, useProxy);
    const i = d?.info || {};
    return {
      runtime: toMin(i.duration_secs) || toMin(i.duration) || toMin(i.episode_run_time),
      plot: i.plot || i.description || '',
      backdrop: arr(i.backdrop_path)[0] || i.cover_big || i.movie_image || '',
      genre: i.genre || '',
      year: +(String(i.releasedate || i.release_date || '').slice(0, 4)) || null,
      rating: +i.rating || null,
    };
  }
  if (item.shell) {
    const d = await api(c, { action: 'get_series_info', series_id: item.xtreamSeriesId }, useProxy);
    const i = d?.info || {};
    return {
      runtime: toMin(i.episode_run_time),
      plot: i.plot || '',
      backdrop: arr(i.backdrop_path)[0] || i.cover || '',
      genre: i.genre || '',
      year: +(String(i.releaseDate || i.release_date || '').slice(0, 4)) || null,
      rating: +i.rating || null,
      seasons: d?.episodes && typeof d.episodes === 'object' ? Object.keys(d.episodes).length : null,
    };
  }
  return null;
}
