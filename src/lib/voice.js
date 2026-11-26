// Busca por voz. Android: reconhecedor do sistema (GatesAndroid.voiceSearch; o texto volta no evento
// 'gates-voice', também usado pela tecla de busca/microfone do controle). Navegador: Web Speech API.
// Windows (e navegadores sem ela): grava o microfone e a nuvem transcreve (rota /api/v1/voice, Whisper
// da Cloudflare). Smart TVs Samsung/LG: sem botão (o controle já digita por voz no campo).
import { SMART_TV, hasNative, isDemo, native } from './device';
import { licenseApiUrl } from '../config/license';
import { deviceId, loadSaved } from './license';

const EVENT = 'gates-voice';
const emit = (detail) => window.dispatchEvent(new CustomEvent(EVENT, { detail }));

// Resultado da voz ({ text } ou { error }), venha de onde vier.
const subs = new Set();
export function onVoice(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// Alvo do ditado (ex.: campo do comentário): enquanto definido, só ele recebe o resultado da voz —
// inclusive o do Android, que chega pelo evento global — e a busca da TopBar não é disparada.
// Devolve a função que tira o alvo.
let target = null;
export function setVoiceTarget(fn) {
  target = fn;
  return () => {
    if (target === fn) target = null;
  };
}

// Um só ouvinte do evento decide para quem vai: o alvo, se houver; senão, quem chamou onVoice.
function deliver(e) {
  const d = e.detail || {};
  if (target) return target(d);
  subs.forEach((fn) => fn(d));
}
if (typeof window !== 'undefined') {
  if (window.__gatesVoice) window.removeEventListener(EVENT, window.__gatesVoice);
  window.__gatesVoice = deliver;
  window.addEventListener(EVENT, deliver);
}

const Speech = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

// A nuvem transcreve? (503 = sem a ligação de IA na Cloudflare: o microfone fica escondido.)
let cloudOk = null;
function cloudReady() {
  if (!loadSaved()?.token || !canRecord()) return Promise.resolve(false);
  if (!cloudOk)
    cloudOk = fetch(licenseApiUrl() + '/api/v1/voice').then(
      (r) => r.ok,
      () => {
        cloudOk = null; // sem internet: tenta de novo na próxima vez
        return false;
      }
    );
  return cloudOk;
}

// 'android' | 'web' | 'cloud' | null (sem microfone).
export async function voiceMode() {
  if (SMART_TV || isDemo || typeof window === 'undefined') return null;
  // Android: só o reconhecedor do sistema (APK antigo ou aparelho sem reconhecedor: sem botão).
  if (window.GatesAndroid) return hasNative('voiceAvailable') && native('voiceAvailable') ? 'android' : null;
  // No Windows (Electron) a Web Speech API existe, mas não funciona.
  if (Speech && !window.GatesDesktop) return 'web';
  return (await cloudReady()) ? 'cloud' : null;
}

// Começa a ouvir. onState('listening' | 'working' | null). Devolve a função que cancela.
export function startVoice(mode, onState) {
  if (mode === 'android') {
    native('voiceSearch');
    return () => {};
  }
  if (mode === 'web') return listenWeb(onState);
  if (mode === 'cloud') return listenCloud(onState);
  return () => {};
}

const MIC_DENIED = 'Permita o uso do microfone para buscar por voz.';
const NOT_HEARD = 'Não ouvi nada. Fale perto do microfone e tente de novo.';

function listenWeb(onState) {
  const r = new Speech();
  r.lang = 'pt-BR';
  r.interimResults = false;
  r.maxAlternatives = 1;
  let text = '';
  let error = '';
  let cancelled = false;
  r.onresult = (e) => {
    text = e.results?.[0]?.[0]?.transcript || '';
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') error = MIC_DENIED;
    else if (e.error === 'network') error = 'Sem conexão para reconhecer a voz. Tente de novo.';
  };
  r.onend = () => {
    onState(null);
    if (!cancelled) emit(text ? { text } : { error: error || NOT_HEARD });
  };
  try {
    r.start();
    onState('listening');
  } catch {
    onState(null);
  }
  return () => {
    cancelled = true;
    r.abort();
  };
}

// Grava até 6 s e para sozinho ~1,2 s depois que a pessoa para de falar.
function listenCloud(onState) {
  let cancelled = false;
  let done = false;
  let heard = false;
  let stream, rec, ctx, poll;
  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(poll);
    ctx?.close().catch(() => {});
    if (rec?.state === 'recording') rec.stop();
    else stream?.getTracks().forEach((t) => t.stop());
  };
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      onState(null);
      if (!cancelled) emit({ error: MIC_DENIED });
      return;
    }
    if (cancelled) return stream.getTracks().forEach((t) => t.stop());
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled) return onState(null);
      // Silêncio: nem envia (o Whisper inventa frases quando não há fala).
      if (!heard) {
        onState(null);
        return emit({ error: NOT_HEARD });
      }
      onState('working');
      try {
        emit({ text: await transcribe(new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' })) });
      } catch (e) {
        emit({ error: e.message });
      }
      onState(null);
    };
    rec.start();
    onState('listening');
    // Volume do microfone: detecta a fala e o silêncio depois dela.
    const t0 = Date.now();
    let last = t0;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      poll = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        const now = Date.now();
        if (peak > 12) {
          heard = true;
          last = now;
        }
        if ((heard && now - last > 1200) || (!heard && now - t0 > 4000) || now - t0 > 6000) finish();
      }, 100);
    } catch {
      // Sem análise de volume: grava 5 s e envia.
      heard = true;
      poll = setInterval(() => Date.now() - t0 > 5000 && finish(), 200);
    }
  })();
  return () => {
    cancelled = true;
    finish();
    onState(null);
  };
}

