// Estatísticas de um jogo de futebol (servidor: cloud/src/match.js) e a simulação do resto do
// campeonato, feita no aparelho: cada jogo que falta é sorteado pelos gols pró/contra de cada time
// (modelo de Poisson, com vantagem de quem joga em casa) e a tabela final é contada milhares de vezes.
const BASE = (import.meta.env.VITE_LICENSE_API || 'https://gatesapptv.pages.dev').replace(/\/$/, '');
export const STATS_LEAGUES = new Set(['br', 'pl', 'lib', 'sula', 'ucl', 'uel', 'cdb', 'carioca']);

const mem = new Map();
export function fetchMatch(id) {
  const hit = mem.get(id);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.p;
  const p = fetch(`${BASE}/api/v1/match?id=${encodeURIComponent(id)}`)
    .then((r) => r.json())
    .then((j) => {
      if (!j.ok) throw new Error(j.message || 'Estatísticas indisponíveis agora.');
      return j;
    });
  mem.set(id, { at: Date.now(), p });
  p.catch(() => mem.delete(id));
  return p;
}

// Nomes das competições em português (a ESPN manda em inglês).
const COMP = [
  [/brazilian serie a|brasileir/i, 'Brasileirão'],
  [/libertadores/i, 'Libertadores'],
  [/sudamericana|sul-americana/i, 'Sul-Americana'],
  [/copa do brasil|brazil cup|copa do brazil/i, 'Copa do Brasil'],
  [/carioca/i, 'Carioca'],
  [/premier league/i, 'Premier League'],
  [/champions league/i, 'Champions League'],
  [/europa league/i, 'Europa League'],
  [/fa cup/i, 'Copa da Inglaterra'],
  [/league cup|carabao/i, 'Copa da Liga Inglesa'],
  [/club world cup/i, 'Mundial de Clubes'],
  [/friendly/i, 'Amistoso'],
];
export const compName = (s) => COMP.find(([re]) => re.test(s || ''))?.[1] || s || '';

// Sorteio de gols (Poisson; λ pequeno, método de Knuth).
function poisson(l) {
  const L = Math.exp(-l);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// Chance de cada time terminar em cada faixa da tabela: [{ label, from, to, p: { id: 0..1 } }].
export function simulateSeason(sim, ids, runs = 3000) {
  if (!sim?.teams?.length) return null;
  const teams = sim.teams;
  const n = teams.length;
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const gp = teams.reduce((s, t) => s + t.gp, 0);
  if (!gp) return null;
  const mu = teams.reduce((s, t) => s + t.gf, 0) / gp; // gols por time por jogo
  // Força com "encolhimento" para a média (poucos jogos não exageram a diferença).
  const K = 6;
  const att = teams.map((t) => (t.gf + mu * K) / (t.gp + K) / mu);
  const def = teams.map((t) => (t.ga + mu * K) / (t.gp + K) / mu);
  const fx = (sim.fixtures || []).map(([h, a]) => [idx.get(h), idx.get(a)]).filter(([h, a]) => h != null && a != null);
  const lam = fx.map(([h, a]) => [mu * att[h] * def[a] * 1.15, mu * att[a] * def[h] * 0.87]);
  const want = ids.map((id) => [String(id), idx.get(String(id))]).filter(([, i]) => i != null);
  const zones = (sim.zones || []).map((z) => ({ ...z, hits: want.map(() => 0) }));
  const pts = new Float64Array(n);
  const gd = new Float64Array(n);
  const gf = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let r = 0; r < runs; r++) {
    for (let i = 0; i < n; i++) {
      pts[i] = teams[i].pts;
      gd[i] = teams[i].gd;
      gf[i] = teams[i].gf;
    }
    for (let j = 0; j < fx.length; j++) {
      const [h, a] = fx[j];
      const gh = poisson(lam[j][0]);
      const ga = poisson(lam[j][1]);
      if (gh > ga) pts[h] += 3;
      else if (gh < ga) pts[a] += 3;
      else {
        pts[h]++;
        pts[a]++;
      }
      gd[h] += gh - ga;
      gd[a] += ga - gh;
      gf[h] += gh;
      gf[a] += ga;
    }
    order.sort((x, y) => pts[y] - pts[x] || gd[y] - gd[x] || gf[y] - gf[x] || Math.random() - 0.5);
    for (let w = 0; w < want.length; w++) {
      const pos = order.indexOf(want[w][1]) + 1;
      for (const z of zones) if (pos >= z.from && pos <= z.to) z.hits[w]++;
    }
  }
  return zones.map((z) => ({ label: z.label, from: z.from, to: z.to, p: Object.fromEntries(want.map(([id], w) => [id, z.hits[w] / runs])) }));
}

export const pct = (p) => (p == null ? '—' : p >= 0.995 && p < 1 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
