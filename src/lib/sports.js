// Esportes: próximos jogos e lutas (agenda da ESPN via servidor), escudos dos times e ligação com os canais do EPG.
import { get, set } from 'idb-keyval';
import { useEffect, useState } from 'react';
import { normTitle } from './meta';

const API = 'https://www.thesportsdb.com/api/v1/json/123';
// A agenda vem pronta do nosso servidor (ele consulta a ESPN por todos os aparelhos).
// O TheSportsDB (API acima) só é usado para buscar escudos dos jogos do guia.
const FEED = (import.meta.env.VITE_LICENSE_API || 'https://gatesapptv.pages.dev').replace(/\/$/, '') + '/api/v1/sports';

export const LEAGUES = {
  pl: { name: 'Premier League', short: 'Premier League', rounds: 'Rodada' },
  br: { name: 'Brasileirão Série A', short: 'Brasileirão', rounds: 'Rodada' },
  lib: { name: 'Copa Libertadores', short: 'Libertadores', rounds: '' },
  sula: { name: 'Copa Sul-Americana', short: 'Sul-Americana', rounds: '' },
  cdb: { name: 'Copa do Brasil', short: 'Copa do Brasil', rounds: '' },
  carioca: { name: 'Campeonato Carioca', short: 'Carioca', rounds: '' },
  ucl: { name: 'Champions League', short: 'Champions', rounds: '' },
  uel: { name: 'Europa League', short: 'Europa League', rounds: '' },
  nfl: { name: 'NFL', short: 'NFL', rounds: 'Semana' },
  nba: { name: 'NBA', short: 'NBA', rounds: '' },
  ufc: { name: 'UFC', short: 'UFC', rounds: '', fight: true },
  atp: { name: 'Tênis ATP', short: 'ATP', rounds: '', individual: true },
  wta: { name: 'Tênis WTA', short: 'WTA', rounds: '', individual: true },
};
// Futebol: competições do Brasil e da América do Sul x competições europeias (destaques equilibrados).
const SOCCER_BR = ['br', 'lib', 'sula', 'cdb', 'carioca'];
const SOCCER_EU = ['pl', 'ucl', 'uel'];
// Quantos dias à frente a agenda mostra (hoje + próximos).
const DAYS_AHEAD = 2;
const FAVORITE_BR = 'vasco da gama';
const FAVORITE_NFL = 'new england patriots';
// Copas podem ter prorrogação e pênaltis.
const DURATION = {
  pl: 2 * 3600e3, br: 2 * 3600e3, carioca: 2 * 3600e3, lib: 2.5 * 3600e3, sula: 2.5 * 3600e3, cdb: 2.5 * 3600e3, ucl: 2.5 * 3600e3, uel: 2.5 * 3600e3,
  nfl: 3.5 * 3600e3, nba: 2.5 * 3600e3, ufc: 5 * 3600e3, atp: 2.5 * 3600e3, wta: 2.5 * 3600e3, other: 2.5 * 3600e3,
};

// "UFC 333 Volkanovski vs Evloev" / "UFC Fight Night: Silva vs Costa" -> evento + lutadores.
function splitFight(title) {
  const t = String(title || '').trim();
  let card = '';
  let rest = t;
  const colon = /^([^:]{2,60}):\s*(.+)$/.exec(t);
  const num = /^(UFC\s+(?:\d+|Fight Night|on \w+(?: \w+)?))\s+(.+)$/i.exec(t);
  if (colon) [, card, rest] = colon;
  else if (num) [, card, rest] = num;
  const m = /^(.+?)\s+(?:vs\.?|x|v)\s+(.+)$/i.exec(rest);
  return m ? { card: card || 'UFC', a: m[1].trim(), b: m[2].trim() } : { card: card || t, a: rest, b: '' };
}

