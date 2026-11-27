// Sincronizar pela IA: a IA lê o relógio do placar (ex.: 23:41) no vídeo do jogo e no vídeo da
// narração do YouTube no MESMO instante (uma foto da tela); a diferença é o ajuste da narração.
// d = narração - jogo: positivo = narração adiantada (atrasa d); negativo = atrasada (adianta).
// Fotos da tela: Windows (GatesDesktop.captureFrame = a página do app; GatesNarr.captureScreen = a tela
// inteira, no GATES Narração), Android (GatesAndroid.capture*, a tela inteira, com a autorização do
// sistema) e navegador (getDisplayMedia da própria aba). Nuvem: POST /api/v1/narr/clock.
import { SMART_TV, hasNative, isDemo, native } from './device';
import { licenseApiUrl } from '../config/license';
import { deviceId, loadSaved } from './license';
import { loadAuto, saveAuto } from './narration';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const median = (l) => {
  const s = [...l].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (l) => l.reduce((a, b) => a + b, 0) / l.length;

export const CHECK_EVERY = 3 * 60e3; // conferência periódica (modo IA)
const MAX_DIFF = 180; // diferença maior que 3 min: leitura errada
const FIX_MIN = 2; // diferença menor que 2 s: já está em sincronia (o relógio só mostra segundos inteiros)
const ONE_READ_MAX = 20; // leitura única (conferência) com mais que isso: desconfia e lê de novo com 3 fotos

// ---------- Preferência: Sincronia "IA pelo relógio" / "automática" (anti-deriva) / "manual" ----------
const MODE_KEY = 'gates:narr:sync';
export const SYNC_MODES = [
  { id: 'ai', label: 'IA pelo relógio', hint: 'A IA lê o relógio do placar no jogo e na narração e acerta o atraso' },
  { id: 'auto', label: 'Automática', hint: 'Se o jogo ou a narração travar, o atraso é corrigido sozinho' },
  { id: 'manual', label: 'Manual', hint: 'Só os botões de atrasar/adiantar e o “Sincronizar pelo lance”' },
];
// Sem escolha salva: na TV com a IA disponível, a IA; senão, a automática (ou a manual, se ela foi desligada).
export function loadSyncMode(aiOk, tv) {
  let m = null;
  try {
    m = localStorage.getItem(MODE_KEY);
  } catch {
    /* sem armazenamento */
  }
  if (m === 'ai' && aiOk) return 'ai';
  if (m === 'auto' || m === 'manual') return m;
  if (!m && aiOk && tv) return 'ai';
  return loadAuto() ? 'auto' : 'manual';
}
export function saveSyncMode(m) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* armazenamento cheio */
  }
  if (m !== 'ai') saveAuto(m === 'auto');
}

// ---------- Captura da tela ----------
// 'desktop' (app principal no Windows), 'screen' (GATES Narração no Windows), 'android', 'browser' ou null.
export function captureKind() {
  if (typeof window === 'undefined' || SMART_TV) return null;
  if (window.GatesNarr) return typeof window.GatesNarr.captureScreen === 'function' ? 'screen' : null;
  if (window.GatesAndroid) {
    // GATES Narração no Android: a janela flutuante fica sobre apps com DRM (sai preto) — sem IA.
    if (hasNative('narrOpenApp')) return null;
    try {
      return hasNative('captureAvailable') && native('captureAvailable') ? 'android' : null;
    } catch {
      return null;
    }
  }
  if (window.GatesDesktop) return typeof window.GatesDesktop.captureFrame === 'function' ? 'desktop' : null; // app antigo: sem
  return navigator.mediaDevices?.getDisplayMedia ? 'browser' : null;
}
let aiOff = false; // a nuvem respondeu 'ai_off': esconde o recurso até reabrir o app
export const aiSupported = () => !aiOff && !isDemo && !!loadSaved()?.token && !!captureKind();

const fail = (code, message) => Object.assign(new Error(message || code), { code });

