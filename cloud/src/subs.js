// Legendas em português (OpenSubtitles.com), compartilhadas por todos os aparelhos.
// A conta tem um limite de downloads por dia: cada legenda é baixada uma vez só e fica guardada
// (KV "FILES"); quem abrir o mesmo filme/episódio depois recebe a cópia guardada.
//
// GET /api/v1/subs?imdb=tt1375666&tmdb=27205                    -> filme
// GET /api/v1/subs?pimdb=tt0903747&ptmdb=1396&s=1&e=1           -> episódio (dados da série)
// Resposta: o texto da legenda em WebVTT, ou JSON { ok:false, error } (404 sem legenda, 503 limite do dia).
const API = 'https://api.opensubtitles.com/api/v1';
const UA = 'GATES TV v1.0';
const KEEP = 180 * 86400; // legenda guardada: 180 dias
const MISS = 3 * 86400; // sem legenda em português: tenta de novo em 3 dias

const num = (v) => (/^\d{1,9}$/.test(String(v || '')) ? String(+v) : '');
const imdbNum = (v) => num(String(v || '').replace(/^tt/i, ''));

const headers = (env, token) => ({
  'Api-Key': env.OPENSUBTITLES_API_KEY,
  'User-Agent': UA,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...(token ? { Authorization: 'Bearer ' + token } : {}),
});

// Login da conta (mais downloads por dia que sem login). O token vale 24 h: fica guardado 20 h.
async function token(env, fresh) {
  if (!fresh) {
    const t = await env.FILES.get('os:token');
    if (t) return t;
  }
  if (!env.OPENSUBTITLES_USER || !env.OPENSUBTITLES_PASS) return null;
  const r = await fetch(API + '/login', {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ username: env.OPENSUBTITLES_USER, password: env.OPENSUBTITLES_PASS }),
  });
  if (!r.ok) return null;
  const t = (await r.json())?.token;
  if (t) await env.FILES.put('os:token', t, { expirationTtl: 20 * 3600 }).catch(() => {});
  return t || null;
}

// Melhor legenda: português do Brasil primeiro, sem descrição de sons, mais baixada.
function best(list) {
  const score = (d) => {
    const a = d.attributes || {};
    return (
      (/^pt-br$/i.test(a.language || '') ? 1e9 : 0) +
      (a.hearing_impaired ? 0 : 1e8) +
      (a.from_trusted ? 1e7 : 0) +
      (a.machine_translated || a.ai_translated ? 0 : 1e6) +
      Math.min(a.download_count || 0, 999999)
    );
  };
  return list.filter((d) => d.attributes?.files?.[0]?.file_id).sort((a, b) => score(b) - score(a))[0] || null;
}

export async function subsResponse(env, url) {
  const p = url.searchParams;
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  if (!env.OPENSUBTITLES_API_KEY) return json(503, { ok: false, error: 'not_configured' });

  const s = num(p.get('s'));
  const e = num(p.get('e'));
  const episode = s && e;
  const imdb = imdbNum(episode ? p.get('pimdb') : p.get('imdb'));
  const tmdb = num(episode ? p.get('ptmdb') : p.get('tmdb'));
  if (!imdb && !tmdb) return json(400, { ok: false, error: 'bad_request' });
  const id = imdb ? 'i' + imdb : 't' + tmdb;
  const key = episode ? `sub:e:${id}:${s}:${e}` : `sub:m:${id}`;

  const saved = await env.FILES.get(key);
  if (saved === 'none') return json(404, { ok: false, error: 'not_found' });
  if (saved) return new Response(saved, { headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });

  // Busca (não gasta o limite do dia).
  const q = new URLSearchParams({ languages: 'pt-br,pt-pt', order_by: 'download_count' });
  if (episode) {
    q.set(imdb ? 'parent_imdb_id' : 'parent_tmdb_id', imdb || tmdb);
    q.set('season_number', s);
    q.set('episode_number', e);
  } else q.set(imdb ? 'imdb_id' : 'tmdb_id', imdb || tmdb);
  const sr = await fetch(`${API}/subtitles?${q}`, { headers: headers(env) });
  if (!sr.ok) return json(502, { ok: false, error: 'search_failed' });
  const pick = best((await sr.json())?.data || []);
  if (!pick) {
    await env.FILES.put(key, 'none', { expirationTtl: MISS }).catch(() => {});
    return json(404, { ok: false, error: 'not_found' });
  }

  // Download (gasta 1 do limite do dia, só na primeira vez de cada legenda).
  const fileId = pick.attributes.files[0].file_id;
  const download = async (t) =>
    fetch(API + '/download', { method: 'POST', headers: headers(env, t), body: JSON.stringify({ file_id: fileId, sub_format: 'webvtt' }) });
  let t = await token(env);
  let dr = await download(t);
  if (dr.status === 401) dr = await download((t = await token(env, true)));
  if (dr.status === 406 || dr.status === 429) return json(503, { ok: false, error: 'quota' });
  if (!dr.ok) return json(502, { ok: false, error: 'download_failed' });
  const link = (await dr.json())?.link;
  const fr = link ? await fetch(link) : null;
  if (!fr?.ok) return json(502, { ok: false, error: 'download_failed' });
  const vtt = await fr.text();
  if (!/^﻿?WEBVTT/.test(vtt)) return json(502, { ok: false, error: 'bad_format' });
  await env.FILES.put(key, vtt, { expirationTtl: KEEP }).catch(() => {});
  return new Response(vtt, { headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
