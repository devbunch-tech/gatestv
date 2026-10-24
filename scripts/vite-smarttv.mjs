// Ajustes de build para as Smart TVs Samsung (Tizen) e LG (webOS), ligados por VITE_PLATFORM.
// Essas TVs abrem o app direto do arquivo (file://) e, nos modelos 2020–2022, usam navegadores
// antigos (Chromium 68 a 87). Por isso o build das TVs:
//   • sai como script clássico num arquivo só (módulos não carregam de file:// e workers de módulo
//     só existem a partir do Chromium 80);
//   • tem o JavaScript convertido para o Chromium 68;
//   • ganha alternativas no CSS para o que esses navegadores não entendem: :focus-visible (o foco do
//     controle remoto), inset, min()/max()/clamp(), aspect-ratio e gap em flexbox.
// O Android, o Windows e o site não passam por aqui.

const TARGET = 'chrome68';

export function smartTvPlugin() {
  return {
    name: 'gates-smarttv',
    enforce: 'pre',
    config() {
      return {
        build: {
          target: TARGET,
          cssTarget: TARGET,
          modulePreload: false,
          rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
        },
        worker: { format: 'iife' },
      };
    },
    transform(code, id) {
      if (!/\.css(\?|$)/.test(id) || id.includes('node_modules')) return null;
      return { code: legacyCss(code), map: null };
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // <script type="module" crossorigin src> -> script clássico com defer (roda depois do <body>).
        return html
          .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
          .replace(/<link rel="stylesheet" crossorigin href=/g, '<link rel="stylesheet" href=');
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// CSS: cada bloco de declarações (sem blocos dentro) é reescrito; o resto do arquivo fica igual.
export function legacyCss(src) {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  const extra = []; // regras de alternativa, adicionadas no fim (só valem nos navegadores antigos)
  const stack = []; // @media/@supports abertos no ponto atual
  const closeIn = (txt) => {
    for (const ch of txt) if (ch === '}') stack.pop();
  };
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) {
      out += css.slice(i);
      break;
    }
    const close = css.indexOf('}', open);
    const nextOpen = css.indexOf('{', open + 1);
    if (close < 0) {
      out += css.slice(i);
      break;
    }
    if (nextOpen >= 0 && nextOpen < close) {
      // Bloco com blocos dentro (@media, @supports…): mantém o cabeçalho e segue para dentro.
      const h = css.slice(i, open);
      closeIn(h);
      stack.push(h.slice(Math.max(h.lastIndexOf('}'), h.lastIndexOf(';')) + 1).trim());
      out += css.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    // Seletor = texto entre o último '}' / ';' / '{' e este '{'.
    const head = css.slice(i, open);
    const cut = Math.max(head.lastIndexOf('}'), head.lastIndexOf(';'), head.lastIndexOf('{'));
    const prefix = head.slice(0, cut + 1);
    closeIn(prefix);
    let selector = head.slice(cut + 1);
    const body = css.slice(open + 1, close);
    const isRule = !/^\s*@/.test(selector) && !/^\s*(from|to|\d+%)/.test(selector.trim());
    if (isRule) selector = selector.replace(/:focus-visible/g, ':focus');
    const local = [];
    const decls = isRule ? fixDecls(body, selector.trim(), local) : body;
    for (const r of local) extra.push(stack.length ? stack.join(' { ') + ' { ' + r + ' }'.repeat(stack.length) : r);
    out += prefix + selector + '{' + decls + '}';
    i = close + 1;
  }
  return out + (extra.length ? '\n' + extra.join('\n') + '\n' : '');
}

const decl = (body) =>
  body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const c = d.indexOf(':');
      return c < 0 ? null : { prop: d.slice(0, c).trim(), value: d.slice(c + 1).trim() };
    })
    .filter(Boolean);

