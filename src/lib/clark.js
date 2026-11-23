// Áreas do YouTube do menu (CLARK, Sergio, Paula; assinantes: Youtube e Youtube Crianças): canais com
// os vídeos mais recentes, vídeos avulsos (ex.: "Para dormir") e sugestões de canais para adicionar.
import { EDITION } from './device';
import { NO_LOCAL_PROXY, fetchText } from './net';


// Canais fixos do menu (ID do canal no YouTube).
export const CLARK_CHANNELS = [
  { id: 'UCa0Nja57-8BPQn3C2e-qhhw', name: 'Minha Vida É Uma Viagem' },
  { id: 'UCFd6zTH1vHgpEkmtyMf2kMQ', name: 'Clube do Pititico' },
  { id: 'UCpVGe6vxJ6YXUSwEPF-xeqw', name: 'Família Lüdtke' },
];
// Vídeos avulsos.
export const CLARK_VIDEOS = [{ key: 'ELY08moRqsw', title: 'Para dormir', sub: 'Som de chuva · tela preta · 24 horas' }];
// Sugestões parecidas (infantil cristão, músicas e aprendizado), todas de canais verificados.
export const CLARK_SUGGESTIONS = [
  { id: 'UCb08zJgXapidkizIaEN5EfQ', name: '3Palavrinhas', about: 'Desenhos e músicas com histórias da Bíblia' },
  { id: 'UCyMRcSgL__Zw5jPtO7UI_iA', name: 'Crianças Diante do Trono', about: 'Louvor infantil' },
  { id: 'UCrEgEisv68HIY9gRCCeiEBA', name: 'Smilingüido', about: 'A formiguinha e os valores cristãos' },
  { id: 'UCeVpY5P9nvQavvVMaGadIyg', name: 'Bento e Totó', about: 'Músicas infantis' },
  { id: 'UCGs6qb1ohFhDzeHbYeJlsAA', name: 'Palavra Cantada', about: 'Músicas e brincadeiras' },
  { id: 'UC0cGVh96osM7yqMu0ENSKKQ', name: 'Mundo Bita', about: 'Músicas e aprendizado' },
  { id: 'UCBAb_DK4GYZqZR9MFA7y2Xg', name: 'Galinha Pintadinha', about: 'Músicas para os pequenos' },
];

// Áreas do YouTube no menu. Cada uma com canais fixos (podem ser zero), vídeos avulsos, sugestões e
// os canais que a pessoa adiciona (guardados no aparelho em 'store'). 'editions': onde aparece;
// 'kidsOk': aparece também em perfis infantis.
export const YT_AREAS = [
  { id: 'clark', path: '/clark', title: 'CLARK', icon: 'star', channels: CLARK_CHANNELS, videos: CLARK_VIDEOS, suggestions: CLARK_SUGGESTIONS, store: 'gates:clark:added', editions: ['family', 'admin'], kidsOk: true },
  {
    id: 'sergio',
    path: '/yt/sergio',
    title: 'Sergio',
    icon: 'tv',
    channels: [
      { id: 'UCtq7-pva03GoIMsHJdoSS5A', name: 'Na Torcida Vascaínos' },
      { id: 'UCt_4wzTQqmcUvemNkeO0plA', name: 'Ei Nerd' },
      { id: 'UCJ__lXDgtOLMTPyTSn6mUdA', name: 'Podcast Cruzmaltino' },
    ],
    store: 'gates:yt:sergio:added',
    editions: ['family', 'admin'],
  },
  { id: 'paula', path: '/yt/paula', title: 'Paula', icon: 'heart', channels: [], store: 'gates:yt:paula:added', editions: ['family', 'admin'] },
  // Assinantes: uma área livre e a infantil (igual à do Clark).
  { id: 'youtube', path: '/yt/youtube', title: 'Youtube', icon: 'tv', channels: [], store: 'gates:yt:youtube:added', editions: ['subscriber'] },
  { id: 'criancas', path: '/yt/criancas', title: 'Youtube Crianças', icon: 'star', channels: CLARK_CHANNELS, videos: CLARK_VIDEOS, suggestions: CLARK_SUGGESTIONS, store: 'gates:yt:criancas:added', editions: ['subscriber'], kidsOk: true },
];
// Áreas desta edição para o perfil (perfis infantis só veem as infantis).
export const areasFor = (profile) => YT_AREAS.filter((a) => a.editions.includes(EDITION) && (a.kidsOk || !profile?.kids));
export const areaById = (id) => YT_AREAS.find((a) => a.id === id && a.editions.includes(EDITION)) || null;

