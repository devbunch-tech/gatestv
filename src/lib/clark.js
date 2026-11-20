// Menu CLARK (só nas edições da família e admin, nunca para assinantes nem na degustação):
// canais do YouTube escolhidos para as crianças, com os vídeos mais recentes de cada um,
// vídeos avulsos (ex.: "Para dormir") e sugestões de canais parecidos para adicionar depois.
import { isDemo, isSubscriber } from './device';
import { NO_LOCAL_PROXY, fetchText } from './net';

export const HAS_CLARK = !isSubscriber && !isDemo;

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
