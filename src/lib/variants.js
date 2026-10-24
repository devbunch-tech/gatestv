// Agrupa versões do mesmo título (Dublado / Legendado / 4K…) em um único item.
// A versão exibida nas listas é a dublada; as demais aparecem como opção na página do título.
import { cleanTitle, normTitle } from './meta';

const LEG = /\b(leg|legendad[oa]s?|subtitled|subs?)\b|[[(]\s*l\s*[\])]/i;
const DUB = /\b(dub|dublad[oa]s?|dual(?:\s*[áa]udio)?|nacional|pt-?br)\b|[[(]\s*d\s*[\])]/i;
const Q4K = /\b(4k|uhd|2160p?)\b/i;
const QFHD = /\b(fhd|full\s*hd|1080p?)\b/i;

export function languageOf(it) {
  const name = it.name || '';
  if (DUB.test(name)) return 'dub';
  if (LEG.test(name)) return 'leg';
  const g = it.group || '';
  if (DUB.test(g)) return 'dub';
  if (LEG.test(g)) return 'leg';
  return 'und';
}

export function qualityOf(it) {
  const s = `${it.name} ${it.group}`;
  return Q4K.test(s) ? '4K' : QFHD.test(s) ? 'Full HD' : '';
}

const LANG_LABEL = { dub: 'Dublado', leg: 'Legendado', und: '' };
const LANG_RANK = { dub: 0, und: 1, leg: 2 };
const QUALITY_RANK = { 'Full HD': 0, '': 1, '4K': 2 }; // 4K por último: nem todo aparelho/rede aguenta

// Nome para exibição, sem marcações de idioma/qualidade (a versão é escolhida na página do título).
export const displayName = (name) =>
  String(name || '')
    .replace(/\s*[[(]\s*(l|d|leg|dub|legendado|dublado|4k|uhd|fhd|full hd|hd|sd)\s*[\])]/gi, '')
    .replace(/\s*[-–|:]?\s*\b(legendad[oa]s?|dublad[oa]s?|dual(?:\s*[áa]udio)?|nacional)\b/gi, '')
    .replace(/\s*[-–|:]?\s*\b(leg|dub)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–|:]+$/, '')
    .trim() || String(name || '');

export const variantLabel = (v) => [LANG_LABEL[v.lang], v.quality].filter(Boolean).join(' · ') || 'Outra versão';

// items: filmes ou séries já visíveis. Retorna { primaries, groups } onde cada primário tem `variants`.
export function mergeVariants(items) {
  const byTitle = new Map();
  for (const it of items) {
    const base = it.type === 'series' ? it.series?.name || it.name : it.name;
    const { title, year } = cleanTitle(base);
    const key = normTitle(title);
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push({ it, year });
  }

  const out = [];
  const order = new Map(items.map((it, i) => [it.id, i]));
  for (const list of byTitle.values()) {
    // Mesmo título com anos diferentes = obras diferentes (ex.: remakes). Sem ano: junta ao único ano existente.
    const years = [...new Set(list.map((x) => x.year).filter(Boolean))];
    const buckets = new Map();
    for (const x of list) {
      const y = x.year || (years.length === 1 ? years[0] : 0);
      if (!buckets.has(y)) buckets.set(y, []);
      buckets.get(y).push(x.it);
    }
    for (const group of buckets.values()) {
      const variants = group
        .map((it) => ({ id: it.id, lang: languageOf(it), quality: qualityOf(it), it }))
        .sort((a, b) => LANG_RANK[a.lang] - LANG_RANK[b.lang] || QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality] || order.get(a.id) - order.get(b.id));
      const meta = variants.map(({ id, lang, quality }) => ({ id, lang, quality, label: '' }));
      // Rótulos únicos ("Dublado", "Dublado · 4K", "Legendado 2"…)
      const seen = new Map();
      for (const m of meta) {
        const l = variantLabel(m);
        const n = (seen.get(l) || 0) + 1;
        seen.set(l, n);
        m.label = n > 1 ? `${l} ${n}` : l;
      }
      const primary = { ...variants[0].it, variants: meta.length > 1 ? meta : null, lang: meta[0].lang, displayName: displayName(variants[0].it.name) };
      // Categorias de todas as versões (ex.: só a legendada está em "NETFLIX").
      primary.groups = [...new Set(group.flatMap((it) => it.groups || [it.group]).filter(Boolean))];
      // Mantém a posição original do item mais antigo do grupo, para não bagunçar a ordem da lista.
      primary._order = Math.min(...group.map((it) => order.get(it.id)));
      // Para "adicionados recentemente", vale a versão mais nova do grupo.
      primary.added = Math.max(...group.map((it) => it.added || 0)) || primary.added;
      primary.firstSeen = Math.max(...group.map((it) => it.firstSeen || 0)) || primary.firstSeen;
      out.push(primary);
    }
  }
  out.sort((a, b) => a._order - b._order);
  return out;
}