// Android: autorização do sistema (captureStart), resposta no evento 'gates-capture' {ok, error}.
const capEvent = (fn) => {
  const h = (e) => {
    let d = e.detail;
    if (typeof d === 'string') {
      try {
        d = JSON.parse(d);
      } catch {
        d = { ok: false, error: d };
      }
    }
    fn(d || {});
  };
  window.addEventListener('gates-capture', h);
  return () => window.removeEventListener('gates-capture', h);
};
function androidStart() {
  return new Promise((resolve) => {
    let off = () => {};
    const t = setTimeout(() => (off(), resolve(false)), 120e3);
    off = capEvent((d) => {
      if (d.error === 'stopped') return; // aviso de uma captura anterior
      clearTimeout(t);
      off();
      resolve(!!d.ok);
    });
    native('captureStart');
  });
}

// Navegador: a pessoa escolhe compartilhar esta aba; o vídeo fica aberto até a narração parar.
let tab = null; // { stream, video }
async function browserStart() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser', frameRate: 5 },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  });
  const track = stream.getVideoTracks()[0];
  const surface = track?.getSettings?.().displaySurface;
  if (!track || (surface && surface !== 'browser')) {
    stream.getTracks().forEach((t) => t.stop());
    throw fail('tab', 'Para a IA ler o relógio, compartilhe esta aba do navegador.');
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  for (let i = 0; i < 30 && !video.videoWidth; i++) await sleep(100);
  tab = { stream, video };
  track.addEventListener('ended', () => {
    if (tab?.stream === stream) tab = null;
  });
  return true;
}

// Garante a captura. ask = pode pedir a autorização (na hora de um toque, no navegador). false = negada.
export async function ensureCapture({ ask = true } = {}) {
  const k = captureKind();
  if (k === 'desktop' || k === 'screen') return true;
  if (k === 'android') {
    if (native('captureActive')) return true;
    return ask ? androidStart() : false;
  }
  if (k === 'browser') {
    if (tab?.stream.active) return true;
    if (!ask) return false;
    try {
      return await browserStart();
    } catch (e) {
      if (e.code) throw e;
      return false; // a pessoa cancelou
    }
  }
  return false;
}
export const captureActive = () => {
  const k = captureKind();
  if (k === 'android') return !!native('captureActive');
  if (k === 'browser') return !!tab?.stream.active;
  return !!k;
};
// Narração desligada: solta a captura (Android: some o aviso de gravação da tela).
export function releaseCapture() {
  try {
    if (captureKind() === 'android' && native('captureActive')) native('captureStop');
  } catch {
    /* app antigo */
  }
  tab?.stream.getTracks().forEach((t) => t.stop());
  tab = null;
}

const loadImg = (b64) =>
  new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(fail('capture'));
    img.src = 'data:image/jpeg;base64,' + b64;
  });

// ---------- Posições: página (CSS px) -> pixels da foto ----------
// Android: a foto é a tela inteira; a WebView começa em (webX, webY) px físicos da tela e cada px CSS
// vale 'dpr' px físicos (escala real da WebView; o devicePixelRatio pode não bater). Sem 'dpr': webW/innerWidth.
export function androidMap(info, innerW, innerH) {
  const sx = (info.dpr > 0 ? info.dpr : info.webW / innerW) * (info.w / info.screenW);
  const sy = (info.dpr > 0 ? info.dpr : info.webH / innerH) * (info.h / info.screenH);
  const ox = (info.webX * info.w) / info.screenW;
  const oy = (info.webY * info.h) / info.screenH;
  return (r) => ({ x: ox + r.x * sx, y: oy + r.y * sy, w: r.width * sx, h: r.height * sy });
}
// Página inteira na foto (app principal no Windows e navegador), ou a área 'page' dela (GATES Narração).
export function pageMap(page, innerW, innerH) {
  const sx = page.w / innerW;
  const sy = page.h / innerH;
  return (r) => ({ x: page.x + r.x * sx, y: page.y + r.y * sy, w: r.width * sx, h: r.height * sy });
}
// Área do vídeo dentro do <video> (object-fit: contain deixa faixas pretas).
export function videoBox(v) {
  const r = v.getBoundingClientRect();
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh || !r.width || !r.height) return r;
  const s = Math.min(r.width / vw, r.height / vh);
  const width = vw * s;
  const height = vh * s;
  return { x: r.left + (r.width - width) / 2, y: r.top + (r.height - height) / 2, width, height };
}

