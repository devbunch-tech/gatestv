// Dados do assinante iguais em todos os aparelhos: perfis e, por perfil, favoritos, histórico,
// ocultos, excluídos e lembretes de programas ficam também no servidor (rotas /api/v1/sync/*).
//
// Como funciona:
//  - cada chave guarda o horário da última mudança; na hora de juntar, vale a mais nova;
//  - as mudanças locais são percebidas comparando um resumo do conteúdo (não precisa mexer em
//    cada botão do app);
//  - no primeiro uso num aparelho, junta o que já existe nos dois lados (nada se perde);
//  - os IDs dos itens dependem da lista IPTV de cada aparelho, então vão para o servidor num
//    formato "portátil" (lista + item) e voltam para o ID local quando a mesma lista estiver
//    cadastrada. Enquanto a lista não existir no aparelho, o item fica guardado esperando.
import { licenseApiUrl } from '../config/license';
import { deviceId, loadSaved } from './license';
import { hash } from './m3u';
import { normName } from './epg';

export const SYNC_PROFILE_KEYS = ['favorites', 'history', 'hidden', 'deleted', 'shows', 'later', 'ratings'];
// Por conta: { at: { chave: horário }, snap: { chave: resumo }, dirty: { chave: 1 }, done: já sincronizou }
const META = (accountId) => `gates:sync:meta:${accountId}`;

const lsGet = (k, fb) => {
  try {
    const v = localStorage.getItem('gates:' + k);
    return v ? JSON.parse(v) : fb;
  } catch {
    return fb;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem('gates:' + k, JSON.stringify(v));
  } catch {
    /* armazenamento cheio */
  }
};
function loadMeta(accountId) {
  try {
    return { at: {}, snap: {}, ...JSON.parse(localStorage.getItem(META(accountId)) || '{}') };
  } catch {
    return { at: {}, snap: {} };
  }
}
const saveMeta = (accountId, m) => {
  try {
    localStorage.setItem(META(accountId), JSON.stringify(m));
  } catch {
    /* ignore */
  }
};

export const syncAvailable = () => !!loadSaved()?.token;

async function call(path, body) {
  const saved = loadSaved();
  if (!saved?.token) throw new Error('sem licença');
  const res = await fetch(licenseApiUrl() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: saved.token, deviceId: deviceId(), ...body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.message || 'HTTP ' + res.status);
  return j;
}

// ---------- IDs portáteis ----------
// Lista identificada pelo servidor + usuário (Xtream) ou pelo endereço (M3U), só como resumo.
const plKey = (p) => hash(p.xtream ? `${p.xtream.server}|${p.xtream.username}` : p.url || p.name || p.id);

export function makeIdMapper(playlists, catalog) {
  const byPl = playlists.map((p) => ({ id: p.id, key: plKey(p) }));
  const keyToId = new Map(byPl.map((x) => [x.key, x.id]));
  // Séries de listas M3U têm ID calculado com o ID local da lista: vão pelo nome.
  let seriesIdx = null;
  const seriesIndex = () => {
    if (seriesIdx) return seriesIdx;
    seriesIdx = new Map();
    const pk = new Map(byPl.map((x) => [x.id, x.key]));
    for (const s of catalog?.series || []) if (s.id.startsWith('series-')) seriesIdx.set(`${pk.get(s.playlistId)}~${normName(s.name)}`, s.id);
    return seriesIdx;
  };
  const toPortable = (id) => {
    if (typeof id !== 'string' || id.startsWith('~')) return id;
    if (id.startsWith('series-')) {
      const it = catalog?.byId?.get(id);
      const pl = it && byPl.find((x) => x.id === it.playlistId);
      return pl ? `~s~${pl.key}~${normName(it.name)}` : id;
    }
    const pl = byPl.find((x) => id.startsWith(x.id + '-'));
    return pl ? `~p~${pl.key}~${id.slice(pl.id.length + 1)}` : id;
  };
  const toLocal = (id) => {
    if (typeof id !== 'string' || !id.startsWith('~')) return id;
    const [, kind, key, ...rest] = id.split('~');
    const tail = rest.join('~');
    if (kind === 'p') return keyToId.has(key) ? `${keyToId.get(key)}-${tail}` : id;
    if (kind === 's') return seriesIndex().get(`${key}~${tail}`) || id;
    return id;
  };
  return { toPortable, toLocal };
}

// Converte o valor de uma chave (lista de IDs, histórico {id: {...}}, perfis, lembretes).
function convert(kind, value, fn) {
  if (value == null) return value;
  if (kind === 'favorites' || kind === 'hidden' || kind === 'deleted' || kind === 'later') return Array.isArray(value) ? [...new Set(value.map(fn))] : value;
  if (kind === 'ratings') return Object.fromEntries(Object.entries(value || {}).map(([id, r]) => [fn(id), r]));
  if (kind === 'history')
    return Object.fromEntries(Object.entries(value || {}).map(([id, h]) => [fn(id), h?.seriesId ? { ...h, seriesId: fn(h.seriesId) } : h]));
  return value; // perfis e lembretes não têm IDs de itens
}