// O Whisper da nuvem lê WAV com certeza; o webm/opus do MediaRecorder nem sempre. Converte para
// WAV 16 kHz mono (6 s ≈ 190 KB). Se o aparelho não conseguir decodificar, manda o original.
async function toWav(blob) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const src = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close?.();
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(src.duration * rate), rate);
    const node = off.createBufferSource();
    node.buffer = src;
    node.connect(off.destination);
    node.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const buf = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    buf.setUint32(4, 36 + pcm.length * 2, true);
    str(8, 'WAVEfmt ');
    buf.setUint32(16, 16, true);
    buf.setUint16(20, 1, true); // PCM
    buf.setUint16(22, 1, true); // mono
    buf.setUint32(24, rate, true);
    buf.setUint32(28, rate * 2, true);
    buf.setUint16(32, 2, true);
    buf.setUint16(34, 16, true);
    str(36, 'data');
    buf.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new Blob([buf], { type: 'audio/wav' });
  } catch {
    return blob;
  }
}

async function transcribe(recorded) {
  const blob = await toWav(recorded);
  const audio = await new Promise((ok, fail) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1] || '');
    fr.onerror = fail;
    fr.readAsDataURL(blob);
  });
  let res, j;
  try {
    res = await fetch(licenseApiUrl() + '/api/v1/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: loadSaved()?.token, deviceId: deviceId(), audio, type: blob.type }),
    });
    j = await res.json().catch(() => ({}));
  } catch {
    throw new Error('Sem conexão para reconhecer a voz. Tente de novo.');
  }
  if (j.error === 'voice_off') cloudOk = Promise.resolve(false);
  if (!res.ok || !j.ok) throw new Error(j.message || 'Não foi possível reconhecer a voz agora. Tente de novo.');
  if (!j.text) throw new Error(NOT_HEARD);
  return j.text;
}

// ---------- Limpeza do que foi dito ----------
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w]/g, '');
// Comandos e palavras de ligação tirados do começo (ex.: "assistir o filme Duna" → "Duna").
const PREFIXES = [
  'eu quero assistir', 'eu quero ver', 'quero assistir', 'quero ver', 'por favor', 'canal do youtube',
  'procurar', 'procura', 'procure', 'buscar', 'busca', 'busque', 'pesquisar', 'pesquisa', 'pesquise',
  'abrir', 'abre', 'abra', 'assistir', 'assista', 'colocar', 'coloca', 'coloque', 'botar', 'bota',
  'tocar', 'toca', 'toque', 'mostrar', 'mostra', 'mostre', 'passar', 'passa', 'ver',
  'filme', 'filmes', 'serie', 'series', 'canal', 'canais', 'youtube', 'narrador', 'narracao',
  'o', 'a', 'os', 'as', 'um', 'uma', 'do', 'da', 'de', 'dos', 'das', 'no', 'na', 'por', 'pelo', 'pela',
].map((p) => p.split(' '));

export function cleanVoiceText(text) {
  let words = String(text || '').trim().split(/\s+/).filter(Boolean);
  // Sempre sobra pelo menos uma palavra, e não uma letra só ("Filme" e "Série A" ficam como estão).
  const keeps = (n) => words.length - n > 1 || norm(words[words.length - 1]).length > 1;
  for (let changed = true; changed && words.length > 1; ) {
    changed = false;
    for (const p of PREFIXES)
      if (p.length < words.length && keeps(p.length) && p.every((w, i) => norm(words[i]) === w)) {
        words = words.slice(p.length);
        changed = true;
        break;
      }
  }
  if (words.length > 2 && norm(words[words.length - 2]) === 'por' && norm(words[words.length - 1]) === 'favor') words = words.slice(0, -2);
  return words.join(' ').replace(/^["“”'«]+|[.,!?;:…"“”'»]+$/g, '').trim();
}