// Uma foto: { src (desenhável), w, h, map (CSS -> px), mask: retângulos em px da nossa janela }.
async function grab() {
  const k = captureKind();
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  if (k === 'desktop') {
    const r = await window.GatesDesktop.captureFrame({ maxW: 1920 });
    if (!r?.image) throw fail('capture');
    return { src: await loadImg(r.image), w: r.w, h: r.h, map: pageMap({ x: 0, y: 0, w: r.w, h: r.h }, iw, ih), mask: [] };
  }
  if (k === 'screen') {
    const r = await window.GatesNarr.captureScreen({ maxW: 1920 });
    if (!r?.image || !r.page) throw fail('capture');
    return { src: await loadImg(r.image), w: r.w, h: r.h, map: pageMap(r.page, iw, ih), mask: r.win ? [r.win] : [] };
  }
  if (k === 'android') {
    let b64 = '';
    for (let i = 0; i < 4 && !b64; i++) {
      if (i) await sleep(300);
      b64 = native('captureFrame', window.__gatesCapKey) || ''; // chave: só o quadro principal (não o iframe do YouTube)
    }
    if (!b64) throw fail('capture');
    let info = {};
    try {
      info = JSON.parse(native('captureFrameInfo') || '{}') || {};
    } catch {
      /* sem a posição: supõe a WebView em tela cheia */
    }
    const src = await loadImg(b64);
    const w = info.w || src.naturalWidth;
    const h = info.h || src.naturalHeight;
    const full = { w, h, dpr: Number(info.dpr) || 0, screenW: info.screenW || w, screenH: info.screenH || h, webX: info.webX || 0, webY: info.webY || 0, webW: info.webW || info.screenW || w, webH: info.webH || info.screenH || h };
    return { src, w, h, map: androidMap(full, iw, ih), mask: [] };
  }
  if (k === 'browser' && tab?.video.videoWidth) {
    // Congela o quadro (os dois recortes saem da mesma imagem).
    const v = tab.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return { src: c, w: c.width, h: c.height, map: pageMap({ x: 0, y: 0, w: c.width, h: c.height }, iw, ih), mask: [] };
  }
  throw fail('capture');
}

// Recorte em JPEG base64 (sem prefixo), com os retângulos 'masks' pintados de preto. Cabe no limite da
// nuvem (~350 KB): tenta qualidades menores. A IA precisa de ~960 px de largura (com 640 px acerta
// metade): recortes pequenos são ampliados até 960 px.
const LIMIT = 340000;
const MIN_W = 960;
export function cropJpeg(src, fw, fh, r, masks = [], maxW = 1024) {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const w = Math.min(fw, Math.ceil(r.x + r.w)) - x;
  const h = Math.min(fh, Math.ceil(r.y + r.h)) - y;
  if (w < 24 || h < 24) return '';
  let out = '';
  for (const [max, q] of [
    [maxW, 0.8],
    [MIN_W, 0.72],
    [MIN_W, 0.6],
  ]) {
    const s = w > max ? max / w : w < MIN_W ? Math.min(4, MIN_W / w) : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    g.fillStyle = '#000';
    for (const m of masks) g.fillRect((m.x - x) * s, (m.y - y) * s, m.w * s, m.h * s);
    out = c.toDataURL('image/jpeg', q).split(',')[1] || '';
    if (out.length <= LIMIT) break;
  }
  return out;
}

// A foto e os dois recortes. targets(): { game: retângulo CSS | 'all' (a tela inteira, no GATES
// Narração), narr: retângulo CSS do player do YouTube, gameMask/narrMask: o que fica por cima (CSS) }.
async function shoot(targets) {
  const t = targets();
  if (!t?.narr) throw fail('capture');
  const f = await grab();
  const masks = (l) => (l || []).filter(Boolean).map(f.map);
  let game;
  if (t.game === 'all') {
    // A nossa janela cobre quase a tela toda: o jogo não aparece na foto.
    const area = f.mask.reduce((a, m) => a + Math.max(0, Math.min(m.x + m.w, f.w) - Math.max(m.x, 0)) * Math.max(0, Math.min(m.y + m.h, f.h) - Math.max(m.y, 0)), 0);
    if (area > 0.85 * f.w * f.h) throw fail('covered');
    game = cropJpeg(f.src, f.w, f.h, { x: 0, y: 0, w: f.w, h: f.h }, [...f.mask, ...masks(t.gameMask)], 1024);
  } else game = cropJpeg(f.src, f.w, f.h, f.map(t.game), masks(t.gameMask));
  const narr = cropJpeg(f.src, f.w, f.h, f.map(t.narr), masks(t.narrMask));
  if (!game || !narr) throw fail('capture');
  return { game, narr };
}

