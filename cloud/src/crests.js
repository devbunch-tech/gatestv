// Escudos dos times, compartilhados por todos os aparelhos.
// O app manda os nomes (já normalizados) e recebe o endereço de cada escudo. O servidor procura no
// TheSportsDB só o que ainda não conhece e guarda no banco: quem abrir depois recebe na hora.
// As imagens passam por /api/v1/crest-img, que entrega uma versão pequena (100 px) e com cache longo.
const API = 'https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=';
const FOUND_TTL = 60 * 864e5; // escudo encontrado: confere de novo depois de 60 dias
const MISS_TTL = 3 * 864e5; // não encontrado: tenta de novo depois de 3 dias
const PER_CALL = 6; // buscas novas por chamada (a API grátis limita a 30 por minuto)
const MAX_NAMES = 80;
const IMG_HOSTS = new Set(['r2.thesportsdb.com', 'www.thesportsdb.com', 'a.espncdn.com']);

const cleanKey = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9 .'-]/g, '').trim().slice(0, 60);

async function lookup(key) {
  const r = await fetch(API + encodeURIComponent(key), { headers: { 'User-Agent': 'GATES-TV' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const teams = (await r.json())?.teams || [];
  const t = teams.find((x) => x.strSport === 'Soccer') || teams[0];
  return t?.strBadge || t?.strTeamBadge || null;
}

// GET /api/v1/crests?n=flamengo|palmeiras -> { crests: { flamengo: "https://…" | null }, pending: [...] }
export async function crestsResponse(env, url) {
  const keys = [...new Set(String(url.searchParams.get('n') || '').split('|').map(cleanKey).filter(Boolean))].slice(0, MAX_NAMES);
  const crests = {};
  if (!keys.length) return { ok: true, crests, pending: [] };
  const now = Date.now();
  const rows = await env.DB.prepare(`SELECT k, url, at FROM crests WHERE k IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys)
    .all();
  const known = new Map((rows.results || []).map((r) => [r.k, r]));
  const todo = [];
  for (const k of keys) {
    const r = known.get(k);
    if (r) crests[k] = r.url || null;
    if (!r || now - r.at > (r.url ? FOUND_TTL : MISS_TTL)) todo.push(k);
  }
  const batch = todo.slice(0, PER_CALL);
  const results = await Promise.allSettled(batch.map(lookup));
  const writes = [];
  results.forEach((res, i) => {
    if (res.status !== 'fulfilled') return; // falha de rede/limite: fica para a próxima chamada
    crests[batch[i]] = res.value;
    writes.push(env.DB.prepare('INSERT INTO crests (k, url, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET url = excluded.url, at = excluded.at').bind(batch[i], res.value, now));
  });
  if (writes.length) await env.DB.batch(writes).catch(() => {});
  // Ainda sem resposta (nem do banco, nem da busca): o app pergunta de novo em alguns segundos.
  const pending = keys.filter((k) => !(k in crests));
  return { ok: true, crests, pending };
}

// GET /api/v1/crest-img?u=<endereço original> -> imagem pequena (100 px), guardada no cache da Cloudflare.
export async function crestImage(url) {
  let src;
  try {
    src = new URL(url.searchParams.get('u') || '');
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (src.protocol !== 'https:' || !IMG_HOSTS.has(src.hostname)) return new Response('host not allowed', { status: 400 });
  let small = src.href;
  if (src.hostname.endsWith('thesportsdb.com') && !/\/(tiny|small|medium)$/.test(src.pathname)) small = src.href.replace(/\/?$/, '/tiny');
  else if (src.hostname === 'a.espncdn.com' && src.pathname.startsWith('/i/'))
    small = `https://a.espncdn.com/combiner/i?img=${encodeURIComponent(src.pathname)}&w=100&h=100`;
  const r = await fetch(small, { cf: { cacheTtl: 30 * 86400, cacheEverything: true } });
  if (!r.ok) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=3600' } });
  const type = r.headers.get('Content-Type') || 'image/png';
  if (!type.startsWith('image/')) return new Response('not an image', { status: 415 });
  return new Response(r.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000, immutable' } });
}
