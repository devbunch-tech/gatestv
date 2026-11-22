// Classificação indicativa do catálogo, pronta dentro do app (public/ratings.json).
// Baixa os filmes, séries e canais 24H da lista padrão (src/config/defaults.js), consulta o TMDB
// título a título e grava { chave do título: idade } (-1 = o TMDB não soube). É incremental: só
// consulta o que ainda não está no arquivo (e, com --retry, tenta de novo os -1).
// Uso: node scripts/build-ratings.mjs [--retry] [--limit N]
import fs from 'node:fs';
import { classifyTitle, ratingKey } from '../src/lib/titles.js';

const OUT = new URL('../public/ratings.json', import.meta.url);
const args = process.argv.slice(2);
const RETRY = args.includes('--retry');
const LIMIT = +(args[args.indexOf('--limit') + 1] || 0) || Infinity;
const CONCURRENCY = 12;

const src = fs.readFileSync(new URL('../src/config/defaults.js', import.meta.url), 'utf8');
const field = (k) => new RegExp(k + ": *'([^']+)'").exec(src)?.[1];
const [server, username, password, tmdbKey] = ['server', 'username', 'password', 'tmdbKey'].map(field);
if (!server || !tmdbKey) throw new Error('Lista padrão ou chave do TMDB não encontradas em src/config/defaults.js');

const api = `${server.replace(/\/+$/, '')}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
const xt = async (action) => {
  const r = await fetch(`${api}&action=${action}`);
  if (!r.ok) throw new Error(`Lista: HTTP ${r.status} em ${action}`);
  return r.json();
};

async function tmdb(path, params = {}) {
  const url = new URL('https://api.themoviedb.org/3' + path);
  url.searchParams.set('api_key', tmdbKey);
  url.searchParams.set('language', 'pt-BR');
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  for (let i = 0; ; i++) {
    const r = await fetch(url).catch((e) => ({ ok: false, status: 0, e }));
    if (r.ok) return r.json();
    if (r.status === 404) return {};
    if (i >= 4) throw new Error(`TMDB ${r.status} em ${path}`);
    await new Promise((s) => setTimeout(s, r.status === 429 ? 2000 * (i + 1) : 800 * (i + 1)));
  }
}

const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).r || {} : {};
const [vod, series, live, liveCats] = await Promise.all(['get_vod_streams', 'get_series', 'get_live_streams', 'get_live_categories'].map(xt));
const adultCat = new Set(liveCats.filter((c) => /adult|\+ ?18|xxx/i.test(c.category_name)).map((c) => String(c.category_id)));

// Um pedido por título (a primeira versão que aparecer, de preferência com capa do TMDB).
const todo = new Map();
const add = (type, name, year, poster) => {
  const key = ratingKey(type, name, year);
  if (!key) return;
  const cur = todo.get(key);
  if (!cur || (!/image\.tmdb\.org/.test(cur.poster || '') && /image\.tmdb\.org/.test(poster || ''))) todo.set(key, { key, type, name, year, poster });
};
for (const s of vod) add('movie', s.name, +s.year || null, s.stream_icon);
for (const s of series) add('series', s.name, +String(s.releaseDate || s.release_date || '').slice(0, 4) || null, s.cover);
for (const s of live) if (!adultCat.has(String(s.category_id))) add('live', s.name, null, '');

const out = {};
for (const k of todo.keys()) if (k in old) out[k] = old[k];
const pending = [...todo.values()].filter((t) => !(t.key in old) || (RETRY && old[t.key] === -1)).slice(0, LIMIT);
console.log(`${todo.size} títulos (${vod.length} filmes, ${series.length} séries, canais 24H); ${pending.length} para consultar no TMDB.`);

let done = 0;
let failed = 0;
const save = () => fs.writeFileSync(OUT, JSON.stringify({ v: 1, at: new Date().toISOString().slice(0, 10), r: out }));
const t0 = Date.now();
async function worker() {
  while (pending.length) {
    const t = pending.shift();
    try {
      out[t.key] = await classifyTitle(tmdb, t);
    } catch (e) {
      failed++;
      if (t.key in old) out[t.key] = old[t.key];
    }
    if (++done % 500 === 0) {
      save();
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`${done} feitos · ${rate.toFixed(1)}/s · faltam ~${Math.round(pending.length / rate / 60)} min`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
save();
const by = {};
for (const v of Object.values(out)) by[v] = (by[v] || 0) + 1;
console.log(`Pronto: ${Object.keys(out).length} títulos em public/ratings.json · por idade: ${JSON.stringify(by)}${failed ? ` · ${failed} falharam (tente de novo depois)` : ''}`);