// Junta os dois lados (só no primeiro uso do aparelho).
function merge(kind, local, remote) {
  if (local == null) return remote;
  if (remote == null) return local;
  if (kind === 'profiles') {
    const ids = new Set(remote.map((p) => p.id));
    return [...remote, ...local.filter((p) => !ids.has(p.id))];
  }
  if (kind === 'history' || kind === 'ratings') {
    const out = { ...local };
    for (const [id, h] of Object.entries(remote)) if (!out[id] || (h?.at || 0) > (out[id]?.at || 0)) out[id] = h;
    return out;
  }
  if (kind === 'shows') {
    const seen = new Set(remote.map((s) => s.id));
    return [...remote, ...local.filter((s) => !seen.has(s.id))];
  }
  return [...new Set([...remote, ...local])];
}

// Chaves sincronizadas: servidor -> armazenamento local.
function syncKeys(accountId) {
  const profiles = lsGet(`acct:${accountId}:profiles`, []);
  const keys = [{ server: 'profiles', local: `acct:${accountId}:profiles`, kind: 'profiles' }];
  for (const p of profiles) for (const k of SYNC_PROFILE_KEYS) keys.push({ server: `p:${p.id}:${k}`, local: `p:${p.id}:${k}`, kind: k });
  return keys;
}

const digest = (v) => hash(JSON.stringify(v ?? null));

// Uma rodada: percebe mudanças locais, baixa o que mudou em outros aparelhos e envia o que mudou aqui.
// Retorna true se algo local foi alterado (o app recarrega os dados da tela).
export async function syncNow({ accountId, playlists, catalog }) {
  if (!syncAvailable()) return false;
  const ids = makeIdMapper(playlists, catalog);
  const meta = loadMeta(accountId);
  const first = !meta.done;
  const now = Date.now();
  // 1) mudanças locais desde a última rodada
  for (const k of syncKeys(accountId)) {
    const v = convert(k.kind, lsGet(k.local, null), ids.toPortable);
    if (v == null) continue;
    const d = digest(v);
    if (meta.snap[k.server] !== d) {
      meta.snap[k.server] = d;
      meta.at[k.server] = now;
      meta.dirty = { ...(meta.dirty || {}), [k.server]: 1 };
    }
  }
  // 2) servidor
  const { data = {} } = await call('/api/v1/sync/pull');
  let changed = false;
  const apply = (k, remote) => {
    const local = lsGet(k.local, null);
    const v = first ? merge(k.kind, convert(k.kind, local, ids.toPortable), remote.v) : remote.v;
    lsSet(k.local, convert(k.kind, v, ids.toLocal));
    meta.snap[k.server] = digest(v);
    meta.at[k.server] = first ? now : remote.at;
    if (first) meta.dirty = { ...(meta.dirty || {}), [k.server]: 1 };
    else delete meta.dirty?.[k.server];
    changed = true;
  };
  // Perfis primeiro: as chaves de cada perfil dependem da lista de perfis.
  const prof = syncKeys(accountId)[0];
  if (data.profiles && (first || data.profiles.at > (meta.at.profiles || 0))) apply(prof, data.profiles);
  for (const k of syncKeys(accountId).slice(1)) {
    const r = data[k.server];
    if (r && (first || r.at > (meta.at[k.server] || 0))) apply(k, r);
  }
  // 3) envia o que é mais novo aqui
  const push = {};
  for (const k of syncKeys(accountId)) {
    if (!meta.dirty?.[k.server]) continue;
    const v = convert(k.kind, lsGet(k.local, null), ids.toPortable);
    if (v != null) push[k.server] = { v, at: meta.at[k.server] || now };
  }
  if (Object.keys(push).length) await call('/api/v1/sync/push', { data: push });
  meta.dirty = {};
  meta.done = true;
  saveMeta(accountId, meta);
  return changed;
}

// IDs que estavam esperando a lista ser cadastrada neste aparelho: troca pelos locais.
export function localizeStored({ accountId, playlists, catalog }) {
  const ids = makeIdMapper(playlists, catalog);
  let changed = false;
  for (const k of syncKeys(accountId).slice(1)) {
    if (k.kind === 'shows') continue;
    const v = lsGet(k.local, null);
    if (v == null || !JSON.stringify(v).includes('"~')) continue;
    const next = convert(k.kind, v, ids.toLocal);
    if (JSON.stringify(next) !== JSON.stringify(v)) {
      lsSet(k.local, next);
      changed = true;
    }
  }
  return changed;
}

// ---------- Registro do que está sendo assistido ----------
export function reportWatch(session) {
  if (!syncAvailable()) return Promise.resolve();
  return call('/api/v1/sync/watch', { session }).catch(() => {});
}
