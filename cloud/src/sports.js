// Agenda esportiva para todos os aparelhos: o servidor consulta a ESPN (placar público, sem chave)
// e entrega tudo pronto ao app, no mesmo formato que o app já entende (campos do TheSportsDB).
const API = 'https://site.api.espn.com/apis/site/v2/sports';
// Chave da liga no app -> caminho na ESPN.
const LEAGUES = {
  pl: 'soccer/eng.1',
  br: 'soccer/bra.1',
  lib: 'soccer/conmebol.libertadores',
  sula: 'soccer/conmebol.sudamericana',
  ucl: 'soccer/uefa.champions',
  uel: 'soccer/uefa.europa',
  cdb: 'soccer/bra.copa_do_brazil',
  carioca: 'soccer/bra.camp.carioca',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  ufc: 'mma/ufc',
  atp: 'tennis/atp',
  wta: 'tennis/wta',
};
const TENNIS = new Set(['atp', 'wta']);
const DAYS = 5; // datas consultadas: ontem + hoje + 3 (as datas da ESPN seguem o horário dos EUA)
const UFC_DAYS = 9; // o app mostra o próximo card do UFC em até 8 dias
const FRESH = 10 * 60e3;
const PER_VISIT = 20; // a Cloudflare grátis permite 50 consultas externas por visita
const KEY = 'sports:v2';

const ROUNDS = {
  'round 1': '1ª rodada', 'round 2': '2ª rodada', 'round 3': '3ª rodada', 'round of 128': '1ª rodada', 'round of 64': '1ª rodada',
  'round of 32': '2ª rodada', 'round of 16': 'Oitavas de final', quarterfinals: 'Quartas de final', quarterfinal: 'Quartas de final',
  semifinals: 'Semifinal', semifinal: 'Semifinal', final: 'Final', qualifying: 'Qualificatório',
};
const roundName = (name) => ROUNDS[String(name || '').toLowerCase()] || name || '';

// "2026-11-03T17:45Z" -> "2026-11-03T17:45:00" (o app soma o "Z" ao ler).
const stamp = (d) => new Date(d).toISOString().slice(0, 19);
const status = (s) => ({ pre: 'NS', in: 'LIVE', post: 'FT' })[s?.type?.state] || '';
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
const logoOf = (logos) => (logos || []).find((l) => (l.rel || []).includes('dark'))?.href || logos?.[0]?.href || '';

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'GATES-TV' }, cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Jogo de time (futebol, NFL, NBA).
function teamEvent(league, e, leagueBadge) {
  const c = e.competitions?.[0] || {};
  const home = c.competitors?.find((x) => x.homeAway === 'home') || c.competitors?.[0];
  const away = c.competitors?.find((x) => x.homeAway === 'away') || c.competitors?.[1];
  if (!home?.team || !away?.team) return null;
  const st = c.status || e.status;
  const started = st?.type?.state !== 'pre';
  return {
    idEvent: `${league}-${e.id}`,
    strTimestamp: stamp(e.date),
    strEvent: `${home.team.displayName} vs ${away.team.displayName}`,
    strHomeTeam: home.team.displayName,
    strAwayTeam: away.team.displayName,
    // Nome curto ("Stuttgart" para "VfB Stuttgart"): ajuda a achar o jogo no guia dos canais.
    strHomeTeamShort: home.team.shortDisplayName,
    strAwayTeamShort: away.team.shortDisplayName,
    strHomeTeamBadge: home.team.logo || '',
    strAwayTeamBadge: away.team.logo || '',
    strLeagueBadge: leagueBadge,
    intRound: e.week?.number ? String(e.week.number) : undefined,
    strRound: c.notes?.[0]?.headline || '',
    strVenue: c.venue?.fullName || '',
    strStatus: status(st),
    intHomeScore: started ? home.score : undefined,
    intAwayScore: started ? away.score : undefined,
  };
}

// Card do UFC: "UFC Fight Night: Fulano vs. Beltrano" (o app separa evento e lutadores).
const fightEvent = (league, e, leagueBadge) => ({
  idEvent: `${league}-${e.id}`,
  strTimestamp: stamp(e.date),
  strEvent: e.name,
  strLeagueBadge: leagueBadge,
  strVenue: e.competitions?.[0]?.venue?.fullName || '',
  strStatus: status(e.status),
});

