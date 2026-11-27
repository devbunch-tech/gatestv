// Volume dos outros apps no Windows (mixer de volume), sem módulo nativo: um PowerShell com C#
// (electron/audio-volume.ps1) fica aberto e responde pedidos JSON por stdin/stdout.
// Funciona também fora do Electron (node), para testes.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Nomes amigáveis pelo nome do processo (o resto usa a descrição do .exe ou o pacote da loja).
const NAMES = {
  msedge: 'Microsoft Edge',
  msedgewebview2: 'Microsoft Edge WebView',
  chrome: 'Google Chrome',
  firefox: 'Firefox',
  opera: 'Opera',
  opera_gx: 'Opera GX',
  brave: 'Brave',
  vivaldi: 'Vivaldi',
  iexplore: 'Internet Explorer',
  spotify: 'Spotify',
  discord: 'Discord',
  vlc: 'VLC',
  wmplayer: 'Windows Media Player',
  primevideo: 'Prime Video',
  netflix: 'Netflix',
  steam: 'Steam',
  steamwebhelper: 'Steam',
  teams: 'Microsoft Teams',
  'ms-teams': 'Microsoft Teams',
  zoom: 'Zoom',
  obs64: 'OBS Studio',
};
// Apps da Microsoft Store: nome do pacote (ex.: "AmazonVideo.PrimeVideo_1.0…__pwbj9vvecjh7j").
const PACKAGES = { 'amazonvideo.primevideo': 'Prime Video', '4df9e0f8.netflix': 'Netflix', 'spotifyab.spotifymusic': 'Spotify', 'microsoft.zunevideo': 'Filmes e TV', 'microsoft.zunemusic': 'Media Player' };

function packageName(full) {
  if (!full) return '';
  const id = full.split('_')[0];
  if (PACKAGES[id.toLowerCase()]) return PACKAGES[id.toLowerCase()];
  const last = id.split('.').pop();
  return last.replace(/([a-z])([A-Z])/g, '$1 $2'); // "PrimeVideo" → "Prime Video"
}

function friendlyName(s) {
  const proc = String(s.process || '').toLowerCase();
  if (NAMES[proc]) return NAMES[proc];
  if (s.pkg) return packageName(s.pkg);
  if (s.display && !s.display.startsWith('@')) return s.display; // "@%SystemRoot%…" = texto do sistema
  if (s.desc && proc !== 'applicationframehost') return s.desc;
  return s.process || `Processo ${s.pid}`;
}

const FRIENDLY_ERROR = 'Não deu para controlar o volume dos outros apps neste computador (o PowerShell do Windows não abriu).';

function createAudio({ scriptDir = __dirname, tmpDir = os.tmpdir(), log = () => {}, exe } = {}) {
  let proc = null;
  let ready = null; // Promise do processo pronto
  let buf = '';
  let seq = 0;
  let failures = 0;
  let lastError = '';
  const pending = new Map();

  // O .ps1 pode estar dentro do app.asar (o PowerShell não lê de lá): copia para uma pasta comum.
  function scriptFile() {
    const src = fs.readFileSync(path.join(scriptDir, 'audio-volume.ps1'), 'utf8');
    const dest = path.join(tmpDir, 'gates-audio-volume.ps1');
    let cur = null;
    try {
      cur = fs.readFileSync(dest, 'utf8');
    } catch {
      /* ainda não existe */
    }
    if (cur !== src) fs.writeFileSync(dest, src);
    return dest;
  }

  function failAll(err) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  function start() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      let file;
      try {
        file = scriptFile();
      } catch (err) {
        return reject(err);
      }
      const ps = exe || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      // ScriptBlock em vez de -File: não depende da política de execução de scripts.
      const cmd = `& ([ScriptBlock]::Create([IO.File]::ReadAllText('${file.replace(/'/g, "''")}')))`;
      let child;
      try {
        child = spawn(ps, ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', cmd], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        return reject(err);
      }
      proc = child;
      buf = '';
      let isReady = false;
      const timer = setTimeout(() => {
        reject(new Error('PowerShell demorou demais para abrir'));
        child.kill();
      }, 30000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('{')) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if ('ready' in msg) {
            clearTimeout(timer);
            if (msg.ready) {
              isReady = true;
              failures = 0;
              resolve();
            } else reject(new Error(msg.error || 'falha ao preparar o controle de volume'));
            continue;
          }
          const p = pending.get(msg.id);
          if (!p) continue;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.data);
          else p.reject(new Error(msg.error || 'erro no controle de volume'));
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (t) => log('audio-volume stderr:', t.trim()));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (proc === child) proc = null;
        ready = null; // próxima chamada tenta abrir de novo
        if (!isReady) reject(new Error(`PowerShell fechou (código ${code})`));
        failAll(new Error('o controle de volume fechou'));
      });
    }).catch((err) => {
      failures++;
      lastError = String(err?.message || err);
      log('audio-volume:', lastError);
      ready = null;
      if (proc) proc.kill();
      throw err;
    });
    return ready;
  }

  async function call(cmd, args = {}) {
    if (failures >= 3) throw new Error(FRIENDLY_ERROR); // não fica tentando abrir o PowerShell sem parar
    try {
      await start();
    } catch {
      throw new Error(FRIENDLY_ERROR);
    }
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('o controle de volume não respondeu'));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
    });
  }

  // Apps com som: [{id (PID), name, title, volume 0-1, muted, active}], sem os PIDs de exclude.
  async function list(exclude = []) {
    const skip = new Set(exclude.map(Number));
    const sessions = await call('list');
    const byPid = new Map();
    for (const s of sessions) {
      if (skip.has(s.pid)) continue;
      const cur = byPid.get(s.pid);
      // Várias sessões do mesmo processo (um por saída de som): mostra uma só.
      if (cur) {
        cur.muted = cur.muted && s.muted;
        if (s.active && !cur.active) Object.assign(cur, { volume: s.volume, active: true });
        continue;
      }
      byPid.set(s.pid, { id: s.pid, name: friendlyName(s), title: s.title || '', volume: Math.round(s.volume * 100) / 100, muted: s.muted, active: s.active, process: s.process });
    }
    return [...byPid.values()].sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, 'pt-BR'));
  }

  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} inválido`);
    return n;
  };
  async function setVolume(pid, v) {
    const n = await call('volume', { pid: num(pid, 'app'), v: Math.min(1, Math.max(0, num(v, 'volume'))) });
    if (!n) throw new Error('esse app não está mais tocando som');
    return true;
  }
  async function setMute(pid, muted) {
    const n = await call('mute', { pid: num(pid, 'app'), m: !!muted });
    if (!n) throw new Error('esse app não está mais tocando som');
    return true;
  }

  function close() {
    failAll(new Error('o controle de volume fechou'));
    if (proc) {
      try {
        proc.stdin.end(JSON.stringify({ id: 0, cmd: 'quit' }) + '\n');
      } catch {
        /* já fechou */
      }
      const p = proc;
      setTimeout(() => p.kill(), 1000).unref?.();
    }
    proc = null;
    ready = null;
  }

  const status = () => ({ ok: failures === 0, error: failures ? FRIENDLY_ERROR : '', detail: lastError });

  return { list, setVolume, setMute, close, status };
}

module.exports = { createAudio, friendlyName };
