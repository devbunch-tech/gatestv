// Atualização automática da interface (app web) no Windows, sem reinstalar — igual ao
// android/src/.../OtaUpdater.java. O site publica manifest.json (arquivos + SHA-256) e
// manifest.sig (assinatura ECDSA); o app confere a assinatura, baixa só o que mudou para
// "ota/pending" e passa a usar a versão nova na próxima abertura ("ota/current").
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Recursos nativos desta versão do instalador. A interface publicada pede um mínimo (minNative).
const NATIVE_API = 1;

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const buildOf = (dir) => readJson(path.join(dir, 'ota.json'))?.build ?? -1;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

function dirs(userData) {
  const root = path.join(userData, 'ota');
  return { root, current: path.join(root, 'current'), pending: path.join(root, 'pending'), stage: path.join(root, 'stage'), old: path.join(root, 'old') };
}

// Aplica a versão já baixada (se houver) e diz de qual pasta servir o app.
function activeRoot(userData, embeddedDir) {
  const d = dirs(userData);
  if (buildOf(d.pending) > 0) {
    try {
      rm(d.old);
      if (fs.existsSync(d.current)) fs.renameSync(d.current, d.old);
      fs.renameSync(d.pending, d.current);
      rm(d.old);
    } catch {
      /* mantém a versão anterior */
    }
  }
  const b = buildOf(d.current);
  if (b < 0) return embeddedDir;
  // Instalador novo com interface mais nova que a baixada: usa a do instalador.
  if (b <= Math.max(0, buildOf(embeddedDir))) {
    rm(d.current);
    rm(d.pending);
    return embeddedDir;
  }
  return fs.existsSync(path.join(d.current, 'index.html')) ? d.current : embeddedDir;
}

async function download(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

let running = false;
async function check({ userData, embeddedDir, activeDir, manifestUrl, publicKey }) {
  if (running || !manifestUrl || !publicKey) return;
  running = true;
  try {
    const t = '?t=' + Date.now();
    const bytes = await download(manifestUrl + t);
    const sig = Buffer.from((await download(manifestUrl.replace(/\.json$/, '.sig') + t)).toString('utf8').trim(), 'base64');
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (!crypto.verify('sha256', bytes, key, sig)) throw new Error('assinatura inválida');
    const m = JSON.parse(bytes.toString('utf8'));
    if ((m.minNative || 1) > NATIVE_API) return; // precisa de um instalador mais novo
    const d = dirs(userData);
    if (m.build <= buildOf(activeDir) || m.build <= Math.max(0, buildOf(embeddedDir)) || buildOf(d.pending) >= m.build) return;
    const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1) + m.build + '/';
    rm(d.stage);
    for (const [rel, info] of Object.entries(m.files)) {
      if (rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) throw new Error('caminho inválido');
      const dest = path.join(d.stage, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // Arquivo igual ao que já existe (a maioria, pois os nomes têm hash): copia em vez de baixar.
      let data = null;
      for (const dir of [activeDir, embeddedDir]) {
        try {
          const b = fs.readFileSync(path.join(dir, rel));
          if (sha256(b) === info.sha256) {
            data = b;
            break;
          }
        } catch {
          /* não existe */
        }
      }
      if (!data) {
        data = await download(base + rel.split('/').map(encodeURIComponent).join('/'));
        if (sha256(data) !== info.sha256) throw new Error('arquivo diferente do publicado: ' + rel);
      }
      fs.writeFileSync(dest, data);
    }
    fs.writeFileSync(path.join(d.stage, 'ota.json'), JSON.stringify({ version: m.version, build: m.build }));
    rm(d.pending);
    fs.renameSync(d.stage, d.pending);
  } catch {
    // sem internet, site fora do ar ou arquivo corrompido: tenta de novo na próxima abertura
  } finally {
    running = false;
  }
}

module.exports = { activeRoot, check };