// Pergunta à nuvem: { game: {clock, seconds, half, confidence}, narr: {...} }.
async function askClocks(game, narr) {
  let res, j;
  try {
    res = await fetch(licenseApiUrl() + '/api/v1/narr/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: loadSaved()?.token, deviceId: deviceId(), game, narr }),
    });
    j = await res.json().catch(() => ({}));
  } catch {
    throw fail('net', 'Sem conexão com a IA agora. Tente de novo.');
  }
  if (j.error === 'ai_off') aiOff = true;
  if (!res.ok || !j.ok) throw fail(j.error || 'server', j.message || 'A IA não conseguiu ler o relógio agora. Tente de novo.');
  return j;
}

// ---------- Leituras (lógica pura, testável) ----------
// Tempo desde o início do jogo ('elapsed' da nuvem: as transmissões zeram o relógio no 2º tempo e
// muitos narradores não); sem ele, o relógio como aparece.
const secs = (c) => (c && Number.isFinite(c.elapsed) ? c.elapsed : c && Number.isFinite(c.seconds) ? c.seconds : null);
// Uma foto -> { d, gs, ns } (válida) ou { fail: 'game' | 'narr' | 'both' | 'half' | 'far' }.
export function frameDiff(j) {
  const gs = secs(j?.game);
  const ns = secs(j?.narr);
  if (gs == null && ns == null) return { fail: 'both' };
  if (gs == null) return { fail: 'game' };
  if (ns == null) return { fail: 'narr' };
  const gh = j.game.half;
  const nh = j.narr.half;
  if (gh && nh && gh !== nh && !(Number.isFinite(j.game.elapsed) && Number.isFinite(j.narr.elapsed))) return { fail: 'half' };
  const d = ns - gs;
  if (Math.abs(d) > MAX_DIFF) return { fail: 'far' };
  return { d, gs, ns };
}
// Junta as leituras. need = quantas válidas que concordam (até 2 s) são exigidas. running: confere que
// o relógio do jogo andou entre as fotos (parado = intervalo ou placar sem os segundos).
// -> { d (arredondado), n } ou { error }.
export function pickDelta(reads, { need = 2, running = need > 1 } = {}) {
  const ok = reads.filter((r) => r.d != null);
  if (ok.length >= need && ok.length) {
    const m = median(ok.map((r) => r.d));
    const agree = ok.filter((r) => Math.abs(r.d - m) <= 2);
    if (agree.length < Math.min(need, 2) && ok.length > 1) return { error: 'mismatch' };
    if (running && agree.length > 1 && new Set(agree.map((r) => r.gs)).size < 2) return { error: 'stopped' };
    // Média das que concordam: o relógio só mostra segundos inteiros, a média chega mais perto.
    return { d: Math.round(mean(agree.map((r) => r.d))), n: agree.length };
  }
  const total = reads.length;
  if (!total) return { error: 'capture' };
  const g = reads.filter((r) => r.fail === 'game' || r.fail === 'both').length;
  const n = reads.filter((r) => r.fail === 'narr' || r.fail === 'both').length;
  if (g && n && g * 2 >= total && n * 2 >= total) return { error: 'both' };
  if (n && n >= g) return { error: 'narr' };
  if (g) return { error: 'game' };
  return { error: 'mismatch' };
}

