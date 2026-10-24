// Agenda esportiva para todos os aparelhos: o servidor consulta o TheSportsDB no máximo a cada
// 20 minutos (a chave gratuita permite ~30 consultas por minuto) e entrega tudo pronto ao app.
const API = 'https://www.thesportsdb.com/api/v1/json/123';
const LEAGUES = { pl: 4328, br: 4351, nfl: 4391, nba: 4387, ufc: 4443 };
const DAYS = 4; // datas UTC consultadas: hoje + 3 (cobre "hoje e os próximos 2 dias" no horário de Brasília)
const FRESH = 20 * 60e3;
const KEY = 'sports:v1';

const KEEP = ['idEvent', 'strTimestamp', 'dateEvent', 'strTime', 'strEvent', 'strHomeTeam', 'strAwayTeam', 'strHomeTeamBadge', 'strAwayTeamBadge',
  'strLeagueBadge', 'intRound', 'strThumb', 'strBanner', 'strFanart', 'strPoster', 'strSquare', 'strVenue', 'strStatus', 'intHomeScore', 'intAwayScore'];
const slim = (e) => Object.fromEntries(KEEP.filter((k) => e[k] != null && e[k] !== '').map((k) => [k, e[k]]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'GATES-TV' }, cf: { cacheTtl: 600 } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function sportsFeed(env) {
  const saved = (await env.FILES.get(KEY, { type: 'json' }).catch(() => null)) || { parts: {} };
  const parts = { ...saved.parts };
  const today = Date.now();
  const dates = Array.from({ length: DAYS }, (_, i) => new Date(today + i * 864e5).toISOString().slice(0, 10));
  const jobs = [];
  for (const [k, id] of Object.entries(LEAGUES)) for (const d of dates) jobs.push([`${k}:${d}`, `${API}/eventsday.php?d=${d}&l=${id}`, k]);
  jobs.push(['ufc:next', `${API}/eventsnextleague.php?id=${LEAGUES.ufc}`, 'ufc']);
  // Descarta partes de datas que já passaram.
  const wanted = new Set(jobs.map((j) => j[0]));
  for (const p of Object.keys(parts)) if (!wanted.has(p)) delete parts[p];
  // Atualiza aos poucos: no máximo 8 partes por vez, as que faltam primeiro e depois as mais antigas.
  const stale = jobs
    .filter(([part]) => !parts[part] || Date.now() - parts[part].at > FRESH)
    .sort((x, y) => (parts[x[0]]?.at || 0) - (parts[y[0]]?.at || 0))
    .slice(0, 8);
  if (!stale.length) return { parts };
  let changed = false;
  for (const [part, url, league] of stale) {
    try {
      const j = await fetchJson(url);
      parts[part] = { league, at: Date.now(), events: (j?.events || []).map(slim) };
      changed = true;
    } catch (err) {
      if (/429/.test(err.message)) break; // limite de consultas: para e tenta na próxima visita
    }
    await sleep(600);
  }
  if (changed) await env.FILES.put(KEY, JSON.stringify({ parts })).catch(() => {});
  return { parts };
}

export async function sportsResponse(env) {
  const feed = await sportsFeed(env);
  const events = [];
  for (const p of Object.values(feed.parts)) for (const e of p.events) events.push({ league: p.league, ...e });
  return { ok: true, events };
}
