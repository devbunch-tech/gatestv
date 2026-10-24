// Tipo de aparelho: 'tv' (controle remoto), 'phone' / 'tablet' (toque) ou 'desktop' (mouse).
// Os APKs abrem o app com ?tv=1 ou ?device=phone|tablet; no navegador é detectado pela tela.
const query = typeof location !== 'undefined' ? location.search + location.hash : '';
const forced = (query.match(/[?&]device=(phone|tablet)\b/) || [])[1];

// Smart TVs Samsung (Tizen) e LG (webOS): build próprio (npm run build:smarttv).
export const PLATFORM = import.meta.env.VITE_PLATFORM || '';
export const SMART_TV = PLATFORM === 'tizen' || PLATFORM === 'webos';
// Versão web (navegador, gatesapptv.pages.dev/app).
export const WEB = import.meta.env.VITE_WEB === '1';

function detect() {
  if (SMART_TV) return 'tv';
  if (forced) return forced;
  if (/[?&]tv=1/.test(query)) return 'tv';
  if (typeof window === 'undefined') return 'desktop';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  if (!coarse) return 'desktop';
  return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet';
}

export const DEVICE = detect();
// Edição do app: 'admin' = só o perfil administrador, sem fotos (APK "Celular Admin").
// Edição do app: 'family' (perfis da família), 'admin' (só o perfil administrador, sem login) ou
// 'subscriber' (assinantes: login com a compra na Nuvemshop e licença validada no servidor).
export const EDITION =
  import.meta.env.VITE_DEMO === '1' ? 'demo' : import.meta.env.VITE_SUBSCRIBER === '1' ? 'subscriber' : (query.match(/[?&]edition=(admin|subscriber)(?![a-z])/) || [])[1] || 'family';
export const isSubscriber = EDITION === 'subscriber';
// Degustação: app aberto no site, só com canais de sinal aberto oficial.
export const isDemo = EDITION === 'demo';

// LITE: menos conteúdo carregado ao mesmo tempo e sem efeitos pesados (aparelhos mais simples).
// Vem do APK (?lite=1) e pode ser ligado/desligado em Configurações (vale a escolha do usuário).
function detectLite() {
  try {
    const saved = localStorage.getItem('gates:lite');
    if (saved === '1' || saved === '0') return saved === '1';
  } catch {
    /* sem armazenamento */
  }
  return /[?&]lite=1/.test(query);
}
export const LITE = detectLite();
export const LITE_DEFAULT = /[?&]lite=1/.test(query);
export function setLite(on) {
  try {
    if (on === LITE_DEFAULT) localStorage.removeItem('gates:lite');
    else localStorage.setItem('gates:lite', on ? '1' : '0');
  } catch {
    /* sem armazenamento */
  }
  location.reload();
}
export const isTouch = DEVICE === 'phone' || DEVICE === 'tablet';
export const isPhone = DEVICE === 'phone';

// Chamadas ao app Android (sem efeito no navegador / no Windows).
export function native(name, ...args) {
  try {
    const bridge = window.GatesAndroid;
    if (bridge && typeof bridge[name] === 'function') return bridge[name](...args);
  } catch {
    /* app antigo sem este método */
  }
  return undefined;
}
export const hasNative = (name) => typeof window !== 'undefined' && typeof window.GatesAndroid?.[name] === 'function';

export function vibrate(ms = 15) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* sem vibração */
  }
}