export const thumb = (key) => `https://i.ytimg.com/vi/${key}/mqdefault.jpg`;

// Vídeos recentes de um canal (feed do YouTube, sem shorts), guardados por 1 h no aparelho.
const KEY = 'gates:clark:feed:';
export async function channelVideos(id) {
  try {
    const c = JSON.parse(localStorage.getItem(KEY + id) || 'null');
    if (c && Date.now() - c.at < 3600e3) return c.list;
  } catch {
    /* sem cache */
  }
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, !NO_LOCAL_PROXY);
  const list = xml
    .split('<entry>')
    .slice(1)
    .map((e) => {
      const g = (re) => (e.match(re) || [])[1] || '';
      return {
        key: g(/<yt:videoId>([\w-]{11})<\/yt:videoId>/),
        title: g(/<title>([^<]*)<\/title>/).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
        link: g(/<link rel="alternate" href="([^"]+)"/),
        date: g(/<published>([^<]+)<\/published>/),
      };
    })
    .filter((v) => v.key && !/\/shorts\//.test(v.link));
  try {
    localStorage.setItem(KEY + id, JSON.stringify({ at: Date.now(), list }));
  } catch {
    /* armazenamento cheio */
  }
  return list;
}

// Todos os vídeos de um canal, 30 por página (servidor: cloud/src/youtube.js). 'next' vem da página anterior.
const API = (import.meta.env.VITE_LICENSE_API || 'https://gatesapptv.pages.dev').replace(/\/$/, '');
export async function allVideosPage(id, next = '') {
  const r = await fetch(`${API}/api/v1/yt/videos?ch=${encodeURIComponent(id)}${next ? '&next=' + encodeURIComponent(next) : ''}`);
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.message || 'Não foi possível carregar os vídeos do canal agora.');
  return { list: j.videos, next: j.next || null };
}

// Busca de canais pelo nome (resultados do YouTube só do tipo "Canal"). O YouTube alterna entre
// dois formatos de página (channelRenderer e o novo lockupViewModel): lê os dois e, se vier vazio,
// tenta mais uma vez.
const deepStrings = (o, out = []) => {
  if (typeof o === 'string') out.push(o);
  else if (o && typeof o === 'object') for (const k in o) deepStrings(o[k], out);
  return out;
};
function parseChannels(html) {
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
    const c = o.channelRenderer;
    if (c?.channelId) {
      out.push({
        id: c.channelId,
        name: c.title?.simpleText || '',
        about: [c.videoCountText?.simpleText, c.subscriberCountText?.simpleText].find((x) => /inscrit/i.test(x || '')) || '',
        verified: (c.ownerBadges || []).length > 0,
        photo: c.thumbnail?.thumbnails?.slice(-1)[0]?.url?.replace(/^\/\//, 'https://') || '',
      });
      return;
    }
    const l = o.lockupViewModel;
    if (l && /^UC[\w-]{22}$/.test(l.contentId || '')) {
      const strs = deepStrings(l);
      const json = JSON.stringify(l);
      out.push({
        id: l.contentId,
        name: l.metadata?.lockupMetadataViewModel?.title?.content || '',
        about: strs.find((x) => /inscrit/i.test(x)) || '',
        verified: /CHECK_CIRCLE|VERIFIED/.test(json),
        photo: (strs.find((x) => /^(https:)?\/\/yt\d?\.(ggpht|googleusercontent)\.com\//.test(x)) || '').replace(/^\/\//, 'https://'),
      });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  // Tira os canais automáticos "- Tema" do YouTube e repetidos.
  return [...new Map(out.filter((c) => c.name && !/ - Tema$/.test(c.name)).map((c) => [c.id, c])).values()].slice(0, 6);
}

export async function searchChannels(q) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D&hl=pt-BR&gl=BR`;
  for (let i = 0; i < 2; i++) {
    const list = parseChannels(await fetchText(i ? url + '&r=' + Date.now() : url, !NO_LOCAL_PROXY));
    if (list.length) return list;
  }
  return [];
}
