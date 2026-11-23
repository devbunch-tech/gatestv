// Narração pelo YouTube nos jogos ao vivo: canais que narram a partida só no áudio (sem imagens).
// A pessoa escolhe a live pelo nome do canal, o som do jogo fica mudo e a narração toca num
// player pequeno do YouTube (visível, como o YouTube exige). Os narradores favoritos ficam no aparelho.
import { NO_LOCAL_PROXY, fetchText } from './net';

const FAV_KEY = 'gates:narr:favs';
const SUB_KEY = 'gates:narr:subscribed';

const load = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') ?? d;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* armazenamento cheio */
  }
};

// ---------- Narradores favoritos ----------
export const loadFavs = () => load(FAV_KEY, []);
export function toggleFav(ch) {
  const l = loadFavs();
  const next = l.some((x) => x.id === ch.id) ? l.filter((x) => x.id !== ch.id) : [...l, { id: ch.id, name: ch.name }];
  save(FAV_KEY, next);
  return next;
}

// Canais em que a pessoa disse que já é inscrita (não pergunta de novo).
export const isSubscribed = (id) => load(SUB_KEY, []).includes(id);
export const markSubscribed = (id) => save(SUB_KEY, [...new Set([...load(SUB_KEY, []), id])]);
export const subscribeUrl = (id) => `https://www.youtube.com/channel/${id}?sub_confirmation=1`;

// Termo de busca para um jogo (ex.: "Flamengo x Vasco narração ao vivo").
export const queryFor = (game) => (game ? `${game.homeShort || game.home} x ${game.awayShort || game.away} narração ao vivo` : 'narração ao vivo futebol');

const initialData = (html) => {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
};

// Lives encontradas na busca do YouTube (filtro "Ao vivo"). O YouTube alterna entre dois formatos
// de página (videoRenderer e lockupViewModel): lê os dois.
function parseLives(data) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    const v = o.videoRenderer;
    if (v?.videoId) {
      const owner = v.ownerText?.runs?.[0] || v.longBylineText?.runs?.[0];
      const j = JSON.stringify(v.badges || []) + JSON.stringify(v.thumbnailOverlays || []);
      out.push({
        key: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '',
        channel: owner?.text || '',
        channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId || '',
        viewers: (v.viewCountText?.runs || []).map((r) => r.text).join('') || v.viewCountText?.simpleText || '',
        live: /LIVE/.test(j),
      });
      return;
    }
    const l = o.lockupViewModel;
    if (l?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && l.contentId) {
      const j = JSON.stringify(l);
      const rows = l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const parts = rows.flatMap((r) => (r.metadataParts || []).map((p) => p.text?.content || '')).filter(Boolean);
      out.push({
        key: l.contentId,
        title: l.metadata?.lockupMetadataViewModel?.title?.content || '',
        channel: (j.match(/"a11yLabel":"(?:Acessar o canal|Go to channel) ([^"]+)"/) || [])[1] || parts[0] || '',
        channelId: (j.match(/"browseId":"(UC[\w-]{22})"/) || [])[1] || '',
        viewers: parts.find((x) => /assistindo|watching/i.test(x)) || '',
        live: /BADGE_STYLE_LIVE/.test(j),
      });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  return [...new Map(out.filter((x) => x.live && x.channelId).map((x) => [x.key, x])).values()].slice(0, 12);
}

export async function searchLives(q) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgJAAQ%253D%253D&hl=pt-BR&gl=BR`;
  for (let i = 0; i < 2; i++) {
    const data = initialData(await fetchText(i ? url + '&r=' + Date.now() : url, !NO_LOCAL_PROXY));
    const list = data ? parseLives(data) : [];
    if (list.length || data) return list;
  }
  return [];
}

// Live de agora de um canal (null se não estiver ao vivo).
export async function channelLive(id) {
  const html = await fetchText(`https://www.youtube.com/channel/${id}/live?hl=pt-BR`, !NO_LOCAL_PROXY);
  const key = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1];
  if (!key || !/"isLive":true/.test(html)) return null;
  const title = (html.match(/<meta name="title" content="([^"]*)"/) || [])[1] || '';
  return { key, title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") };
}
