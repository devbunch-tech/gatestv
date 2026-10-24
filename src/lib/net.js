export const isExternal = (url) => /^https?:\/\//i.test(url) && !url.startsWith(location.origin);

export const proxify = (url) => '/proxy?url=' + encodeURIComponent(url);

// Modo do proxy: 'auto' (direto quando possível), 'always' ou 'never'.
const HOSTS_KEY = 'gates:proxyHosts';
const proxyHosts = new Set(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(HOSTS_KEY) || '[]');
    } catch {
      return [];
    }
  })()
);
export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};
// Servidores que bloquearam o acesso direto (CORS) passam a ir sempre pelo proxy,
// evitando esperar uma falha a cada troca de canal.
export function markProxyHost(url) {
  const h = hostOf(url);
  if (!h || proxyHosts.has(h)) return;
  proxyHosts.add(h);
  try {
    localStorage.setItem(HOSTS_KEY, JSON.stringify([...proxyHosts]));
  } catch {
    /* ignore */
  }
}
export const resetProxyHosts = () => {
  proxyHosts.clear();
  try {
    localStorage.removeItem(HOSTS_KEY);
  } catch {
    /* ignore */
  }
};

function mustProxy(url) {
  if (!isExternal(url)) return false;
  // Página em HTTPS não pode carregar stream HTTP (conteúdo misto).
  if (location.protocol === 'https:' && /^http:/i.test(url)) return true;
  return proxyHosts.has(hostOf(url));
}

// Smart TVs Samsung/LG: o app roda do arquivo, sem o servidor local que faz o proxy (Android/Windows).
// Lá o sistema da TV já libera o acesso direto às listas e aos streams.
export const NO_LOCAL_PROXY = !!import.meta.env.VITE_PLATFORM || import.meta.env.VITE_WEB === '1';
// Versão web: o navegador bloqueia http:// num site https:// e listas sem liberação de CORS.
export const WEB_BUILD = import.meta.env.VITE_WEB === '1';
export const WEB_HINT = 'Para essa lista, use o app do GATES! TV (Android, TV ou Windows), que acessa qualquer servidor.';
export const blockedByBrowser = (url) => WEB_BUILD && location.protocol === 'https:' && /^http:\/\//i.test(String(url || ''));

export function streamUrl(url, mode = 'auto', force = false) {
  if (NO_LOCAL_PROXY || !isExternal(url) || mode === 'never') return url;
  if (mode === 'always' || force || mustProxy(url)) return proxify(url);
  return url;
}
export const isProxied = (src) => src.startsWith('/proxy?');

// Listas, EPG e API Xtream quase nunca liberam CORS: passam pelo proxy, exceto no modo "never".
export const dataProxy = (mode) => !NO_LOCAL_PROXY && mode !== 'never';

export async function fetchText(url, useProxy) {
  if (blockedByBrowser(url)) throw new Error('Esta lista usa um endereço http://, que os navegadores bloqueiam por segurança. ' + WEB_HINT);
  const target = useProxy && isExternal(url) ? '/proxy?raw=1&url=' + encodeURIComponent(url) : url;
  let res;
  try {
    res = await fetch(target);
  } catch {
    if (WEB_BUILD) throw new Error('O servidor desta lista não permite o acesso pelo navegador. ' + WEB_HINT);
    throw new Error(
      useProxy
        ? 'Não foi possível acessar a URL.'
        : 'Não foi possível acessar a URL (possível bloqueio de CORS). Ative o proxy nas configurações.'
    );
  }
  if (!res.ok) throw new Error(`Falha ao baixar a lista (HTTP ${res.status}).`);
  return res.text();
}

export function xtreamToM3U({ server, username, password, output }) {
  const base = server.replace(/\/+$/, '');
  const qs = new URLSearchParams({ username, password, type: 'm3u_plus', output: output || 'ts' });
  return `${base}/get.php?${qs}`;
}

export function detectKind(url) {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (path.endsWith('.ts') || path.endsWith('.flv')) return 'mpegts';
  if (/\.(mp4|m4v|mkv|webm|mov|ogv)$/.test(path)) return 'file';
  return 'unknown';
}
