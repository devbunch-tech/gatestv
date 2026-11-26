// Comentários e chat ao vivo do YouTube (servidor: rotas /api/v1/yt/*). Ler não precisa de conta;
// escrever usa a conta do YouTube ligada a esta licença (login pelo celular, com QR code).
import { EDITION, SMART_TV, hasNative, native } from './device';
import { licenseApiUrl } from '../config/license';
import { deviceId, loadSaved } from './license';

// Mesmo servidor de voice.js/clark.js (sem VITE_LICENSE_API: o da nuvem).
const base = () => (import.meta.env.VITE_LICENSE_API ? licenseApiUrl() : 'https://gatesapptv.pages.dev').replace(/\/$/, '') + '/api/v1/yt';

export const COMMENT_MAX = 1000;
export const CHAT_MAX = 200;
// Intervalo da consulta do chat: o que o servidor pedir, entre 3 e 10 s.
export const clampPoll = (ms) => Math.min(10000, Math.max(3000, Number(ms) || 5000));
export const watchUrl = (v) => `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`;

// Perfil infantil: sem comentários nem chat.
export const socialAllowed = (profile) => !profile?.kids && EDITION !== 'kids';
// Escrever exige licença (token); família/admin: só leitura + "Comentar pelo celular".
export const canWrite = () => !!loadSaved()?.token;

export const openExternal = (url) => !SMART_TV && (hasNative('openUrl') ? native('openUrl', url) : window.open(url, '_blank', 'noopener'));

// Erro com o código do servidor ('not_linked', 'yt_off'…) e a mensagem em pt-BR.
const fail = (code, message) => Object.assign(new Error(message), { code });

async function req(path, body) {
  let res, j;
  try {
    res = await fetch(
      base() + path,
      body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: loadSaved()?.token, deviceId: deviceId(), ...body }) }
        : undefined
    );
    j = await res.json().catch(() => ({}));
  } catch {
    throw fail('network', 'Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  if (!j.ok) throw fail(j.error || 'http_' + res.status, j.message || 'Não foi possível falar com o YouTube agora. Tente de novo.');
  return j;
}
const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

export const getComments = (v, sort = 'top', next = '') => req(`/comments?${qs({ v, sort, next })}`);
export const getReplies = (next) => req(`/replies?${qs({ next })}`);
export const getChat = (v, next = '') => req(`/chat?${qs({ v, next })}`);
export const getAccount = () => req('/account', {});
export const startLogin = () => req('/login', {});
export const loginStatus = (session) => req('/login/status', { session });
export const postComment = (v, text, parent) => req('/comment', parent ? { v, text, parent } : { v, text });
export const sendChat = (v, text) => req('/chat/send', { v, text });
export const logout = () => req('/logout', {});

// Junta mensagens novas do chat às que já estão na tela (sem repetir) e guarda só as últimas 'max'.
export function mergeChat(list, add, max = 200) {
  const seen = new Set(list.map((m) => m.id));
  const out = [...list, ...(add || []).filter((m) => m?.id && !seen.has(m.id) && seen.add(m.id))];
  return out.length > max ? out.slice(-max) : out;
}

// Curtidas: número (1,2 mil) ou o texto que o servidor mandar.
export function fmtCount(n) {
  if (typeof n !== 'number') return n || '';
  if (n < 1000) return String(n);
  try {
    return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(n);
  }
}
// Hora da mensagem do chat (ms).
export const fmtClock = (ms) => (ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
