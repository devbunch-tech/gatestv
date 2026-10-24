// Baixa os logos oficiais listados em src/config/channelLogos.js (acervo público
// github.com/tv-logo/tv-logos e, para os que faltam lá, Wikimedia Commons) para public/official-logos/, reduzidos para caber em 240x140.
// Os já baixados são mantidos. Uso: node scripts/fetch-official-logos.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import { OFFICIAL_LOGOS, officialLogoFile } from '../src/config/channelLogos.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'official-logos');
const BASE = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/';
fs.mkdirSync(outDir, { recursive: true });

// Logos pretos (sem versão para fundo escuro): ficam brancos.
const WHITE = new Set(['commons:CazéTV wordmark.svg', 'commons:Logo of Curta!.svg']);
const files = [...new Set(OFFICIAL_LOGOS.map(([, f]) => f))];
let ok = 0;
const failed = [];
for (const f of files) {
  const out = path.join(outDir, officialLogoFile(f));
  if (fs.existsSync(out)) {
    ok++;
    continue;
  }
  try {
    const url = /^commons:/.test(f) ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f.slice(8))}?width=480` : BASE + f;
    const r = await fetch(url, { headers: { 'user-agent': 'GatesTV-logos/1.0' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const img = await Jimp.read(Buffer.from(await r.arrayBuffer()));
    if (WHITE.has(f)) img.scan(0, 0, img.bitmap.width, img.bitmap.height, (x, y, i) => img.bitmap.data.fill(255, i, i + 3));
    img.autocrop({ tolerance: 0.0002, cropOnlyFrames: false });
    if (img.bitmap.width > 240 || img.bitmap.height > 140) img.scaleToFit(240, 140);
    img.deflateLevel(9);
    await img.writeAsync(out);
    ok++;
  } catch (e) {
    failed.push(`${f} (${e.message})`);
  }
}
console.log(`${ok} de ${files.length} logos oficiais em public/official-logos/`);
for (const f of failed) console.log('  falhou:', f);
