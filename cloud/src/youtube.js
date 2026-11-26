// Todos os vídeos de um canal do YouTube, 30 por página (aba "Vídeos", do mais novo para o mais
// antigo). O feed RSS só traz os 15 últimos; a lista completa vem da API interna do site do YouTube,
// que exige POST — por isso roda aqui, e não no proxy dos apps (que só faz GET).
//   GET /api/v1/yt/videos?ch=UC...            -> { ok, videos: [{ key, title, when, len }], next }
//   GET /api/v1/yt/videos?ch=UC...&next=TOKEN -> próxima página
const API = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
export const CONTEXT = { client: { clientName: 'WEB', clientVersion: '2.20251120.01.00', hl: 'pt-BR', gl: 'BR' } };
const VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';

function parse(data) {
  const videos = [];
  let next = null;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    const v = o.videoRenderer;
    if (v?.videoId) {
      videos.push({
        key: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '',
        when: v.publishedTimeText?.simpleText || '',
        len: v.lengthText?.simpleText || '',
      });
      return;
    }
    const l = o.lockupViewModel;
    if (l?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && l.contentId) {
      const meta = l.metadata?.lockupMetadataViewModel;
      const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const parts = rows.flatMap((r) => (r.metadataParts || []).map((x) => x.text?.content || ''));
      const badge = JSON.stringify(l.contentImage || {}).match(/"text":"(\d{1,2}(?::\d{2}){1,2})"/);
      videos.push({ key: l.contentId, title: meta?.title?.content || '', when: parts.find((x) => /^há |ago$/.test(x)) || '', len: badge?.[1] || '' });
      return;
    }
    // A primeira continuação é a da grade de vídeos (as outras são de outras partes da página).
    if (o.continuationItemRenderer) {
      const t = JSON.stringify(o.continuationItemRenderer).match(/"token":"([^"]+)"/);
      if (t && !next) next = t[1];
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  return { videos: [...new Map(videos.filter((v) => /^[\w-]{11}$/.test(v.key)).map((v) => [v.key, v])).values()], next };
}

export async function channelVideosPage(ch, token) {
  const body = token ? { context: CONTEXT, continuation: token } : { context: CONTEXT, browseId: ch, params: VIDEOS_TAB };
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'pt-BR' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('YouTube HTTP ' + res.status);
  return parse(await res.json());
}
