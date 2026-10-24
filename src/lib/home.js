// Seções da tela inicial: adicionados recentemente (sem duplicar) e próximos jogos ao vivo (EPG).
import { cleanTitle, normTitle } from './meta';
import { gamePriority } from './sports';

const addedAt = (it) => it.added || it.firstSeen || 0;

const prepGroup = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Itens de uma plataforma (pela categoria da fonte, em qualquer das versões do título).
export function providerItems(items, provider) {
  return items.filter((it) => (it.groups || [it.group]).some((g) => provider.test(prepGroup(g))));
}

// Listas IPTV costumam repetir o mesmo título (dublado, legendado, 4K…): agrupa pelo título limpo.
export function recentUnique(items, limit = 10) {
  const sorted = items
    .map((it, i) => ({ it, i, t: addedAt(it) }))
    .sort((a, b) => b.t - a.t || b.i - a.i)
    .map((x) => x.it);
  const seen = new Set();
  const out = [];
  for (const it of sorted) {
    const { title, year } = cleanTitle(it.type === 'series' ? it.series?.name || it.name : it.name);
    const key = normTitle(title) + '|' + (year || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

const MATCH = /\S\s+(?:x|vs\.?|v\.?|×|versus)\s+\S/i;
const SPORT =
  /esporte|sport|futebol|soccer|football|basquete|basketball|\bnba\b|\bnfl\b|\bnhl\b|\bmlb\b|t[eê]nis|tennis|v[oô]lei|volley|handebol|futsal|rugby|h[oó]quei|hockey|beisebol|baseball|\bufc\b|\bmma\b|boxe|copa|liga|campeonato|brasileir|libertadores|sul-americana|champions|premier league|la ?liga|serie a|bundesliga|paulist|carioca|mineiro|ga[uú]cho|estadual|eliminat[oó]rias|amistoso|rodada/i;
const SPORT_CHANNEL = /espn|sportv|premiere|sports?|dazn|combate|esporte|band ?sports|tnt|fox ?sports|bein|eleven|futebol|\bnba\b|\bnfl\b|\bufc\b|cazé|caze|goat/i;
const NOT_LIVE_GAME = /reprise|\bvt\b|melhores momentos|compacto|replay|highlights|resumo|gols da|debate|mesa redonda|resenha|pr[ée]-jogo|p[óo]s-jogo|bate-bola|bastidores|document[aá]rio|entrevista/i;

export function isGame(p, channel) {
  if (!MATCH.test(p.title) || NOT_LIVE_GAME.test(p.title)) return false;
  return SPORT.test(`${p.category} ${p.title} ${p.desc}`) || SPORT_CHANNEL.test(`${channel.name} ${channel.group}`);
}

// Próximos jogos (inclui os que estão em andamento), sem repetir o mesmo jogo em vários canais.
export function upcomingGames(live, programmesFor, now = Date.now(), { limit = 10, hours = 48 } = {}) {
  const until = now + hours * 3600e3;
  const games = new Map();
  for (const ch of live) {
    const progs = programmesFor(ch);
    if (!progs) continue;
    for (const p of progs) {
      if (p.stop <= now) continue;
      if (p.start > until) break;
      if (!isGame(p, ch)) continue;
      const key = normTitle(p.title.replace(/^[^:]{2,40}:\s*/, '')) + '|' + Math.round(p.start / 600e3);
      const g = games.get(key);
      if (g) g.channels.push(ch);
      else games.set(key, { key, prog: p, channels: [ch], priority: gamePriority(p.title, p.category) });
    }
  }
  // Ao vivo primeiro; depois Vasco / Premier League / Brasileirão; depois por horário.
  const onAir = (g) => (g.prog.start <= now ? 1 : 0);
  return [...games.values()]
    .sort((a, b) => onAir(b) - onAir(a) || b.priority - a.priority || a.prog.start - b.prog.start)
    .slice(0, limit);
}

// "Brasileirão: Flamengo x Palmeiras" -> { competition: "Brasileirão", home: "Flamengo", away: "Palmeiras" }
export function splitGame(title) {
  let competition = '';
  let rest = title;
  const c = /^([^:|]{2,50})[:|]\s*(.+)$/.exec(title);
  if (c && MATCH.test(c[2])) {
    competition = c[1].trim();
    rest = c[2];
  }
  const m = /^(.+?)\s+(?:x|vs\.?|v\.?|×|versus)\s+(.+?)(?:\s+[-–(].*)?$/i.exec(rest);
  return m ? { competition, home: m[1].trim(), away: m[2].trim() } : { competition, home: rest, away: '' };
}
