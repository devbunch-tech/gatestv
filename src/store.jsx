import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, set, del } from 'idb-keyval';
import { parseM3U, parseM3UHeader, buildSeries, hash } from './lib/m3u';
import { dataProxy, fetchText } from './lib/net';
import { findNow, loadEpg as loadEpgWorker, normName } from './lib/epg';
import { ADULT_RE } from './lib/parental';
import { configureMeta } from './lib/meta';
import { fetchXtreamCatalog, fetchXtreamEpisodes, fetchXtreamInfo, parseXtreamUrl, xtreamEpgUrl } from './lib/xtream';
import { mergeVariants } from './lib/variants';
import { baseName, zapGroups } from './lib/zapping';
import { officialLogoFile, officialLogoPath } from './config/channelLogos';
import { probeChannel } from './lib/health';
import { ADULT_GROUP, REMOVE_ADULT } from './config/content';
import { DEFAULT_APP_SETTINGS, DEFAULT_SOURCES } from './config/defaults';
import { licenseConfig } from './lib/license';
import { isSubscriber } from './lib/device';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const HOUR = 3600e3;
const UNLOCK_MS = 10 * 60e3;
const RECHECK_MS = 5 * 60e3; // intervalo mínimo entre verificações de novidades no Xtream

const DEFAULT_SETTINGS = { proxyMode: 'auto', liveDelay: 35, curatedZap: true, uf: '', subtitles: true, tvMode: 'auto', tmdbKey: '', omdbKey: '', epgUrls: [] };
const DEFAULT_PARENTAL = {
  enabled: false,
  pin: '',
  maxAge: 18,
  hideRestricted: false,
  blockAdultGroups: true,
  lockedGroups: [],
};

const LS = {
  load(key, fallback) {
    try {
      const v = localStorage.getItem('gates:' + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem('gates:' + key, JSON.stringify(value));
    } catch {
      /* armazenamento indisponível */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem('gates:' + key);
    } catch {
      /* ignore */
    }
  },
};

function usePersisted(key, initial) {
  const [value, setValue] = useState(() => LS.load(key, initial));
  useEffect(() => {
    LS.save(key, value);
  }, [key, value]);
  return [value, setValue];
}

// Estado por perfil: a chave muda quando o perfil ativo muda e o valor é recarregado.
function useScopedPersisted(key, initial) {
  const [state, setState] = useState(() => ({ key, value: LS.load(key, initial) }));
  let value = state.value;
  if (state.key !== key) {
    value = LS.load(key, initial);
    setState({ key, value });
  }
  const setter = useCallback(
    (upd) =>
      setState((s) => {
        const v = typeof upd === 'function' ? upd(s.value) : upd;
        LS.save(s.key, v);
        return { key: s.key, value: v };
      }),
    []
  );
  return [value, setter];
}

export const AVATARS = ['😀', '😎', '🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐶', '🐱', '🚀', '⚽', '🎮', '🎧', '🍿', '🌟', '👾', '🤖'];
export const PROFILE_COLORS = ['#ec0b43', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b'];
export const newProfile = (patch = {}) => ({
  id: 'u' + Date.now().toString(36),
  name: '',
  emoji: AVATARS[Math.floor(Math.random() * AVATARS.length)],
  color: PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)],
  kids: false,
  master: false,
  maxAge: null,
  hideRestricted: false,
  blockUnrated: false,
  pin: '',
  ...patch,
});

const PROFILE_KEYS = ['favorites', 'history', 'hidden', 'deleted'];

// Primeiro acesso da conta: cria os perfis configurados e traz os dados da versão anterior
// (perfil "Principal" e itens excluídos globalmente) para o perfil master.
function seedAccount(account) {
  const key = `acct:${account.id}:profiles`;
  const existing = LS.load(key, null);
  if (existing) {
    // Nova versão da configuração: reaplica foto e "infantil" definidos para cada perfil.
    const vKey = `acct:${account.id}:profilesVersion`;
    if ((LS.load(vKey, 1) || 1) < (account.profilesVersion || 1)) {
      const updated = existing.map((p) => {
        const c = account.profiles.find((x) => x.id === p.id);
        if (!c) return p;
        const { photo, photoPos, kids = false, maxAge = null, hideRestricted = false } = c;
        return { ...p, photo, photoPos, kids, maxAge: kids ? maxAge ?? 10 : p.maxAge, hideRestricted: kids ? true : hideRestricted || p.hideRestricted };
      });
      for (const c of account.profiles) if (!updated.some((p) => p.id === c.id)) updated.push(newProfile(c));
      LS.save(key, updated);
      LS.save(vKey, account.profilesVersion);
      return updated;
    }
    return existing;
  }
  LS.save(`acct:${account.id}:profilesVersion`, account.profilesVersion || 1);
  const profiles = account.profiles.map((p) => newProfile(p));
  if (!profiles.some((p) => p.master)) profiles[0].master = true;
  const master = profiles.find((p) => p.master);
  for (const k of ['favorites', 'history', 'hidden']) {
    const legacy = LS.load(`p:main:${k}`, null) ?? LS.load(k, null);
    if (legacy != null && LS.load(`p:${master.id}:${k}`, null) == null) LS.save(`p:${master.id}:${k}`, legacy);
  }
  const ov = LS.load('overrides', {});
  const deleted = Object.keys(ov).filter((i) => ov[i].deleted);
  if (deleted.length) {
    LS.save(`p:${master.id}:deleted`, deleted);
    for (const i of deleted) {
      delete ov[i].deleted;
      if (!Object.keys(ov[i]).length) delete ov[i];
    }
    LS.save('overrides', ov);
  }
  LS.save(key, profiles);
  return profiles;
}

