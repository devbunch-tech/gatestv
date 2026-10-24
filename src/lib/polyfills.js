// Funções que faltam nos navegadores das Smart TVs de 2020–2021 (Chromium 68–79). Só preenchem o que
// não existe; nos aparelhos atuais nada muda. Importado antes de tudo em main.jsx.
/* eslint-disable no-extend-native */
if (typeof globalThis === 'undefined') {
  (typeof self !== 'undefined' ? self : window).globalThis = typeof self !== 'undefined' ? self : window;
}
if (!Array.prototype.flat) {
  Object.defineProperty(Array.prototype, 'flat', {
    configurable: true,
    writable: true,
    value: function flat(depth = 1) {
      const out = [];
      const walk = (arr, d) => {
        for (const x of arr) Array.isArray(x) && d > 0 ? walk(x, d - 1) : out.push(x);
      };
      walk(this, Math.floor(depth) || 0);
      return out;
    },
  });
}
if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true,
    writable: true,
    value: function flatMap(fn, thisArg) {
      return Array.prototype.map.call(this, fn, thisArg).flat(1);
    },
  });
}
if (!Object.fromEntries) {
  Object.fromEntries = (entries) => {
    const o = {};
    for (const [k, v] of entries) o[k] = v;
    return o;
  };
}
if (typeof queueMicrotask !== 'function') {
  window.queueMicrotask = (fn) => Promise.resolve().then(fn);
}
