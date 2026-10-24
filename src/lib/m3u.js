// Parser de listas M3U / M3U Plus (formato usado por provedores IPTV).

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const ATTR_RE = /([\w-]+)="([^"]*)"/g;
const EPISODE_RE = /^(.*?)[\s._\-|:]*S(\d{1,2})\s*[._-]?\s*E(\d{1,4})\b\s*[-–:]?\s*(.*)$/i;

function parseExtinf(line) {
  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(line))) attrs[m[1].toLowerCase()] = m[2];
  const rest = line.replace(ATTR_RE, '');
  const comma = rest.indexOf(',');
  const name = comma >= 0 ? rest.slice(comma + 1).trim() : '';
  return { attrs, name: name || attrs['tvg-name'] || 'Sem nome' };
}

function detectType(attrs, url, name, group) {
  const explicit = (attrs['tvg-type'] || attrs['type'] || '').toLowerCase();
  if (['live', 'movie', 'series'].includes(explicit)) return explicit;
  if (/\/series\//i.test(url)) return 'series';
  if (/\/movie\//i.test(url)) return 'movie';
  if (EPISODE_RE.test(name)) return 'series';
  const g = group.toLowerCase();
  if (/s[ée]ries?|temporada|novelas?/.test(g)) return 'series';
  if (/filmes?|movies?|vod|cinema|lan[çc]amentos/.test(g)) return 'movie';
  return 'live';
}

// URLs de EPG declaradas no cabeçalho: #EXTM3U url-tvg="..." (ou x-tvg-url), separadas por vírgula.
export function parseM3UHeader(text) {
  const first = text.slice(0, 2000).split(/\r?\n/).find((l) => l.trim().startsWith('#EXTM3U')) || '';
  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(first))) attrs[m[1].toLowerCase()] = m[2];
  const raw = attrs['url-tvg'] || attrs['x-tvg-url'] || attrs['tvg-url'] || '';
  return { epgUrls: raw.split(',').map((u) => u.trim()).filter(Boolean) };
}

export function parseM3U(text, playlistId) {
  const lines = text.split(/\r?\n/);
  const items = [];
  const seen = new Set();
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      cur = parseExtinf(line);
    } else if (line.startsWith('#EXTGRP:')) {
      if (cur) cur.attrs['group-title'] ||= line.slice(8).trim();
    } else if (line.startsWith('#')) {
      continue;
    } else if (cur) {
      const url = line;
      const group = cur.attrs['group-title'] || 'Sem categoria';
      const type = detectType(cur.attrs, url, cur.name, group);
      let id = playlistId + '-' + hash(url + '|' + cur.name);
      if (seen.has(id)) id += '-' + items.length;
      seen.add(id);

      const item = {
        id,
        playlistId,
        type,
        name: cur.name,
        url,
        group,
        logo: cur.attrs['tvg-logo'] || cur.attrs['logo'] || '',
        tvgId: cur.attrs['tvg-id'] || '',
        chno: cur.attrs['tvg-chno'] || '',
      };
      if (type === 'series') {
        const ep = cur.name.match(EPISODE_RE);
        item.series = ep
          ? { name: ep[1].trim() || cur.name, season: +ep[2], episode: +ep[3], title: ep[4].trim() }
          : { name: cur.name, season: 1, episode: 0, title: '' };
      }
      items.push(item);
      cur = null;
    }
  }
  return items;
}

// Agrupa episódios em séries (uma entrada por nome de série + playlist).
export function buildSeries(episodes) {
  const map = new Map();
  for (const ep of episodes) {
    const key = ep.playlistId + '|' + ep.series.name.toLowerCase();
    let s = map.get(key);
    if (!s) {
      s = {
        id: 'series-' + hash(key),
        type: 'series',
        name: ep.series.name,
        group: ep.group,
        logo: ep.logo,
        playlistId: ep.playlistId,
        episodes: [],
      };
      map.set(key, s);
    }
    if (!s.logo && ep.logo) s.logo = ep.logo;
    s.episodes.push(ep);
  }
  for (const s of map.values()) {
    s.episodes.sort((a, b) => a.series.season - b.series.season || a.series.episode - b.series.episode);
    s.seasons = [...new Set(s.episodes.map((e) => e.series.season))];
    for (const ep of s.episodes) ep.seriesId = s.id;
  }
  return [...map.values()];
}

export function groupBy(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.group)) map.set(it.group, []);
    map.get(it.group).push(it);
  }
  return map;
}