const LANCE = 'Use “Sincronizar pelo lance”.';
export function aiMessage(code, kind = captureKind()) {
  switch (code) {
    case 'narr':
      return `A IA não encontrou o relógio no vídeo da narração — este narrador não mostra o tempo. ${LANCE}`;
    case 'game':
      return kind === 'screen'
        ? `A IA não encontrou o relógio no vídeo do jogo. Deixe o jogo aparecendo na mesma tela da janelinha; vídeo protegido (Prime Video, Globoplay) sai preto na captura. ${LANCE}`
        : `A IA não encontrou o relógio no vídeo do jogo — confira se o placar está aparecendo. ${LANCE}`;
    case 'both':
      return `A IA não encontrou o relógio do placar no jogo nem na narração. ${LANCE}`;
    case 'stopped':
      return 'O relógio do placar está parado (intervalo, bola parada) ou não mostra os segundos. Tente de novo com a bola rolando.';
    case 'mismatch':
      return 'A IA leu tempos que não batem entre o jogo e a narração. Tente de novo daqui a pouco ou use “Sincronizar pelo lance”.';
    case 'covered':
      return 'A janela do GATES Narração está cobrindo o jogo. Abra a janelinha (Ctrl+Alt+M) por cima do jogo e tente de novo.';
    case 'capture':
      return 'Não foi possível capturar a tela agora. Tente de novo.';
    case 'denied':
      return 'Para sincronizar pela IA, permita a captura da tela.';
    default:
      return 'A IA não conseguiu ler o relógio agora. Tente de novo.';
  }
}

// 'frames' fotos com ~1,5 s entre elas (cada uma vai para a IA assim que é tirada). cover(on): mostra
// a janelinha e tira da frente do jogo o que cobre os vídeos durante as fotos.
async function readOffset({ frames, targets, cover }) {
  const jobs = [];
  let capErr = null;
  cover?.(true);
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))));
    for (let i = 0; i < frames; i++) {
      if (i) await sleep(1500);
      try {
        const s = await shoot(targets);
        jobs.push(askClocks(s.game, s.narr).then(frameDiff, (e) => ({ err: e })));
      } catch (e) {
        capErr = capErr || e;
        if (e.code === 'covered') break;
      }
    }
  } finally {
    cover?.(false);
  }
  const reads = await Promise.all(jobs);
  const good = reads.filter((r) => !r.err);
  if (!good.length) throw reads[0]?.err || capErr || fail('capture');
  return pickDelta(good, { need: frames > 1 ? 2 : 1 });
}

const aheadText = (d) => `narração estava ${Math.abs(d)} s ${d > 0 ? 'adiantada' : 'atrasada'}`;

// Sincroniza pela IA: 3 fotos -> ajuste -> conferência (1 foto ~4 s depois; corrige de novo se ainda
// sobrar 2 s ou mais, no máximo 2 rodadas). check = conferência periódica (1 foto; quieta se ok).
// apply(d, why) aplica o ajuste (d > 0 atrasa a narração) e devolve false se não deu; settle() = ms até
// o ajuste assentar; ready() = '' ou o motivo para não ler agora. -> { ok, d } | { error, message }.
export async function aiSync({ targets, cover, apply, settle = () => 0, ready = () => '', notify, check = false, alive = () => true }) {
  const read = (frames) => readOffset({ frames, targets, cover });
  let r;
  try {
    r = await read(check ? 1 : 3);
    // Conferência com diferença grande: pode ser leitura errada; confirma com 3 fotos.
    if (check && r.d != null && Math.abs(r.d) > ONE_READ_MAX && alive() && !ready()) r = await read(3);
  } catch (e) {
    // Falha na foto: mensagem daqui; erro da nuvem (ou sem internet): a mensagem que veio com ele.
    return { error: e.code || 'server', message: ['capture', 'covered'].includes(e.code) ? aiMessage(e.code) : e.message || aiMessage() };
  }
  if (r.error) return { error: r.error, message: aiMessage(r.error) };
  if (!alive()) return { error: 'gone' };
  if (Math.abs(r.d) < FIX_MIN) {
    if (!check) notify?.('Sincronizado pela IA: a narração já está em sincronia com o jogo.');
    return { ok: true, d: 0 };
  }
  if (apply(r.d, `${check ? 'Sincronia conferida pela IA' : 'Sincronizado pela IA'}: ${aheadText(r.d)}. `) === false) return { ok: true, d: r.d };
  let total = r.d;
  for (let round = 0; round < 2; round++) {
    await sleep(Math.max(4000, settle() + 1500));
    if (!alive() || ready()) break;
    let c;
    try {
      c = await read(1);
    } catch {
      break;
    }
    if (c.error || Math.abs(c.d) < FIX_MIN || Math.abs(c.d) > ONE_READ_MAX || !alive()) break;
    if (apply(c.d, `Conferido pela IA: mais ${Math.abs(c.d)} s de ajuste. `) === false) break;
    total += c.d;
  }
  return { ok: true, d: total };
}
