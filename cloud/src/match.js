// Estatísticas de um jogo de futebol para o app (GET /api/v1/match?id=br-401841322):
// últimos confrontos, próximos jogos dos dois clubes (todas as competições), artilheiros,
// campanha recente, posição na tabela, chances do jogo (pelas odds) e, nas ligas de pontos
// corridos, os dados para o app simular o resto do campeonato (tabela, força dos times e jogos
// que faltam). A simulação roda no aparelho: o plano grátis da Cloudflare dá só 10 ms de CPU.
// Tudo vem da ESPN (site.api.espn.com, público) e fica guardado no cache da Cloudflare.
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const WEB = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer';

// Ligas do app -> ESPN. "zones": faixas da tabela (quando a ESPN não informa).
const SOCCER = {
  br: { path: 'bra.1', table: true, zones: [{ label: 'Título', from: 1, to: 1 }, { label: 'Libertadores (G6)', from: 1, to: 6 }, { label: 'Sul-Americana', from: 7, to: 12 }, { label: 'Rebaixamento', from: 17, to: 20 }] },
  pl: { path: 'eng.1', table: true, zones: [{ label: 'Título', from: 1, to: 1 }, { label: 'Champions League', from: 1, to: 4 }, { label: 'Rebaixamento', from: 18, to: 20 }] },
  lib: { path: 'conmebol.libertadores' },
  sula: { path: 'conmebol.sudamericana' },
  ucl: { path: 'uefa.champions' },
  uel: { path: 'uefa.europa' },
  cdb: { path: 'bra.copa_do_brazil' },
  carioca: { path: 'bra.camp.carioca' },
};
const MATCH_TTL = 20 * 60; // segundos
const LEAGUE_TTL = 6 * 3600;

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'GATES-TV' } });
  if (!r.ok) throw new Error('ESPN HTTP ' + r.status);
  return r.json();
}

// Cache da Cloudflare (grátis, por região); fora dela (testes) só executa.
async function cachedJson(key, ttl, fn) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const req = new Request('https://cache.gatestv/' + encodeURIComponent(key));
  if (cache) {
    const hit = await cache.match(req).catch(() => null);
    if (hit) return hit.json();
  }
  const v = await fn();
  if (cache) await cache.put(req, new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } })).catch(() => {});
  return v;
}

const team = (t) => (t ? { id: String(t.id), name: t.displayName || t.name || '', short: t.shortDisplayName || t.abbreviation || '', logo: t.logo || t.logos?.[0]?.href || '' } : null);
const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(/[^\d.-]/g, '')) || 0);
// "Matches: 35, Goals: 20" -> { matches: 35, goals: 20 }
const parseLeader = (txt) => {
  const m = /Matches:\s*(\d+).*?Goals:\s*(\d+)/i.exec(String(txt || ''));
  return m ? { matches: +m[1], goals: +m[2] } : { matches: null, goals: num(txt) };
};
// Odds americanas -> probabilidade (normalizada para somar 100%, sem a margem da casa).
const implied = (ml) => (ml == null ? null : ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100));

function competitionName(e) {
  return e.league?.name || e.league?.abbreviation || e.competitions?.[0]?.league?.name || e.season?.displayName || '';
}

// Próximos 3 jogos de um clube em qualquer competição (fora o jogo atual).
async function nextGames(teamId, currentId) {
  const j = await getJson(`${SITE}/all/teams/${teamId}/schedule?fixture=true`).catch(() => ({ events: [] }));
  return (j.events || [])
    .filter((e) => e.id !== currentId && Date.parse(e.date) > Date.now() - 3 * 3600e3)
    .slice(0, 3)
    .map((e) => {
      const c = e.competitions?.[0] || {};
      const me = c.competitors?.find((x) => String(x.team?.id || x.id) === String(teamId));
      const op = c.competitors?.find((x) => x !== me);
      return { date: e.date, home: me?.homeAway === 'home', opponent: team(op?.team)?.name || '', competition: competitionName(e) || c.league?.name || '' };
    });
}

// Dados da liga para a simulação: tabela, força (gols pró/contra) e jogos que faltam.
async function leagueData(key) {
  const lg = SOCCER[key];
  return cachedJson(`league:${key}:v1`, LEAGUE_TTL, async () => {
    const st = await getJson(`${STANDINGS}/${lg.path}/standings`);
    const entries = st.children?.[0]?.standings?.entries || st.standings?.entries || [];
    const stat = (e, n) => e.stats?.find((s) => s.name === n)?.value ?? 0;
    const teams = entries.map((e) => ({
      id: String(e.team.id),
      name: e.team.displayName,
      rank: stat(e, 'rank'),
      pts: stat(e, 'points'),
      gp: stat(e, 'gamesPlayed'),
      gf: stat(e, 'pointsFor'),
      ga: stat(e, 'pointsAgainst'),
      gd: stat(e, 'pointDifferential'),
    }));
    // Zonas: as da ESPN (quando informa) ou as fixas da liga.
    const noted = new Map();
    for (const e of entries) {
      const d = e.note?.description;
      if (!d) continue;
      const r = stat(e, 'rank');
      const z = noted.get(d) || { label: d, from: r, to: r };
      z.from = Math.min(z.from, r);
      z.to = Math.max(z.to, r);
      noted.set(d, z);
    }
    const zones = [{ label: 'Título', from: 1, to: 1 }, ...(noted.size ? [...noted.values()] : lg.zones.filter((z) => z.label !== 'Título'))];
    // Jogos que faltam: agenda de cada time na liga (uma consulta por time, guardada por 6 h).
    const fixtures = new Map();
    await Promise.all(
      teams.map(async (t) => {
        const j = await getJson(`${SITE}/${lg.path}/teams/${t.id}/schedule?fixture=true`).catch(() => ({ events: [] }));
        for (const e of j.events || []) {
          const c = e.competitions?.[0];
          const h = c?.competitors?.find((x) => x.homeAway === 'home');
          const a = c?.competitors?.find((x) => x.homeAway === 'away');
          if (h && a && c?.status?.type?.state !== 'post') fixtures.set(e.id, [String(h.team?.id || h.id), String(a.team?.id || a.id)]);
        }
      })
    );
    return { teams, zones, fixtures: [...fixtures.values()], at: Date.now() };
  });
}

