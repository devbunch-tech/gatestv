// Camada de controle remoto: normaliza teclas de Android TV, teclados e (via app nativo)
// Apple TV, mantém uma pilha de handlers (player, modais) e faz navegação espacial por D-pad.
import { useEffect, useRef } from 'react';

const stack = [];
let fallback = null;
let tvMode = false;
let press = null;

export const setTvMode = (v) => {
  tvMode = v;
};
export const isTvMode = () => tvMode;
export const setFallback = (fn) => {
  fallback = fn;
};

const NAMED = {
  ArrowUp: 'up', Up: 'up', ArrowDown: 'down', Down: 'down',
  ArrowLeft: 'left', Left: 'left', ArrowRight: 'right', Right: 'right',
  Enter: 'ok', Select: 'ok', Accept: 'ok',
  Escape: 'back', Esc: 'back', GoBack: 'back', BrowserBack: 'back', Back: 'back', Backspace: 'back',
  MediaPlayPause: 'playpause', ' ': 'playpause', k: 'playpause',
  MediaPlay: 'play', Play: 'play', MediaPause: 'pause', Pause: 'pause', MediaStop: 'stop',
  MediaFastForward: 'ff', FastFwd: 'ff', MediaRewind: 'rw', Rewind: 'rw',
  MediaTrackNext: 'next', MediaTrackPrevious: 'prev',
  ChannelUp: 'chup', PageUp: 'chup', ChannelDown: 'chdown', PageDown: 'chdown',
  Info: 'info', i: 'info', I: 'info', ContextMenu: 'menu', o: 'menu', f: 'fullscreen', m: 'mute',
};
// keyCodes usados por WebViews de TV quando `key` vem como "Unidentified".
const CODES = {
  13: 'ok', 461: 'back', 10009: 'back', 179: 'playpause', 415: 'play', 19: 'pause', 413: 'stop',
  417: 'ff', 412: 'rw', 427: 'chup', 428: 'chdown', 457: 'info', 93: 'menu',
  10252: 'playpause', 10232: 'prev', 10233: 'next',
};
const DIRS = ['up', 'down', 'left', 'right'];

export function normalizeKey(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (/^[0-9]$/.test(e.key)) return 'd' + e.key;
  return NAMED[e.key] || CODES[e.keyCode] || null;
}

function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color'].includes(el.type);
}

function onKeyDown(e) {
  const k = normalizeKey(e);
  if (!k) return;
  const t = e.target;
  if (isTyping(t)) {
    if (e.key === 'Escape') {
      t.blur();
      e.preventDefault();
      return;
    }
    if (k !== 'up' && k !== 'down') return;
  }
  if (t?.tagName === 'SELECT' && (k === 'up' || k === 'down')) return;
  if (t?.type === 'range' && (k === 'left' || k === 'right')) return;

  // Handlers retornam: true (tratado), 'nav' (bloqueia camadas abaixo, mas permite navegação) ou false.
  for (let i = stack.length - 1; i >= 0; i--) {
    const r = stack[i](k, e);
    if (r === true) return e.preventDefault();
    if (r === 'nav') break;
  }
  if (fallback?.(k, e)) return e.preventDefault();
  if (DIRS.includes(k) && moveFocus(k)) e.preventDefault();
}

function onKeyUp(e) {
  if (press && normalizeKey(e) === 'ok') {
    const p = press;
    press = null;
    if (!p.fired) p.el.click();
  }
}

if (typeof window !== 'undefined') {
  if (window.__gatesKeys) {
    window.removeEventListener('keydown', window.__gatesKeys.down);
    window.removeEventListener('keyup', window.__gatesKeys.up);
  }
  window.__gatesKeys = { down: onKeyDown, up: onKeyUp };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

// Segurar OK (>550ms) sobre um item com [data-longpress] abre o menu de opções.
export function handleOkPress(e, onLong) {
  const el = document.activeElement?.closest?.('[data-longpress]');
  if (!el) return false;
  if (!press || press.el !== el) {
    press = { el, t: Date.now(), fired: false };
    return true;
  }
  if (!press.fired && Date.now() - press.t > 550) {
    press.fired = true;
    onLong(el.dataset.longpress);
  }
  return true;
}

export function useKeyHandler(fn, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const h = (k, e) => ref.current(k, e);
    stack.push(h);
    return () => {
      const i = stack.indexOf(h);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

// ---------- Navegação espacial ----------
const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

function navRoot() {
  const roots = document.querySelectorAll('[data-nav-root]');
  return roots[roots.length - 1] || document.body;
}

function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

const inViewport = (el) => {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
};

export function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: tvMode ? 'auto' : 'smooth' });
}

// Guarda o foco atual e devolve uma função que o restaura; se o elemento sumiu
// (ex.: canal ocultado/excluído), foca o vizinho na mesma posição da lista.
export function rememberFocus() {
  const el = document.activeElement;
  const parent = el && el !== document.body ? el.parentElement : null;
  const idx = parent ? [...parent.children].indexOf(el) : -1;
  return () => {
    if (el?.isConnected) return el.focus({ preventScroll: true });
    if (!parent?.isConnected) return;
    const kids = [...parent.children].filter((c) => c.matches(FOCUSABLE));
    focusEl(kids[Math.min(idx, kids.length - 1)]);
  };
}

const gap = (a1, a2, b1, b2) => (b2 < a1 ? a1 - b2 : b1 > a2 ? b1 - a2 : 0);

export function moveFocus(dir) {
  const root = navRoot();
  const cur = document.activeElement;
  const nothing = !cur || cur === document.body || !root.contains(cur);
  if (!tvMode && nothing && root === document.body) return false;
  const list = [...root.querySelectorAll(FOCUSABLE)].filter(isVisible);
  if (!list.length) return false;
  if (nothing) {
    focusEl(list.find(inViewport) || list[0]);
    return true;
  }

  const a = cur.getBoundingClientRect();
  const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const b = el.getBoundingClientRect();
    const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    let main, cross, centre;
    if (dir === 'right') {
      if (b.left < a.right - 4) continue;
      main = b.left - a.right;
      cross = gap(a.top, a.bottom, b.top, b.bottom);
      centre = Math.abs(bc.y - ac.y);
    } else if (dir === 'left') {
      if (b.right > a.left + 4) continue;
      main = a.left - b.right;
      cross = gap(a.top, a.bottom, b.top, b.bottom);
      centre = Math.abs(bc.y - ac.y);
    } else if (dir === 'down') {
      if (b.top < a.bottom - 4) continue;
      main = b.top - a.bottom;
      cross = gap(a.left, a.right, b.left, b.right);
      centre = Math.abs(bc.x - ac.x);
    } else {
      if (b.bottom > a.top + 4) continue;
      main = a.top - b.bottom;
      cross = gap(a.left, a.right, b.left, b.right);
      centre = Math.abs(bc.x - ac.x);
    }
    const score = Math.max(0, main) + cross * 4 + centre * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return false;
  focusEl(best);
  return true;
}

export function detectTv() {
  if (import.meta.env.VITE_PLATFORM) return true; // app de Smart TV Samsung/LG
  if (/[?&]tv=1/.test(location.search + location.hash)) return true;
  return /Android TV|GoogleTV|AFT\w|BRAVIA|SMART-TV|SmartTV|Tizen|Web0S|AppleTV|CrKey|HbbTV|Chromecast/i.test(
    navigator.userAgent
  );
}