function fixDecls(body, selector, extra) {
  const list = decl(body);
  const out = [];
  for (const { prop, value } of list) {
    const custom = prop.startsWith('--');
    if (!custom && prop === 'inset') {
      const [t, r = t, b = t, l = r] = splitTop(value.replace(/\s*!important$/, ''), ' ');
      const imp = /!important$/.test(value) ? ' !important' : '';
      out.push(`top: ${t}${imp}`, `right: ${r}${imp}`, `bottom: ${b}${imp}`, `left: ${l}${imp}`);
      continue;
    }
    if (!custom && /(^|[^a-z-])(min|max|clamp)\(/i.test(value)) {
      const fb = mathFallback(value);
      if (fb && fb !== value) out.push(`${prop}: ${fb}`);
    }
    out.push(`${prop}: ${value}`);
  }

  const get = (p) => [...list].reverse().find((d) => d.prop === p)?.value;
  const sels = selector.split(',').map((s) => s.trim()).filter(Boolean);

  // aspect-ratio (Chromium 88+): altura pela largura em px, ou "calço" com padding-top.
  const ar = get('aspect-ratio');
  const m = ar && /^([\d.]+)\s*\/\s*([\d.]+)$/.exec(ar);
  if (m && sels.every((s) => !s.includes('::'))) {
    const ratio = Number(m[2]) / Number(m[1]);
    const w = /^([\d.]+)px$/.exec(get('width') || '');
    if (w) extra.push(`@supports not (aspect-ratio: 1 / 1) { ${selector} { height: ${+(Number(w[1]) * ratio).toFixed(2)}px; } }`);
    else
      extra.push(
        `@supports not (aspect-ratio: 1 / 1) { ${sels.map((s) => s + '::before').join(', ')} { content: ''; float: left; padding-top: ${+(ratio * 100).toFixed(4)}%; } ` +
          `${sels.map((s) => s + '::after').join(', ')} { content: ''; display: block; clear: both; } }`
      );
  }

  // gap em flexbox (Chromium 84+): margens nos filhos, só quando o app detecta a falta
  // (classe html.no-flexgap, posta em main.jsx).
  const display = get('display');
  const gap = get('gap') || get('row-gap') || get('column-gap');
  if (gap && /^(inline-)?flex$/.test(display || '') && !/var\(|calc\(/.test(gap)) {
    const [rowGap, colGap = rowGap] = splitTop(get('gap') || '', ' ');
    const rg = get('row-gap') || rowGap || '0';
    const cg = get('column-gap') || colGap || '0';
    const column = /^column/.test(get('flex-direction') || '');
    const wrap = /^wrap/.test(get('flex-wrap') || '') || /wrap/.test(get('flex-flow') || '');
    const on = (s) => `html.no-flexgap ${s}`;
    if (column) extra.push(`${sels.map((s) => on(s) + ' > * + *').join(', ')} { margin-top: ${rg}; }`);
    else if (wrap) extra.push(`${sels.map((s) => on(s) + ' > *').join(', ')} { margin-right: ${cg}; margin-bottom: ${rg}; }`);
    else extra.push(`${sels.map((s) => on(s) + ' > * + *').join(', ')} { margin-left: ${cg}; }`);
  }
  return ' ' + out.join('; ') + '; ';
}

// Divide por um separador fora de parênteses.
function splitTop(s, sep) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur) parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

// min(a, b) -> a · max(a, b) -> a · clamp(a, b, c) -> c (valores fixos para navegadores antigos).
function mathFallback(value) {
  let s = value;
  for (let guard = 0; guard < 20; guard++) {
    const re = /(^|[^a-z-])(min|max|clamp)\(/i.exec(s);
    if (!re) return s;
    const start = re.index + re[1].length;
    const fn = re[2].toLowerCase();
    let depth = 0;
    let end = -1;
    for (let k = start + fn.length; k < s.length; k++) {
      if (s[k] === '(') depth++;
      else if (s[k] === ')' && --depth === 0) {
        end = k;
        break;
      }
    }
    if (end < 0) return null;
    const args = splitTop(s.slice(start + fn.length + 1, end), ',');
    if (!args.length) return null;
    const pick = fn === 'clamp' ? args[args.length - 1] : args[0];
    if (/env\(/.test(pick)) return null;
    s = s.slice(0, start) + pick.trim() + s.slice(end + 1);
  }
  return null;
}
