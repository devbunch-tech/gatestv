// Guia de programação no formato XMLTV (aceita .xml e .xml.gz).
import { useEffect, useState } from 'react';
import { isExternal } from './net';
// Smart TVs: worker clássico embutido (TVs antigas não aceitam worker de módulo nem worker de arquivo local).
import EpgInlineWorker from './epg.worker.js?worker&inline';

export { normName, parseXmltvDate } from './xmltv';

let worker = null;
let seq = 0;
const pending = new Map();
function getWorker() {
  if (!worker) {
    worker = import.meta.env.VITE_PLATFORM
      ? new EpgInlineWorker()
      : new Worker(new URL('./epg.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
  }
  return worker;
}

// Baixa e interpreta o XMLTV num Web Worker. "wanted" limita aos canais das listas.
export function loadEpg(url, useProxy, { from, to, ids, names } = {}) {
  const target = useProxy && isExternal(url) ? '/proxy?raw=1&url=' + encodeURIComponent(url) : url;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, target: new URL(target, location.href).href, from, to, ids, names });
  });
}

export function findNow(progs, t = Date.now()) {
  if (!progs?.length) return null;
  let lo = 0;
  let hi = progs.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const p = progs[m];
    if (t < p.start) hi = m - 1;
    else if (t >= p.stop) lo = m + 1;
    else return p;
  }
  return null;
}

export function nowNext(progs, t = Date.now(), count = 5) {
  if (!progs?.length) return { now: null, next: null, list: [] };
  const i = progs.findIndex((p) => p.stop > t);
  if (i < 0) return { now: null, next: null, list: [] };
  const list = progs.slice(i, i + count);
  const now = list[0].start <= t ? list[0] : null;
  return { now, next: now ? list[1] || null : list[0], list };
}

export const progressOf = (p, t = Date.now()) => Math.min(1, Math.max(0, (t - p.start) / (p.stop - p.start)));
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function useNow(interval = 30000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}