const strip = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Apelidos usados nos guias (EPG) brasileiros para os nomes oficiais.
const ALIASES = {
  'vasco da gama': ['vasco'],
  'atletico mineiro': ['atletico mg', 'atletico-mg', 'galo', 'atl mineiro', 'atletico mineiro'],
  'athletico paranaense': ['athletico pr', 'athletico-pr', 'athletico', 'atletico pr', 'atletico paranaense'],
  'red bull bragantino': ['bragantino', 'rb bragantino'],
  'sport recife': ['sport'],
  'internacional': ['inter', 'internacional'],
  'atletico goianiense': ['atletico go', 'atletico-go'],
  'america mineiro': ['america mg', 'america-mg'],
  'manchester city': ['man city'],
  'manchester united': ['man utd', 'man united'],
  'tottenham hotspur': ['tottenham', 'spurs'],
  'newcastle united': ['newcastle'],
  'west ham united': ['west ham'],
  'wolverhampton wanderers': ['wolves', 'wolverhampton'],
  'brighton and hove albion': ['brighton'],
  'nottingham forest': ['nottingham', 'nott m forest', 'forest'],
  'leeds united': ['leeds'],
  'afc bournemouth': ['bournemouth'],
  'new england patriots': ['patriots', 'new england'],
};
const REVERSE = new Map();
for (const [canon, list] of Object.entries(ALIASES)) for (const a of list) REVERSE.set(normTitle(a), canon);

export const canonicalTeam = (name) => {
  const n = normTitle(strip(name).replace(/\b(sub-?\d+|feminino|women|u\d+)\b/gi, ''));
  return REVERSE.get(n) || n;
};
const teamKeys = (name) => {
  const c = canonicalTeam(name);
  return [c, ...(ALIASES[c] || []).map(normTitle)];
};
const has = (text, keys) => keys.some((k) => k && ` ${text} `.includes(` ${k} `));

// ---------- Cache simples (memória + IndexedDB) ----------
const mem = new Map();
async function cached(key, ttl, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  try {
    const c = await get('sports:' + key);
    if (c && Date.now() - c.at < ttl) {
      mem.set(key, c);
      return c.v;
    }
  } catch {
    /* sem cache */
  }
  const v = await fn();
  const entry = { at: Date.now(), v };
  mem.set(key, entry);
  set('sports:' + key, entry).catch(() => {});
  return v;
}

// A API gratuita limita requisições: fila com intervalo entre chamadas.
let chain = Promise.resolve();
const queued = (url) => {
  const p = chain.then(async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`TheSportsDB HTTP ${r.status}`);
    return r.json();
  });
  chain = p.catch(() => {}).then(() => new Promise((res) => setTimeout(res, 2100)));
  return p;
};

// ---------- Escudos ----------
// 1) Salvos no aparelho (a própria imagem, pequena): aparecem na hora, até sem internet.
// 2) Os que a agenda da ESPN já trouxe.
// 3) O restante vem do nosso servidor, que guarda os escudos para todos os aparelhos
//    (cloud/src/crests.js). Se o servidor não responder, busca direto no TheSportsDB.
// As imagens vêm reduzidas para 100 px pelo servidor (/api/v1/crest-img).
const BASE = (import.meta.env.VITE_LICENSE_API || 'https://gatesapptv.pages.dev').replace(/\/$/, '');
const CREST_TTL = 30 * 864e5;
const CREST_MISS_TTL = 3 * 864e5;
const badgeMem = new Map(); // nome -> endereço original (ESPN)
const crestMem = new Map(); // nome -> imagem salva (data:) ou endereço; null = sem escudo

export function rememberBadge(name, url) {
  if (name && url) badgeMem.set(canonicalTeam(name), url);
}

// Versão pequena (100 px) de um escudo do TheSportsDB/ESPN, servida pelo nosso servidor.
export const smallCrest = (u) =>
  u && /^https:\/\/(r2\.thesportsdb\.com|www\.thesportsdb\.com|a\.espncdn\.com)\//.test(u) ? `${BASE}/api/v1/crest-img?u=${encodeURIComponent(u)}` : u || null;

