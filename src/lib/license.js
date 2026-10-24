// Licença do assinante: conversa com o servidor de licenças, guarda a licença assinada no aparelho
// e confere a assinatura digital (ECDSA P-256) com a chave pública — uma licença editada à mão
// não passa. A situação (em dia / aviso / suspenso) é recalculada pelas datas, então funciona
// alguns dias sem internet.
import { LICENSE_PUBLIC_KEY, OFFLINE_DAYS, licenseApiUrl } from '../config/license';
import { DEVICE, PLATFORM, native } from './device';

const KEY = 'gates:license';
const DEVICE_KEY = 'gates:deviceId';
const DAY = 864e5;

export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // App Android: a mesma identificação depois de reinstalar (não ocupa outra vaga de aparelho).
      // Instalações antigas mantêm a que já têm, para não perderem a licença salva.
      id = native('stableId') || (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'sem-armazenamento';
  }
}

export function deviceName() {
  if (PLATFORM === 'tizen') return 'TV Samsung';
  if (PLATFORM === 'webos') return 'TV LG';
  if (import.meta.env.VITE_WEB === '1') return 'Navegador · ' + (/Edg\//.test(navigator.userAgent) ? 'Edge' : /Firefox\//.test(navigator.userAgent) ? 'Firefox' : /Safari\//.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent) ? 'Safari' : 'Chrome');
  const ua = navigator.userAgent;
  const model = /Android [\d.]+; ([^;)]+)/.exec(ua)?.[1]?.replace(/ Build.*/, '').trim();
  const kind = { tv: 'TV', phone: 'Celular', tablet: 'Tablet', desktop: /Windows/.test(ua) ? 'Windows' : 'Computador' }[DEVICE] || 'Aparelho';
  return model ? `${kind} · ${model}` : kind;
}

// ---------- Armazenamento ----------
export function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}
function save(token, payload) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, payload, savedAt: Date.now() }));
  } catch {
    /* armazenamento cheio */
  }
}
export function clearSaved() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ---------- Assinatura digital ----------
let keyPromise = null;
const b64uToBytes = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export async function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !crypto?.subtle) return null;
  try {
    keyPromise ||= crypto.subtle.importKey('jwk', { ...LICENSE_PUBLIC_KEY, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await keyPromise, b64uToBytes(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(b64uToBytes(body)));
  } catch {
    return null;
  }
}

// Situação agora, a partir da licença:
//   active | grace (aviso, suspende em suspendAt) | suspended | offline (precisa de internet)
export function evaluate(p, now = Date.now()) {
  if (!p) return { status: 'none' };
  if (p.did !== deviceId()) return { status: 'none' };
  if (now > p.exp + OFFLINE_DAYS * DAY) return { status: 'offline', paidUntil: p.paidUntil, suspendAt: p.suspendAt };
  const base = { paidUntil: p.paidUntil, suspendAt: p.suspendAt, reason: p.reason, email: p.email };
  if (p.reason === 'blocked' || p.reason === 'no_subscription') return { ...base, status: 'suspended' };
  if (p.paidUntil && now <= p.paidUntil) return { ...base, status: 'active' };
  if (p.suspendAt && now <= p.suspendAt) return { ...base, status: 'grace' };
  return { ...base, status: 'suspended' };
}

// ---------- Servidor ----------
async function call(path, { method = 'POST', body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(licenseApiUrl() + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) {
      const err = new Error(j.message || `Servidor de licenças indisponível (HTTP ${res.status}).`);
      err.code = j.error || 'http_' + res.status;
      err.http = res.status;
      throw err;
    }
    return j;
  } catch (err) {
    if (err.code) throw err;
    const e = new Error('Sem conexão com o servidor de assinaturas. Verifique a internet.');
    e.code = 'network';
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function accept(j) {
  const payload = await verifyToken(j.token);
  if (!payload) {
    const e = new Error('A licença recebida não é válida (assinatura digital).');
    e.code = 'bad_signature';
    throw e;
  }
  save(j.token, payload);
  return payload;
}

const deviceInfo = () => ({ deviceId: deviceId(), deviceName: deviceName(), platform: DEVICE });

export async function activate(email, order) {
  return accept(await call('/api/v1/activate', { body: { email, order, ...deviceInfo() } }));
}

// Ativação automática: o APK baixado pelo link do cliente traz uma chave gravada pelo servidor.
export async function activateInstall(token) {
  return accept(await call('/api/v1/install/activate', { body: { token, ...deviceInfo() } }));
}

export async function refresh() {
  const saved = loadSaved();
  if (!saved?.token) return null;
  return accept(await call('/api/v1/refresh', { body: { token: saved.token, deviceId: deviceId() } }));
}

export async function logout() {
  const saved = loadSaved();
  clearSaved();
  if (saved?.token) await call('/api/v1/logout', { body: { token: saved.token } }).catch(() => {});
}

// Pareamento: o aparelho mostra um código e espera o cliente confirmar no celular.
export const pairStart = () => call('/api/v1/pair/start', { body: deviceInfo() });
export async function pairPoll(pairId) {
  const j = await call(`/api/v1/pair/poll?id=${encodeURIComponent(pairId)}`, { method: 'GET' });
  return j.pair === 'done' ? accept(j) : null;
}

// Aviso de suspensão: aparece 1x por vencimento (chave = data de suspensão).
const noticeKey = (p) => `gates:license:notice:${p?.suspendAt || 0}`;
export function noticeSeen(p) {
  try {
    return !!localStorage.getItem(noticeKey(p));
  } catch {
    return false;
  }
}
export function markNoticeSeen(p) {
  try {
    localStorage.setItem(noticeKey(p), String(Date.now()));
  } catch {
    /* ignore */
  }
}

// Configuração enviada pelo servidor junto com a licença (chaves do TMDB/OMDb, link da loja…).
export const licenseConfig = () => loadSaved()?.payload?.cfg || {};