export async function matchResponse(url) {
  const raw = String(url.searchParams.get('id') || '');
  const m = /^([a-z]+)-(\d{4,12})$/.exec(raw);
  if (!m || !SOCCER[m[1]]) return { ok: false, error: 'bad_request', message: 'Jogo inválido.' };
  const [, key, id] = m;
  const lg = SOCCER[key];
  return cachedJson(`match:${key}:${id}:v1`, MATCH_TTL, async () => {
    const s = await getJson(`${SITE}/${lg.path}/summary?event=${id}`);
    const comp = s.header?.competitions?.[0] || {};
    const home = comp.competitors?.find((c) => c.homeAway === 'home') || comp.competitors?.[0];
    const away = comp.competitors?.find((c) => c.homeAway === 'away') || comp.competitors?.[1];
    const H = team(home?.team);
    const A = team(away?.team);
    if (!H || !A) return { ok: false, error: 'not_found', message: 'Jogo não encontrado.' };

    // Últimos 3 confrontos (do mais recente para o mais antigo).
    const series = (s.seasonseries || []).find((x) => /head/i.test(x.type || '')) || s.seasonseries?.[0];
    const h2h = (series?.events || [])
      .filter((e) => e.status === 'post' || e.statusType?.completed)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 3)
      .map((e) => {
        const ch = e.competitors?.find((c) => c.homeAway === 'home');
        const ca = e.competitors?.find((c) => c.homeAway === 'away');
        const nameOf = (c) => (String(c?.team?.id) === H.id ? H.name : String(c?.team?.id) === A.id ? A.name : c?.team?.displayName || '');
        return { date: e.date, home: nameOf(ch), away: nameOf(ca), homeScore: num(ch?.score), awayScore: num(ca?.score), competition: e.leagueName || e.league?.name || '' };
      });

    // Campanha recente (V/E/D), do mais antigo para o mais recente.
    const formOf = (tid) =>
      (s.lastFiveGames || [])
        .find((x) => String(x.team?.id) === tid)
        ?.events?.map((e) => ({ W: 'V', D: 'E', L: 'D' })[e.gameResult] || '')
        .join('') || '';

    // Artilheiros: de cada clube (resumo do jogo) e da liga (estatísticas da ESPN).
    const clubScorer = (tid) => {
      const g = (s.leaders || []).find((x) => String(x.team?.id) === tid)?.leaders?.find((c) => c.name === 'goalsLeaders')?.leaders?.[0];
      return g?.athlete ? { name: g.athlete.displayName, ...parseLeader(g.displayValue) } : null;
    };
    let leagueScorer = null;
    try {
      const st = await getJson(`${WEB}/${lg.path}/statistics`);
      const top = st.stats?.find((x) => x.name === 'goalsLeaders')?.leaders?.[0];
      if (top?.athlete) leagueScorer = { name: top.athlete.displayName, team: top.athlete.team?.displayName || '', ...parseLeader(top.displayValue) };
    } catch {
      /* sem artilharia da liga */
    }

    // Chances do jogo pelas odds (vitória do mandante / empate / vitória do visitante).
    const o = (s.odds || s.pickcenter || [])[0];
    let odds = null;
    if (o) {
      const p = [implied(o.homeTeamOdds?.moneyLine), implied(o.drawOdds?.moneyLine), implied(o.awayTeamOdds?.moneyLine)];
      const sum = p.reduce((x, y) => x + (y || 0), 0);
      if (p.every((x) => x != null) && sum > 0) odds = { home: p[0] / sum, draw: p[1] / sum, away: p[2] / sum, provider: o.provider?.name || '' };
    }

    // Tabela do resumo (posição e pontos dos dois times).
    const entries = s.standings?.groups?.flatMap((g) => g.standings?.entries || []) || [];
    const row = (tid) => {
      const e = entries.find((x) => String(x.id) === tid);
      if (!e) return null;
      const v = (n) => num(e.stats?.find((x) => x.name === n)?.displayValue);
      return { rank: v('rank'), points: v('points'), played: v('gamesPlayed'), wins: v('wins'), draws: v('ties'), losses: v('losses'), gd: v('pointDifferential') };
    };

    const [nextHome, nextAway, league] = await Promise.all([nextGames(H.id, id), nextGames(A.id, id), lg.table ? leagueData(key).catch(() => null) : null]);
    return {
      ok: true,
      league: key,
      competition: s.header?.league?.name || comp.league?.name || '',
      date: comp.date || s.header?.competitions?.[0]?.date || null,
      home: { ...H, form: formOf(H.id), scorer: clubScorer(H.id), table: row(H.id), next: nextHome },
      away: { ...A, form: formOf(A.id), scorer: clubScorer(A.id), table: row(A.id), next: nextAway },
      h2h,
      h2hSummary: series?.summary || '',
      leagueScorer,
      odds,
      sim: league,
    };
  });
}