async function directBadge(key) {
  return cached('team:' + key, 14 * 864e5, async () => {
    const j = await queued(`${API}/searchteams.php?t=${encodeURIComponent(key)}`);
    const teams = j?.teams || [];
    const t = teams.find((x) => x.strSport === 'Soccer') || teams[0];
    return t?.strBadge || t?.strTeamBadge || null;
  }).catch(() => undefined);
}

async function savedCrest(key) {
  if (crestMem.has(key)) return { hit: true, v: crestMem.get(key) };
  try {
    const c = await get('crest:' + key);
    if (c && Date.now() - c.at < (c.d ? CREST_TTL : CREST_MISS_TTL)) {
      crestMem.set(key, c.d);
      return { hit: true, v: c.d };
    }
  } catch {
    /* sem cache */
  }
  return { hit: false };
}

const readAsDataUrl = (blob) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });

// Baixa a versão pequena e guarda no aparelho. Se não der para guardar, usa o endereço mesmo.
async function storeCrest(key, original) {
  if (!original) {
    crestMem.set(key, null);
    set('crest:' + key, { d: null, at: Date.now() }).catch(() => {});
    return null;
  }
  const src = smallCrest(original);
  let d = src;
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    d = await readAsDataUrl(await r.blob());
    set('crest:' + key, { d, at: Date.now() }).catch(() => {});
  } catch {
    /* fica só o endereço */
  }
  crestMem.set(key, d);
  return d;
}