function migrateSettings() {
  const s = LS.load('settings', null);
  if (s && s.useProxy !== undefined && !s.proxyMode) {
    s.proxyMode = s.useProxy ? 'auto' : 'never';
    delete s.useProxy;
    LS.save('settings', s);
  }
  // Atraso padrão do ao vivo passou de 20 s para 35 s: atualiza quem ainda estava no padrão antigo.
  if (s && s.liveDelay === 20 && !s.delay35) {
    s.liveDelay = 35;
    s.delay35 = true;
    LS.save('settings', s);
  }
}

const SESSION_KEY = 'gates:activeProfile';
const loadActive = (profiles) => {
  let id = null;
  try {
    id = sessionStorage.getItem(SESSION_KEY);
  } catch {
    /* sem sessionStorage */
  }
  if (profiles.some((p) => p.id === id)) return id;
  return profiles.length === 1 && !profiles[0].pin ? profiles[0].id : null;
};

const resolveUrl = (u) => {
  try {
    return new URL(u, location.href).href;
  } catch {
    return u;
  }
};

// Identificador do stream na URL (Xtream: .../1234.ts) para manter favoritos/ocultos
// quando uma lista M3U é convertida para a API Xtream.
const streamKey = (it) => {
  const m = /\/(\d+)(?:\.\w+)?(?:[?#].*)?$/.exec(it.url || '');
  return m ? `${it.type}:${m[1]}` : null;
};

const xtreamOf = (p) => p.xtream || (p.source === 'xtream' || /\/get\.php/i.test(p.url || '') ? parseXtreamUrl(p.url) : null);

// Logo oficial do canal (public/official-logos, ver config/channelLogos.js), pelo nome; memorizado.
const officialLogos = new Map();
function officialLogo(name) {
  let v = officialLogos.get(name);
  if (v === undefined) {
    const f = officialLogoPath(baseName(name));
    v = f ? `./official-logos/${officialLogoFile(f)}` : '';
    officialLogos.set(name, v);
  }
  return v;
}

// Servidor de onde vieram os logos de public/channel-logos (guardado como hash, sem o endereço).
const LOGO_SOURCE_HASH = 'to2hji';
function isLogoSource(server) {
  try {
    const host = new URL(server).hostname.toLowerCase();
    let x = 0x811c9dc5;
    for (const c of host) x = Math.imul(x ^ c.charCodeAt(0), 0x01000193) >>> 0;
    return x.toString(36) === LOGO_SOURCE_HASH;
  } catch {
    return false;
  }
}

export function StoreProvider({ account, children }) {
  useState(migrateSettings);
  const [seeded] = useState(() => seedAccount(account));
  const [playlists, setPlaylists] = usePersisted('playlists', []);
  const [profiles, setProfiles] = usePersisted(`acct:${account.id}:profiles`, seeded);
  const [activeId, setActiveId] = useState(() => loadActive(seeded));
  const profile = profiles.find((p) => p.id === activeId) || null;
  const master = profiles.find((p) => p.master) || profiles[0];
  const isMaster = !!profile && profile.id === master?.id;
  const scope = `p:${profile?.id || 'none'}:`;
  const mScope = `p:${master?.id || 'none'}:`;
  const [favorites, setFavorites] = useScopedPersisted(scope + 'favorites', []);
  const [history, setHistory] = useScopedPersisted(scope + 'history', {});
  const [hiddenList, setHiddenList] = useScopedPersisted(scope + 'hidden', []);
  const [deletedList, setDeletedList] = useScopedPersisted(scope + 'deleted', []);
  // Listas do master: lidas do armazenamento a cada troca de perfil (só o master as altera).
  const masterHidden = useMemo(
    () => (isMaster ? hiddenList : LS.load(mScope + 'hidden', [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMaster, mScope, activeId, isMaster && hiddenList]
  );
  const masterDeleted = useMemo(
    () => (isMaster ? deletedList : LS.load(mScope + 'deleted', [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMaster, mScope, activeId, isMaster && deletedList]
  );
  const [rawSettings, setSettings] = usePersisted('settings', { ...DEFAULT_SETTINGS, ...DEFAULT_APP_SETTINGS });
  const [rawParental, setParental] = usePersisted('parental', DEFAULT_PARENTAL);
  const [overrides, setOverrides] = usePersisted('overrides', {});
  const [metaRatings, setMetaRatings] = usePersisted('metaRatings', {});
  const [tmdbLinks, setTmdbLinks] = usePersisted('tmdbLinks', {});
  const [itemsByPl, setItemsByPl] = useState({});
  const [episodesBy, setEpisodesBy] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [epg, setEpg] = useState({});
  const [unlockedUntil, setUnlockedUntil] = useState(0);
  const [pinReq, setPinReq] = useState(null);
  const [menuItem, setMenuItem] = useState(null);
  const [program, setProgram] = useState(null);
  const [trailer, setTrailer] = useState(null);
  const [toasts, setToasts] = useState([]);
  // Logos de canais embutidos no app (scripts/fetch-channel-logos.mjs): stream_id -> arquivo.
  const [localLogos, setLocalLogos] = useState(null);
  useEffect(() => {
    fetch('./channel-logos/index.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then(setLocalLogos)
      .catch(() => setLocalLogos({}));
  }, []);

  // Assinantes: sem chave própria, usa as chaves que o servidor de licenças enviou.
  const licCfg = isSubscriber ? licenseConfig() : {};
  const settings = { ...DEFAULT_SETTINGS, ...rawSettings };
  if (!settings.tmdbKey && licCfg.tmdbKey) settings.tmdbKey = licCfg.tmdbKey;
  if (!settings.omdbKey && licCfg.omdbKey) settings.omdbKey = licCfg.omdbKey;
  const parental = { ...DEFAULT_PARENTAL, ...rawParental };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  configureMeta({ tmdbKey: settings.tmdbKey, omdbKey: settings.omdbKey });
  const useProxyData = () => dataProxy(settingsRef.current.proxyMode);

  const unlocked = unlockedUntil > Date.now();
  useEffect(() => {
    if (!unlocked) return;
    const t = setTimeout(() => setUnlockedUntil(0), unlockedUntil - Date.now());
    return () => clearTimeout(t);
  }, [unlocked, unlockedUntil]);

  const notify = useCallback((text, kind = 'info') => {
    const id = Date.now() + Math.random();
    // Não empilha o mesmo aviso várias vezes.
    setToasts((t) => (t.some((x) => x.text === text) ? t : [...t, { id, text, kind }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
  }, []);

  // Troca IDs antigos por novos em todos os dados salvos (favoritos, histórico, ocultos…).
  const remapIds = useCallback(
    (map) => {
      if (!map.size) return;
      const fixList = (l) => [...new Set(l.map((id) => map.get(id) || id))];
      const fixObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [map.get(k) || k, v]));
      for (const p of LS.load(`acct:${account.id}:profiles`, [])) {
        for (const k of PROFILE_KEYS) {
          const v = LS.load(`p:${p.id}:${k}`, null);
          if (v != null) LS.save(`p:${p.id}:${k}`, Array.isArray(v) ? fixList(v) : fixObj(v));
        }
      }
      setOverrides((o) => fixObj(o));
      setMetaRatings((o) => fixObj(o));
      // Recarrega as listas do perfil ativo e do master a partir do armazenamento.
      setFavorites(LS.load(scope + 'favorites', []));
      setHistory(LS.load(scope + 'history', {}));
      setHiddenList(LS.load(scope + 'hidden', []));
      setDeletedList(LS.load(scope + 'deleted', []));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account.id, scope]
  );

  // ---------- Listas ----------
  const importPlaylist = useCallback(
    async ({ id, name, url, text, source, xtream }) => {
      const plId = id || 'p' + hash(name + Date.now());
      const creds = xtream || (source === 'xtream' ? parseXtreamUrl(url) : null);
      let items;
      let epgUrls = [];
      let accountInfo = null;
      if (creds) {
        const r = await fetchXtreamCatalog(creds, plId, useProxyData());
        items = r.items;
        accountInfo = r.info;
        epgUrls = [xtreamEpgUrl(creds)];
      } else {
        const body = text ?? (await fetchText(url, useProxyData() && source !== 'demo'));
        items = parseM3U(body, plId);
        epgUrls = parseM3UHeader(body).epgUrls;
      }
      if (!items.length) throw new Error('Nenhum conteúdo encontrado. Verifique a lista ou a conta.');

      // Compara com a versão anterior: preserva a data em que cada item apareceu,
      // detecta novidades e remapeia IDs se o formato mudou (M3U -> API).
      const prev = (await get('items:' + plId).catch(() => null)) || [];
      const prevById = new Map(prev.map((i) => [i.id, i]));
      const now = Date.now();
      const fresh = { live: 0, movie: 0, series: 0 };
      const remap = new Map();
      if (prev.length) {
        const newIds = new Set(items.map((i) => i.id));
        const byKey = new Map();
        for (const it of items) {
          const k = streamKey(it);
          if (k) byKey.set(k, it.id);
        }
        for (const old of prev) {
          if (newIds.has(old.id)) continue;
          const k = streamKey(old);
          if (k && byKey.has(k)) remap.set(old.id, byKey.get(k));
        }
      }
      const remappedPrev = new Map([...prevById].map(([k, v]) => [remap.get(k) || k, v]));
      for (const it of items) {
        const before = remappedPrev.get(it.id);
        it.firstSeen = before?.firstSeen ?? (prev.length ? now : 0);
        if (prev.length && !before) fresh[it.type]++;
      }
      await set('items:' + plId, items);
      remapIds(remap);
      setItemsByPl((m) => ({ ...m, [plId]: items }));
      setEpisodesBy({});
      const counts = { live: 0, movie: 0, series: 0 };
      for (const it of items) counts[it.type]++;
      const meta = {
        id: plId,
        name,
        url: url || '',
        source: creds ? 'xtream' : source,
        xtream: creds || undefined,
        count: items.length,
        counts,
        epgUrls,
        accountInfo: accountInfo ? { exp: accountInfo.exp_date, max: accountInfo.max_connections, status: accountInfo.status } : undefined,
        updatedAt: now,
        checkedAt: now,
      };
      setPlaylists((ps) => {
        const i = ps.findIndex((p) => p.id === plId);
        if (i < 0) return [...ps, meta];
        const copy = [...ps];
        copy[i] = meta;
        return copy;
      });
      return { ...meta, fresh };
    },
    [remapIds]
  );

  const refreshPlaylist = useCallback((p) => importPlaylist({ ...p, text: undefined, xtream: xtreamOf(p) }), [importPlaylist]);

  const removePlaylist = useCallback(async (id) => {
    await del('items:' + id);
    setPlaylists((ps) => ps.filter((p) => p.id !== id));
    setItemsByPl((m) => {
      const { [id]: _, ...rest } = m;
      return rest;
    });
  }, []);

  // Verifica novidades nas fontes Xtream (ao abrir o app). Itens ocultos/excluídos continuam
  // ocultos, pois os IDs são estáveis (baseados no stream_id).
  const checkForUpdates = useCallback(
    async (list, { force = false, silent = false } = {}) => {
      const targets = list.filter((p) => xtreamOf(p) && (force || Date.now() - (p.checkedAt || 0) > RECHECK_MS));
      if (!targets.length) return;
      setSyncing(true);
      for (const p of targets) {
        try {
          const r = await importPlaylist({ ...p, xtream: xtreamOf(p) });
          const parts = [
            r.fresh.movie && `${r.fresh.movie} filme(s)`,
            r.fresh.series && `${r.fresh.series} série(s)`,
            r.fresh.live && `${r.fresh.live} canal(is)`,
          ].filter(Boolean);
          if (parts.length) notify(`Novidades em “${p.name}”: ${parts.join(', ')}.`, 'ok');
          else if (!silent) notify(`“${p.name}” está atualizada.`);
        } catch (e) {
          notify(`Não foi possível atualizar “${p.name}”: ${e.message}`, 'err');
        }
      }
      setSyncing(false);
    },
    [importPlaylist, notify]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      // Remove a lista de demonstração das versões de teste.
      const all = LS.load('playlists', []);
      const saved = all.filter((p) => p.source !== 'demo');
      if (saved.length !== all.length) {
        for (const p of all) if (p.source === 'demo') await del('items:' + p.id).catch(() => {});
        setPlaylists(saved);
      }
      const map = {};
      for (const p of saved) map[p.id] = (await get('items:' + p.id)) || [];
      if (!alive) return;
      setItemsByPl(map);
      // Primeira abertura (instaladores): carrega as fontes de src/config/defaults.js.
      if (!saved.length && DEFAULT_SOURCES.length && !LS.load('defaultsSeeded', false)) {
        LS.save('defaultsSeeded', true);
        for (const d of DEFAULT_SOURCES) {
          try {
            if (d.type === 'xtream') {
              const xtream = { server: d.server.replace(/\/+$/, ''), username: d.username, password: d.password, output: d.output || 'ts' };
              const url = `${xtream.server}/get.php?username=${encodeURIComponent(d.username)}&password=${encodeURIComponent(d.password)}`;
              await importPlaylist({ name: d.name, url, source: 'xtream', xtream });
            } else await importPlaylist({ name: d.name, url: d.url, source: 'url' });
          } catch (e) {
            notify(`Não foi possível carregar a fonte “${d.name}”: ${e.message}`, 'err');
          }
        }
      }
      if (!alive) return;
      setLoading(false);
      checkForUpdates(saved, { silent: true });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Episódios de séries Xtream: carregados sob demanda (get_series_info) e guardados em cache.
  const loadEpisodes = useCallback(
    async (shell, force) => {
      if (!shell?.shell) return;
      const key = 'eps:' + shell.id;
      if (!force) {
        const c = await get(key).catch(() => null);
        if (c && Date.now() - c.at < 6 * HOUR) {
          setEpisodesBy((m) => ({ ...m, [shell.id]: c.eps }));
          return;
        }
      }
      const p = playlists.find((x) => x.id === shell.playlistId);
      const creds = p && xtreamOf(p);
      if (!creds) return;
      setEpisodesBy((m) => ({ ...m, [shell.id]: m[shell.id] || 'loading' }));
      try {
        const eps = await fetchXtreamEpisodes(creds, shell, useProxyData());
        await set(key, { at: Date.now(), eps }).catch(() => {});
        setEpisodesBy((m) => ({ ...m, [shell.id]: eps }));
      } catch (e) {
        setEpisodesBy((m) => ({ ...m, [shell.id]: { error: e.message } }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playlists]
  );

  // Detalhes extras do Xtream (duração, sinopse, fundo) — cache de 7 dias.
  const getXtreamInfo = useCallback(
    async (item) => {
      const key = 'xinfo:' + item.id;
      const c = await get(key).catch(() => null);
      if (c && Date.now() - c.at < 7 * 24 * HOUR) return c.v;
      const p = playlists.find((x) => x.id === item.playlistId);
      const creds = p && xtreamOf(p);
      if (!creds) return null;
      const v = await fetchXtreamInfo(creds, item, useProxyData()).catch(() => null);
      if (v) await set(key, { at: Date.now(), v }).catch(() => {});
      return v;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playlists]
  );

  // ---------- EPG ----------
  const epgSources = useMemo(() => {
    const out = [];
    for (const p of playlists) {
      const urls = new Set(p.epgUrls || []);
      const x = xtreamOf(p);
      if (x) urls.add(xtreamEpgUrl(x));
      for (const u of urls) out.push({ key: 'pl:' + p.id + ':' + hash(u), url: resolveUrl(u), label: p.name, demo: p.source === 'demo' });
    }
    for (const u of settings.epgUrls) out.push({ key: 'u:' + hash(u), url: u, label: 'Manual', manual: true });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, settings.epgUrls.join('|')]);

  const liveKeysRef = useRef({ ids: [], names: [] });

  const loadEpg = useCallback(async (src, force) => {
    let cachedEntry;
    try {
      cachedEntry = await get('epg:' + src.key);
    } catch {
      /* sem cache */
    }
    if (cachedEntry) setEpg((e) => ({ ...e, [src.key]: cachedEntry }));
    const stale = !cachedEntry || cachedEntry.url !== src.url || Date.now() - cachedEntry.updatedAt > 6 * HOUR || src.demo;
    if (!stale && !force) return;
    setEpg((e) => ({ ...e, [src.key]: { ...(cachedEntry || {}), url: src.url, loading: true } }));
    try {
      const now = Date.now();
      const data = await loadEpgWorker(src.url, useProxyData(), {
        from: now - 3 * HOUR,
        to: now + 48 * HOUR,
        ...liveKeysRef.current,
      });
      const entry = { url: src.url, updatedAt: now, ...data };
      await set('epg:' + src.key, entry).catch(() => {});
      setEpg((e) => ({ ...e, [src.key]: entry }));
    } catch (err) {
      setEpg((e) => ({ ...e, [src.key]: { ...(cachedEntry || {}), url: src.url, loading: false, error: err.message } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Controle parental ----------
  const isLocked = (item) =>
    !!(overrides[item.id]?.locked || (item.seriesId && overrides[item.seriesId]?.locked) || parental.lockedGroups.includes(item.group));
  const ageLimit = profile?.maxAge ?? (parental.enabled ? parental.maxAge : null);
  const blockUnrated = !!profile?.blockUnrated;

  // ---------- Catálogo ----------
  const catalog = useMemo(() => {
    // Conteúdo adulto é removido para todos os perfis (src/config/content.js).
    const raw = playlists.flatMap((p) => itemsByPl[p.id] || []).filter((it) => !(REMOVE_ADULT && ADULT_GROUP.test(it.group || '')));
    // Logos embutidos só valem para listas do mesmo servidor em que foram baixados: em outra lista,
    // o mesmo número de canal pode ser outro canal (aí fica o logo da própria lista).
    const logoLists = new Set(playlists.filter((p) => isLogoSource(p.xtream?.server)).map((p) => p.id));
    const byId = new Map();
    let n = 0;
    for (const it of raw) {
      byId.set(it.id, it);
      if (it.type === 'live') {
        it.num = Number(it.chno) || ++n;
        const sid = localLogos && logoLists.has(it.playlistId) && /-l(\d+)$/.exec(it.id)?.[1];
        if (sid && localLogos[sid]) it.logo = `./channel-logos/${localLogos[sid]}`;
        const official = officialLogo(it.name);
        if (official) it.logo = official;
      }
    }
    // O que o perfil master oculta ou exclui vale para todos os perfis.
    const goneSet = new Set([...deletedList, ...masterDeleted]);
    const hiddenSet = new Set([...hiddenList, ...masterHidden]);
    const gone = (id) => goneSet.has(id);
    const hidden = (id) => hiddenSet.has(id);
    const hideR = (profile?.kids || profile?.hideRestricted || (profile?.maxAge == null && parental.hideRestricted)) && !unlocked;
    const staticRating = (it) => {
      const o = overrides[it.id]?.rating ?? (it.seriesId ? overrides[it.seriesId]?.rating : undefined);
      if (o != null) return o;
      const m = metaRatings[it.seriesId || it.id];
      if (m != null) return m;
      return parental.blockAdultGroups && ADULT_RE.test(it.group || '') ? 18 : null;
    };
    const restrictedStatic = (it) => {
      if (isLocked(it)) return true;
      if (ageLimit == null) return false;
      const r = staticRating(it);
      return r == null ? blockUnrated : r > ageLimit;
    };
    const visible = (it) =>
      !gone(it.id) && !hidden(it.id) && !(it.seriesId && (gone(it.seriesId) || hidden(it.seriesId))) && !(hideR && restrictedStatic(it));

    const built = buildSeries(raw.filter((i) => i.type === 'series' && !i.shell && !gone(i.id)));
    const shells = raw
      .filter((i) => i.shell)
      .map((s) => {
        const loaded = Array.isArray(episodesBy[s.id]) ? episodesBy[s.id] : [];
        return { ...s, episodes: loaded, seasons: [...new Set(loaded.map((e) => e.series.season))], episodesState: episodesBy[s.id] };
      });
    const allSeries = [...built, ...shells];
    for (const s of allSeries) {
      byId.set(s.id, s);
      for (const e of s.episodes) byId.set(e.id, e);
    }
    const live = raw.filter((i) => i.type === 'live' && visible(i));
    const visSeries = allSeries
      .filter(visible)
      .map((s) => {
        const episodes = s.episodes.filter(visible);
        return { ...s, episodes, seasons: [...new Set(episodes.map((e) => e.series.season))] };
      })
      .filter((s) => s.shell || s.episodes.length);
    for (const s of visSeries) byId.set(s.id, s);
    // Versões do mesmo título (dublado/legendado/4K) viram um item só; a dublada é a principal.
    const movies = mergeVariants(raw.filter((i) => i.type === 'movie' && visible(i)));
    const series = mergeVariants(visSeries);
    for (const p of [...movies, ...series]) {
      byId.set(p.id, p);
      if (!p.variants) continue;
      byId.set(p.id, p);
      // Todas as versões abrem a mesma página (com a troca de idioma).
      for (const v of p.variants) if (v.id !== p.id) byId.set(v.id, { ...byId.get(v.id), variants: p.variants, primaryId: p.id, displayName: p.displayName });
    }
    return { all: [...live, ...movies, ...visSeries.flatMap((s) => s.episodes)], raw, live, movies, series, byId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, itemsByPl, episodesBy, localLogos, overrides, rawParental, unlocked, metaRatings, hiddenList, deletedList, masterHidden, masterDeleted, profile]);

  // Canais existentes, para o worker ignorar o restante do XMLTV (guias Xtream são enormes).
  useEffect(() => {
    const ids = new Set();
    const names = new Set();
    for (const it of catalog.raw) {
      if (it.type !== 'live') continue;
      if (it.tvgId) ids.add(it.tvgId.toLowerCase());
      names.add(normName(it.name));
    }
    liveKeysRef.current = { ids: [...ids], names: [...names] };
  }, [catalog.raw]);

  useEffect(() => {
    if (loading) return;
    for (const s of epgSources) loadEpg(s);
  }, [epgSources, loading, loadEpg]);

  const epgIndex = useMemo(() => {
    const byId = new Map();
    const byName = new Map();
    for (const s of epgSources) {
      const e = epg[s.key];
      if (!e?.programmes) continue;
      for (const [cid, progs] of Object.entries(e.programmes)) {
        byId.set(cid.toLowerCase(), progs);
        for (const nm of e.channels?.[cid]?.names || []) byName.set(normName(nm), progs);
      }
    }
    return { byId, byName };
  }, [epg, epgSources]);

  const programmesFor = useCallback(
    (item) =>
      item?.type === 'live'
        ? epgIndex.byId.get((item.tvgId || '').toLowerCase()) || epgIndex.byName.get(normName(item.name)) || null
        : null,
    [epgIndex]
  );

  const ratingOf = (item, useEpg = true) => {
    if (!item) return null;
    const o = overrides[item.id]?.rating ?? (item.seriesId ? overrides[item.seriesId]?.rating : undefined);
    if (o != null) return o;
    if (useEpg && item.type === 'live') {
      const now = findNow(programmesFor(item));
      if (now?.rating != null) return now.rating;
    }
    const m = metaRatings[item.seriesId || item.id];
    if (m != null) return m;
    if (parental.blockAdultGroups && ADULT_RE.test(item.group || '')) return 18;
    return null;
  };
  const isRestricted = (item, useEpg = true) => {
    if (!item) return false;
    if (isLocked(item)) return true;
    if (ageLimit == null) return false;
    const r = ratingOf(item, useEpg);
    return r == null ? blockUnrated : r > ageLimit;
  };

  const requestPin = useCallback((reason, opts = {}) => new Promise((resolve) => setPinReq({ reason, resolve, ...opts })), []);
  const resolvePin = (ok, newPin) => {
    if (newPin) pinReq?.onPin ? pinReq.onPin(newPin) : setParental((p) => ({ ...p, pin: newPin }));
    if (ok && !pinReq?.profileId && !pinReq?.onPin) setUnlockedUntil(Date.now() + UNLOCK_MS);
    pinReq?.resolve(ok);
    setPinReq(null);
  };
  // Sem PIN definido, um perfil infantil não pode criá-lo (senão a criança liberaria tudo).
  const kidsWithoutPin = () => {
    notify('Peça para o perfil master criar o PIN de controle parental em Configurações.', 'err');
    return Promise.resolve(false);
  };
  const unlock = (reason = 'Digite o PIN para continuar') =>
    unlockedUntil > Date.now()
      ? Promise.resolve(true)
      : !parental.pin && profile?.kids
        ? kidsWithoutPin()
        : requestPin(reason);
  const ensurePin = (reason = 'Crie um PIN de 4 dígitos para proteger o conteúdo') =>
    parental.pin ? unlock() : profile?.kids ? kidsWithoutPin() : requestPin(reason);
  const guard = (item) =>
    !isRestricted(item) || unlockedUntil > Date.now()
      ? Promise.resolve(true)
      : !parental.pin && profile?.kids
        ? kidsWithoutPin()
        : requestPin(`“${item.name}” está bloqueado pelo controle parental.`);

  // Lembra o master de criar o PIN quando existem perfis infantis desprotegidos.
  useEffect(() => {
    if (isMaster && !parental.pin && profiles.some((p) => p.kids))
      notify('Existem perfis infantis: crie o PIN de controle parental em Configurações → Controle parental para protegê-los.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMaster]);

  const setOverride = useCallback(
    (id, patch) =>
      setOverrides((all) => {
        const next = { ...all[id], ...patch };
        for (const k of Object.keys(next)) if (next[k] == null || next[k] === false) delete next[k];
        const copy = { ...all };
        if (Object.keys(next).length) copy[id] = next;
        else delete copy[id];
        return copy;
      }),
    [setOverrides]
  );

  // ---------- Validação das fontes ao vivo ----------
  // Ao abrir o app, testa os canais da troca rápida (um por vez, para não estourar o limite de
  // conexões do provedor) e, para cada canal, usa a melhor versão HD que estiver no ar.
  // Resultados anteriores são usados enquanto a nova validação acontece.
  const [health, setHealth] = useState(() => LS.load('liveHealth', {}));
  const [healthRun, setHealthRun] = useState({ running: false, done: 0, total: 0, replaced: 0, offline: 0, at: 0 });
  const playingRef = useRef(null);
  playingRef.current = playing;
  const healthRunId = useRef(0);

  const validateLive = useCallback(async () => {
    const runId = ++healthRunId.current;
    const groups = zapGroups(catalog.live, settingsRef.current.uf);
    const delay = settingsRef.current.liveDelay;
    const fresh = {};
    let done = 0;
    let replaced = 0;
    let offline = 0;
    setHealthRun({ running: true, done: 0, total: groups.length, replaced: 0, offline: 0, at: Date.now() });
    for (const g of groups) {
      let found = false;
      for (const [i, ch] of g.candidates.entries()) {
        // Não testa enquanto alguém assiste: o teste ocuparia uma conexão do provedor.
        while (playingRef.current && runId === healthRunId.current) await new Promise((r) => setTimeout(r, 2000));
        if (runId !== healthRunId.current) return;
        const r = await probeChannel(ch, delay);
        fresh[ch.id] = r;
        setHealth((h) => ({ ...h, [ch.id]: r }));
        if (r.ok) {
          found = true;
          if (i > 0) replaced++;
          break;
        }
      }
      if (!found) offline++;
      done++;
      setHealthRun((s) => ({ ...s, done, replaced, offline }));
    }
    if (runId !== healthRunId.current) return;
    setHealthRun((s) => ({ ...s, running: false }));
    // Guarda só o resultado desta rodada (canais que voltaram ao ar deixam de constar como fora).
    setHealth(fresh);
    LS.save('liveHealth', fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.live]);

  // Uma validação por abertura do app, depois que as listas carregarem.
  const validatedOnce = useRef(false);
  useEffect(() => {
    if (loading || syncing || validatedOnce.current || !catalog.live.length || !settings.curatedZap) return;
    validatedOnce.current = true;
    validateLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, syncing, catalog.live.length, settings.curatedZap]);

  // ---------- Perfis ----------
  const activate = (id) => {
    try {
      id ? sessionStorage.setItem(SESSION_KEY, id) : sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* sem sessionStorage */
    }
    setPlaying(null);
    setMenuItem(null);
    setProgram(null);
    setUnlockedUntil(0);
    setActiveId(id);
  };
  const selectProfile = async (id) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return false;
    if (p.pin && !(await requestPin(`Perfil “${p.name}”`, { pin: p.pin, profileId: p.id }))) return false;
    activate(id);
    return true;
  };
  // O perfil master gerencia os perfis livremente; nos demais, exige o PIN de controle parental.
  const canManageProfiles = () =>
    isMaster || !parental.pin ? Promise.resolve(true) : unlock('Digite o PIN de controle parental para gerenciar perfis');
  const saveProfile = (p) => setProfiles((ps) => (ps.some((x) => x.id === p.id) ? ps.map((x) => (x.id === p.id ? p : x)) : [...ps, p]));
  const deleteProfile = (id) => {
    const p = profiles.find((x) => x.id === id);
    if (!p || p.master || profiles.length <= 1) return;
    for (const k of PROFILE_KEYS) LS.remove(`p:${id}:${k}`);
    setProfiles((ps) => ps.filter((x) => x.id !== id));
    if (id === activeId) activate(null);
  };

  const toggleIn = (setter) => (id) => setter((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const value = {
    account,
    loading,
    syncing,
    profiles,
    profile,
    masterProfile: master,
    isMaster,
    selectProfile,
    switchProfile: () => activate(null),
    saveProfile,
    deleteProfile,
    canManageProfiles,
    requestPin,

    hiddenList,
    deletedList,
    masterHidden,
    masterDeleted,
    isHidden: (id) => hiddenList.includes(id) || masterHidden.includes(id),
    isHiddenByMaster: (id) => !isMaster && masterHidden.includes(id),
    toggleHidden: toggleIn(setHiddenList),
    deleteItem: (id) => setDeletedList((l) => (l.includes(id) ? l : [...l, id])),
    restoreItem: (id) => setDeletedList((l) => l.filter((x) => x !== id)),

    playlists,
    catalog,
    loadEpisodes,
    getXtreamInfo,
    favorites,
    isFavorite: (id) => favorites.includes(id),
    toggleFavorite: toggleIn(setFavorites),
    history,
    saveProgress: useCallback(
      (id, data) => setHistory((h) => ({ ...h, [id]: { ...h[id], ...data, at: Date.now() } })),
      [setHistory]
    ),
    clearHistory: () => setHistory({}),
    settings,
    updateSettings: (patch) => setSettings((s) => ({ ...DEFAULT_SETTINGS, ...s, ...patch })),
    importPlaylist,
    refreshPlaylist,
    removePlaylist,
    checkForUpdates: () => checkForUpdates(playlists, { force: true }),
    liveHealth: health,
    healthRun,
    validateLive,
    markLiveHealth: (id, r) => setHealth((h) => ({ ...h, [id]: r })),

    epg,
    epgSources,
    programmesFor,
    refreshEpg: () => Promise.all(epgSources.map((s) => loadEpg(s, true))),

    parental,
    updateParental: (patch) => setParental((p) => ({ ...DEFAULT_PARENTAL, ...p, ...patch })),
    unlocked,
    unlock,
    ensurePin,
    lockNow: () => setUnlockedUntil(0),
    requestPinChange: async () => {
      if (parental.pin && !(await unlock('Digite o PIN atual'))) return false;
      return new Promise((resolve) => setPinReq({ reason: '', resolve, create: true }));
    },
    pinReq,
    resolvePin,
    ratingOf,
    isLocked,
    isRestricted,

    overrides,
    setOverride,
    metaRatings,
    setMetaRating: (id, age) => metaRatings[id] !== age && setMetaRatings((m) => ({ ...m, [id]: age })),
    tmdbLinks,
    linkTmdb: (key, itemId) => tmdbLinks[key] !== itemId && setTmdbLinks((l) => ({ ...l, [key]: itemId })),

    toasts,
    notify,
    dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    menuItem,
    openMenu: setMenuItem,
    closeMenu: () => setMenuItem(null),
    program,
    openProgram: setProgram,
    closeProgram: () => setProgram(null),
    trailer,
    openTrailer: setTrailer,
    closeTrailer: () => setTrailer(null),

    playing,
    play: async (item, queue) => {
      if (!(await guard(item))) return false;
      setPlaying({ item, queue: queue || [item] });
      return true;
    },
    stop: () => setPlaying(null),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
