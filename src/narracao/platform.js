// Pontes do GATES Narração com os apps nativos (contrato com android/ e electron/: não mude os nomes).
//   Android (window.GatesAndroid): narrApps, narrOpenApp, narrPipSupported, narrPip, narrPipActions,
//     narrDuck, exit. Eventos: 'gates-narr-pip' {on}, 'gates-narr-action' {id}.
//   Windows (window.GatesNarr, tudo devolve Promise): setMode, setCorner, audioApps, setAppVolume,
//     setAppMute, quit. Eventos: 'gates-narr-action' {id}, 'gates-narr-mode' {mode}.
// No navegador comum nada disso existe e a página funciona sozinha (útil para testar).
import { useEffect, useRef } from 'react';
import { hasNative, native } from '../lib/device';

export const isAndroidNarr = () => hasNative('narrOpenApp');
export const isDesktopNarr = () => typeof window !== 'undefined' && !!window.GatesNarr;

// Apps de jogos instalados na TV/celular: [{ pkg, label }].
export function narrApps() {
  try {
    const l = JSON.parse(native('narrApps') || '[]');
    return Array.isArray(l) ? l.filter((a) => a?.pkg) : [];
  } catch {
    return [];
  }
}
export const pipSupported = () => {
  try {
    return hasNative('narrPipSupported') && !!native('narrPipSupported');
  } catch {
    return false;
  }
};

// Windows: chamada que nunca quebra a página (app antigo, método ausente ou erro no nativo).
export async function desk(name, ...args) {
  try {
    const fn = window.GatesNarr?.[name];
    return typeof fn === 'function' ? await fn.apply(window.GatesNarr, args) : undefined;
  } catch {
    return undefined;
  }
}

// Evento da window vindo do nativo; o detail pode chegar como objeto ou como texto JSON.
export function useNativeEvent(name, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e) => {
      let d = e.detail;
      if (typeof d === 'string') {
        try {
          d = JSON.parse(d);
        } catch {
          d = { id: d };
        }
      }
      ref.current(d || {});
    };
    window.addEventListener(name, h);
    return () => window.removeEventListener(name, h);
  }, [name]);
}

// Preferências do app (ficam no aparelho).
export function loadPref(k, d) {
  try {
    const v = JSON.parse(localStorage.getItem('gates:narrapp:' + k) || 'null');
    return v ?? d;
  } catch {
    return d;
  }
}
export function savePref(k, v) {
  try {
    localStorage.setItem('gates:narrapp:' + k, JSON.stringify(v));
  } catch {
    /* armazenamento cheio */
  }
}