// Executa no máximo `n` tarefas ao mesmo tempo.
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export function useTeamBadges(names) {
  const [map, setMap] = useState({});
  const sig = names.join('|');
  useEffect(() => {
    let alive = true;
    const byKey = new Map(); // nome normalizado -> nomes como aparecem no guia
    for (const n of names) {
      const k = n && canonicalTeam(n);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(n);
    }
    const show = (found) => {
      if (!alive) return;
      const add = {};
      for (const [k, v] of Object.entries(found)) if (v) for (const n of byKey.get(k) || []) add[n] = v;
      if (Object.keys(add).length) setMap((m) => ({ ...m, ...add }));
    };
    (async () => {
      // 1) Salvos no aparelho: todos de uma vez.
      const saved = {};
      let missing = [];
      await Promise.all(
        [...byKey.keys()].map(async (k) => {
          const s = await savedCrest(k);
          if (s.hit) saved[k] = s.v;
          else missing.push(k);
        })
      );
      show(saved);
      // Mantém a ordem da tela (jogos ao vivo primeiro).
      const order = [...byKey.keys()];
      missing.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      // 2) Já conhecidos pela agenda da ESPN.
      const espn = missing.filter((k) => badgeMem.has(k));
      missing = missing.filter((k) => !badgeMem.has(k));
      await pool(espn, 4, async (k) => alive && show({ [k]: await storeCrest(k, badgeMem.get(k)) }));
      // 3) Servidor (compartilhado por todos os aparelhos); pergunta de novo pelos que ficaram pendentes.
      for (let round = 0; missing.length && alive && round < 10; round++) {
        let res;
        try {
          const r = await fetch(`${BASE}/api/v1/crests?n=${encodeURIComponent(missing.slice(0, 80).join('|'))}`);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          res = await r.json();
        } catch {
          res = null;
        }
        if (!res) {
          // Servidor fora do ar: busca direto, um por vez.
          for (const k of missing) {
            if (!alive) return;
            const u = await directBadge(k);
            if (u !== undefined) show({ [k]: await storeCrest(k, u) });
          }
          return;
        }
        const got = Object.keys(res.crests || {});
        await pool(got, 4, async (k) => alive && show({ [k]: await storeCrest(k, res.crests[k]) }));
        missing = missing.filter((k) => !got.includes(k));
        if (missing.length) await wait(missing.length > 80 ? 500 : 2500);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return map;
}

// ---------- Agenda (vem pronta do servidor: cloud/src/sports.js) ----------

function toEvent(key, l, e) {
  const start = Date.parse((e.strTimestamp || `${e.dateEvent}T${e.strTime || '00:00:00'}`) + 'Z');
  const fight = l.fight || (!e.strHomeTeam && !e.strAwayTeam);
  const f = fight ? splitFight(e.strEvent) : null;
  return {
    id: e.idEvent,
    league: key,
    leagueName: l.name,
    leagueBadge: e.strLeagueBadge,
    home: fight ? f.a : e.strHomeTeam,
    away: fight ? f.b : e.strAwayTeam,
    homeShort: e.strHomeTeamShort,
    awayShort: e.strAwayTeamShort,
    fight,
    individual: !!l.individual,
    homeBadge: e.strHomeTeamBadge,
    awayBadge: e.strAwayTeamBadge,
    start,
    end: start + (DURATION[key] || DURATION.other),
    round: fight
      ? f.card
      : l.individual
        ? [e.strTournament, e.strRound].filter(Boolean).join(' · ')
        : e.intRound && l.rounds
          ? `${l.rounds} ${e.intRound}`
          : e.strRound || '',
    poster: e.strThumb || e.strBanner || e.strFanart || e.strPoster || e.strSquare || '',
    venue: e.strVenue || '',
    status: e.strStatus || '',
    homeScore: e.intHomeScore,
    awayScore: e.intAwayScore,
  };
}

// Jogos e lutas de hoje e dos próximos dias que ainda não terminaram, das ligas acompanhadas.
export async function todaysEvents(now = Date.now()) {
  const local = new Date(now);
  const dayStart = new Date(local.getFullYear(), local.getMonth(), local.getDate()).getTime();
  const dayEnd = dayStart + (DAYS_AHEAD + 1) * 864e5;
  const feed = await cached('feed', 10 * 60e3, async () => {
    const r = await fetch(FEED);
    if (!r.ok) throw new Error('agenda HTTP ' + r.status);
    return (await r.json()).events || [];
  });
  const results = feed.filter((e) => LEAGUES[e.league]).map((e) => toEvent(e.league, LEAGUES[e.league], e));
  const seen = new Set();
  const out = [];
  for (const e of results.flat()) {
    const horizon = e.league === 'ufc' ? dayStart + 8 * 864e5 : dayEnd;
    if (seen.has(e.id) || e.start < dayStart || e.start >= horizon || e.end <= now || /FT|AET|PEN|Finished/i.test(e.status)) continue;
    seen.add(e.id);
    rememberBadge(e.home, e.homeBadge);
    rememberBadge(e.away, e.awayBadge);
    out.push(e);
  }
  return out.sort((a, b) => a.start - b.start);
}

const isLiveEvt = (e, now) => e.start <= now && now < e.end;
const involves = (e, canon) => canonicalTeam(e.home) === canon || canonicalTeam(e.away) === canon;

// Destaques: 2 do futebol brasileiro/sul-americano (Brasileirão, Libertadores, Sul-Americana, Copa do Brasil,
// Carioca; Vasco primeiro) + 2 do europeu (Premier League, Champions, Europa League) + NFL (Patriots primeiro),
// NBA, o próximo card do UFC e tênis (ATP/WTA).
// Dá preferência aos jogos que algum canal da lista transmite.
export function pickFeatured(events, now = Date.now(), hasChannel = () => true) {
  const ch = (e) => (hasChannel(e) ? 1 : 0);
  const by = (keys, fav) =>
    events
      .filter((e) => keys.includes(e.league))
      .sort((a, b) => (fav ? involves(b, fav) - involves(a, fav) : 0) || ch(b) - ch(a) || isLiveEvt(b, now) - isLiveEvt(a, now) || a.start - b.start);
  const br = by(SOCCER_BR, FAVORITE_BR);
  const eu = by(SOCCER_EU);
  const picked = [...br.slice(0, 2), ...eu.slice(0, 2)];
  // Se um grupo não tiver 2 jogos hoje, completa com o outro.
  const extra = [...br.slice(2), ...eu.slice(2)].sort((a, b) => a.start - b.start);
  while (picked.length < 4 && extra.length) picked.push(extra.shift());
  const more = [...by(['nfl'], FAVORITE_NFL).slice(0, 2), ...by(['nba']).slice(0, 2), ...by(['ufc']).slice(0, 1), ...by(['atp', 'wta']).slice(0, 2)];
  return [...picked, ...more].sort((a, b) => isLiveEvt(b, now) - isLiveEvt(a, now) || a.start - b.start);
}

// Tênis: o guia costuma trazer só o sobrenome ("Sinner x Alcaraz").
const playerKeys = (name) => {
  const full = normTitle(strip(name));
  const last = full.split(' ').pop();
  return last && last.length >= 3 && last !== full ? [full, last] : [full];
};

// Canal da lista que transmite o jogo (pelo EPG: programa no horário com os dois times no título).
export function findChannels(evt, live, programmesFor) {
  const keys = (name, short) => {
    const k = evt.individual ? playerKeys(name) : teamKeys(name);
    return short && short !== name ? [...k, ...teamKeys(short)] : k;
  };
  const hk = keys(evt.home, evt.homeShort);
  const ak = keys(evt.away, evt.awayShort);
  const out = [];
  for (const ch of live) {
    const progs = programmesFor(ch);
    if (!progs) continue;
    for (const p of progs) {
      if (p.start > evt.start + 3 * 3600e3) break;
      if (p.stop < evt.start - 1800e3) continue;
      const t = normTitle(strip(`${p.title} ${p.subtitle}`));
      if (has(t, hk) && has(t, ak) && !/reprise|\bvt\b|melhores momentos|compacto/i.test(p.title)) {
        out.push({ channel: ch, prog: p });
        break;
      }
    }
  }
  return out;
}

// Prioridade de jogos do EPG: Vasco > Premier League / Brasileirão > copas (Libertadores, Champions…) > Patriots >
// UFC / NFL / NBA > vôlei e tênis > demais.
const PL_TEAMS = /arsenal|aston villa|bournemouth|brentford|brighton|burnley|chelsea|crystal palace|everton|fulham|leeds|liverpool|manchester|man city|man utd|newcastle|nottingham|sunderland|tottenham|west ham|wolves|wolverhampton/;
const BR_TEAMS = /vasco|flamengo|fluminense|botafogo|palmeiras|corinthians|sao paulo|santos|gremio|internacional|atletico|athletico|cruzeiro|bahia|fortaleza|bragantino|vitoria|sport|ceara|juventude|mirassol|coritiba|remo|chapecoense/;
export function gamePriority(title, category = '') {
  const t = normTitle(strip(`${title} ${category}`));
  if (/\bvasco\b/.test(t)) return 4;
  if (/premier league|campeonato ingles|ingles/.test(t)) return 3;
  if (/brasileir|serie a\b/.test(t) && !/serie b|serie c/.test(t)) return 3;
  if (/libertadores|sul americana|sudamericana|copa do brasil|champions|liga dos campeoes|europa league|liga europa|carioca/.test(t)) return 2.8;
  const teams = t.split(/\s(?:x|vs|v|versus)\s/);
  if (teams.length === 2 && PL_TEAMS.test(teams[0]) && PL_TEAMS.test(teams[1])) return 3;
  if (teams.length === 2 && BR_TEAMS.test(teams[0]) && BR_TEAMS.test(teams[1]) && !/libertadores|copa|sul americana|estadual|carioca|paulista/.test(t)) return 2.5;
  if (/patriots/.test(t)) return 2;
  if (/\bufc\b/.test(t)) return 1.6;
  if (/\bnfl\b|futebol americano/.test(t)) return 1.5;
  if (/\bnba\b/.test(t)) return 1.4;
  if (/\bvolei\b|volley|superliga/.test(t)) return 1.3;
  if (/\btenis\b|tennis|\batp\b|\bwta\b/.test(t)) return 1.3;
  return 0;
}
