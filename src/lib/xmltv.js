// Parser XMLTV por varredura de texto (sem DOM): rápido o bastante para guias de dezenas de MB
// e utilizável dentro de um Web Worker.
import { ratingToAge } from './parental';

export const normName = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(hd|fhd|uhd|4k|sd|h265|hevc)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');

export function parseXmltvDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?(\d{2})?/.exec(s || '');
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!m[7]) return utc;
  const off = (+m[8] * 60 + +(m[9] || 0)) * 60e3;
  return m[7] === '+' ? utc - off : utc + off;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m
    )
    .trim();

const attr = (s, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(s) || new RegExp(`\\b${name}='([^']*)'`).exec(s);
  return m ? decode(m[1]) : '';
};

function tags(body, tag) {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(body))) out.push({ attrs: m[1], text: decode(m[2]) });
  return out;
}
const pick = (list) => (list.find((t) => /lang="pt/i.test(t.attrs)) || list[0])?.text || '';

// wanted: { ids: Set<string lower>, names: Set<normName> } — limita aos canais existentes nas listas.
export function parseXmltvText(text, { from = -Infinity, to = Infinity, wanted } = {}) {
  const channels = {};
  const keep = new Set();
  const chRe = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
  let m;
  while ((m = chRe.exec(text))) {
    const id = attr(m[1], 'id');
    if (!id) continue;
    const names = tags(m[2], 'display-name').map((t) => t.text);
    const want = !wanted || wanted.ids.has(id.toLowerCase()) || names.some((n) => wanted.names.has(normName(n)));
    if (!want) continue;
    keep.add(id);
    const icon = /<icon\b[^>]*src="([^"]*)"/.exec(m[2]);
    channels[id] = { names, icon: icon ? decode(icon[1]) : '' };
  }
  // Canais sem <channel> declarado, mas citados pelo tvg-id.
  const programmes = {};
  let count = 0;
  const pRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  while ((m = pRe.exec(text))) {
    const a = m[1];
    const ch = attr(a, 'channel');
    if (wanted && !keep.has(ch) && !wanted.ids.has(ch.toLowerCase())) continue;
    const start = parseXmltvDate(attr(a, 'start'));
    const stop = parseXmltvDate(attr(a, 'stop'));
    if (!(stop > from) || !(start < to)) continue;
    const b = m[2];
    const rating = /<rating\b[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>/.exec(b);
    const icon = /<icon\b[^>]*src="([^"]*)"/.exec(b);
    (programmes[ch] ||= []).push({
      start,
      stop,
      title: pick(tags(b, 'title')) || 'Sem título',
      subtitle: pick(tags(b, 'sub-title')),
      desc: pick(tags(b, 'desc')),
      category: tags(b, 'category').map((t) => t.text).join(', '),
      year: +(pick(tags(b, 'date')).slice(0, 4)) || null,
      rating: ratingToAge(rating ? decode(rating[1]) : null),
      icon: icon ? decode(icon[1]) : '',
      episode: pick(tags(b, 'episode-num')),
    });
    count++;
  }
  for (const list of Object.values(programmes)) list.sort((x, y) => x.start - y.start);
  return { channels, programmes, count };
}
