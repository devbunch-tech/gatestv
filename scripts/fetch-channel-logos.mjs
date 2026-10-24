// Baixa os logos dos canais da troca rápida (src/config/zapping.js) da fonte Xtream padrão
// (src/config/defaults.js) para public/channel-logos/, reduzidos para 160 px. O app usa esses
// arquivos locais no lugar dos logos remotos (aparecem na hora e funcionam sem internet).
// Uso: node scripts/fetch-channel-logos.mjs   (já roda nos builds do APK e do EXE)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import { DEFAULT_SOURCES } from '../src/config/defaults.js';
import { baseName, zapGroups } from '../src/lib/zapping.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'channel-logos');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const src = DEFAULT_SOURCES.find((s) => s.type === 'xtream');
if (!src) {
  console.log('Nenhuma fonte Xtream em src/config/defaults.js — nada a baixar.');
  process.exit(0);
}
const api = async (action) => {
  const u = `${src.server.replace(/\/+$/, '')}/player_api.php?${new URLSearchParams({ username: src.username, password: src.password, action })}`;
  const r = await fetch(u, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${action}`);
  return r.json();
};

const [cats, streams] = await Promise.all([api('get_live_categories'), api('get_live_streams')]);
const catName = new Map(cats.map((c) => [String(c.category_id), c.category_name]));
const live = streams.map((s) => ({ id: String(s.stream_id), name: s.name, group: catName.get(String(s.category_id)) || '', logo: s.stream_icon || '' }));
const groups = zapGroups(live);
const wanted = groups.flatMap((g) => g.candidates).filter((c) => c.logo);
const bySection = {};
for (const g of groups) (bySection[g.section] ||= []).push(g.candidates[0].name);
for (const [s, l] of Object.entries(bySection)) console.log(`  ${s} (${l.length}): ${l.join(', ')}`);
console.log(`${live.length} canais na fonte · ${groups.length} na troca rápida · ${wanted.length} versões com logo`);

// Mantém os logos já baixados (servidores de imagem de listas IPTV costumam oscilar).
fs.mkdirSync(outDir, { recursive: true });
const byUrl = new Map(); // mesma imagem para várias versões: baixa uma vez
const manifest = {}; // stream_id -> arquivo
let ok = 0;
let fail = 0;
for (const c of wanted) {
  if (!byUrl.has(c.logo)) {
    const file = crypto.createHash('sha1').update(c.logo).digest('hex').slice(0, 16) + '.png';
    if (fs.existsSync(path.join(outDir, file))) {
      byUrl.set(c.logo, file);
      ok++;
    } else try {
      const r = await fetch(c.logo, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const img = await Jimp.read(Buffer.from(await r.arrayBuffer()));
      if (img.bitmap.width > 160 || img.bitmap.height > 160) img.scaleToFit(160, 160);
      img.deflateLevel(9);
      await img.writeAsync(path.join(outDir, file));
      byUrl.set(c.logo, file);
      ok++;
    } catch (e) {
      byUrl.set(c.logo, null);
      fail++;
      console.log(`  sem logo: ${c.name} (${e.message})`);
    }
  }
  const f = byUrl.get(c.logo);
  if (f) manifest[c.id] = f;
}
// Logo quebrado no provedor: usa o de outra versão do mesmo canal (HD/FHD/SD…).
let borrowed = 0;
for (const g of groups) {
  const any = g.candidates.map((c) => manifest[c.id]).find(Boolean);
  if (!any) continue;
  for (const c of g.candidates)
    if (!manifest[c.id]) {
      manifest[c.id] = any;
      borrowed++;
    }
}
console.log(`${borrowed} versões sem logo próprio passaram a usar o logo de outra versão do mesmo canal`);

// Nenhuma versão com logo: tenta o logo de outra emissora da mesma rede na fonte
// (ex.: "Globo Rio" sem logo -> logo de outra Globo regional).
const download = async (url) => {
  const file = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.png';
  if (byUrl.has(url)) return byUrl.get(url);
  if (fs.existsSync(path.join(outDir, file))) {
    byUrl.set(url, file);
    return file;
  }
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error();
    const img = await Jimp.read(Buffer.from(await r.arrayBuffer()));
    if (img.bitmap.width > 160 || img.bitmap.height > 160) img.scaleToFit(160, 160);
    img.deflateLevel(9);
    await img.writeAsync(path.join(outDir, file));
    byUrl.set(url, file);
    return file;
  } catch {
    byUrl.set(url, null);
    return null;
  }
};
// Último recurso: ícone oficial do site da emissora.
const SITE_LOGO = { globo: 'globo.com', nsc: 'nsctotal.com.br', record: 'record.r7.com', sbt: 'sbt.com.br', redetv: 'redetv.uol.com.br', band: 'band.uol.com.br' };
for (const g of groups) {
  if (g.candidates.some((c) => manifest[c.id])) continue;
  const brand = g.key.split(' ')[0];
  const site = SITE_LOGO[brand] || (/\bnsc\b/.test(g.key) ? SITE_LOGO.nsc : null);
  if (!site) continue;
  const f = await download(`https://www.google.com/s2/favicons?domain=${site}&sz=128`);
  if (!f) continue;
  for (const v of g.candidates) manifest[v.id] = f;
  console.log(`  ${g.candidates[0].name}: usando o ícone oficial de ${site}`);
}
for (const g of groups) {
  if (g.candidates.some((c) => manifest[c.id])) continue;
  const brand = g.key.split(' ')[0];
  if (brand.length < 3) continue;
  const sameBrand = live.filter((c) => c.logo && baseName(c.name).split(' ')[0] === brand && !/news/i.test(c.name)).slice(0, 60);
  for (const c of sameBrand) {
    const f = await download(c.logo);
    if (!f) continue;
    for (const v of g.candidates) manifest[v.id] = f;
    console.log(`  ${g.candidates[0].name}: usando o logo de “${c.name}”`);
    break;
  }
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(manifest));
const size = fs.readdirSync(outDir).reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
console.log(`Logos salvos: ${ok} · falharam: ${fail} · ${Object.keys(manifest).length} canais mapeados · ${(size / 1048576).toFixed(1)} MB`);