// Partidas de simples de um torneio de tênis, dentro da janela da agenda.
function tennisEvents(league, e, leagueBadge, from, to) {
  const out = [];
  for (const g of e.groupings || []) {
    if (!/singles/i.test(g.grouping?.slug || g.grouping?.displayName || '')) continue;
    for (const m of g.competitions || []) {
      const [a, b] = m.competitors || [];
      const t = Date.parse(m.date);
      if (!a?.athlete?.displayName || !b?.athlete?.displayName || !(t >= from && t < to)) continue;
      const started = m.status?.type?.state !== 'pre';
      out.push({
        idEvent: `${league}-${m.id}`,
        strTimestamp: stamp(m.date),
        strEvent: `${a.athlete.displayName} vs ${b.athlete.displayName}`,
        strHomeTeam: a.athlete.displayName,
        strAwayTeam: b.athlete.displayName,
        strHomeTeamBadge: a.athlete.flag?.href || '',
        strAwayTeamBadge: b.athlete.flag?.href || '',
        strLeagueBadge: leagueBadge,
        strTournament: e.name,
        strRound: roundName(m.round?.displayName),
        strVenue: [m.venue?.court, m.venue?.fullName].filter(Boolean).join(' · '),
        strStatus: status(m.status),
        intHomeScore: started ? a.score : undefined,
        intAwayScore: started ? b.score : undefined,
      });
    }
  }
  return out;
}

export async function sportsFeed(env) {
  const saved = (await env.FILES.get(KEY, { type: 'json' }).catch(() => null)) || { parts: {} };
  const parts = { ...saved.parts };
  const now = Date.now();
  const dates = Array.from({ length: DAYS }, (_, i) => ymd(now + (i - 1) * 864e5));
  const jobs = [];
  for (const [k, path] of Object.entries(LEAGUES)) {
    // Tênis: o placar traz os torneios da semana inteiros. UFC: aceita intervalo de datas.
    if (TENNIS.has(k)) jobs.push([`${k}:all`, `${API}/${path}/scoreboard`, k]);
    else if (k === 'ufc') jobs.push([`${k}:next`, `${API}/${path}/scoreboard?dates=${dates[1]}-${ymd(now + UFC_DAYS * 864e5)}`, k]);
    else for (const d of dates) jobs.push([`${k}:${d}`, `${API}/${path}/scoreboard?dates=${d}`, k]);
  }
  // Descarta partes de datas que já passaram (e de ligas que saíram da lista).
  const wanted = new Set(jobs.map((j) => j[0]));
  for (const p of Object.keys(parts)) if (!wanted.has(p)) delete parts[p];
  // Atualiza aos poucos: as que faltam primeiro e depois as mais antigas.
  const stale = jobs
    .filter(([part]) => !parts[part] || now - parts[part].at > FRESH)
    .sort((x, y) => (parts[x[0]]?.at || 0) - (parts[y[0]]?.at || 0))
    .slice(0, PER_VISIT);
  if (!stale.length) return { parts };
  const from = now - 864e5;
  const to = now + (DAYS - 1) * 864e5;
  const results = await Promise.allSettled(
    stale.map(async ([part, url, league]) => {
      const j = await fetchJson(url);
      const badge = logoOf(j.leagues?.[0]?.logos);
      const events = [];
      for (const e of j.events || []) {
        if (TENNIS.has(league)) events.push(...tennisEvents(league, e, badge, from, to));
        else if (league === 'ufc') events.push(fightEvent(league, e, badge));
        else events.push(teamEvent(league, e, badge));
      }
      parts[part] = { league, at: Date.now(), events: events.filter(Boolean) };
    })
  );
  if (results.some((r) => r.status === 'fulfilled')) await env.FILES.put(KEY, JSON.stringify({ parts })).catch(() => {});
  return { parts };
}

export async function sportsResponse(env) {
  const feed = await sportsFeed(env);
  const events = [];
  const seen = new Set();
  for (const p of Object.values(feed.parts))
    for (const e of p.events) {
      // Jogos encerrados não aparecem no app.
      if (e.strStatus === 'FT' || seen.has(e.idEvent)) continue;
      seen.add(e.idEvent);
      events.push({ league: p.league, ...e });
    }
  return { ok: true, events };
}
