// Organização das bibliotecas de Filmes e Séries em fileiras por categoria.
import { PLATFORMS, normGroup, platformOf } from '../config/platforms';
import { ADULT_RE } from './parental';

// "(L) Séries Netflix" (legendado) é a mesma categoria que "Séries Netflix": as versões
// dublada e legendada já são um item só.
export const canonGroup = (g) => String(g || '').replace(/^\s*[[(]\s*l\s*[\])]\s*/i, '').trim() || 'Sem categoria';
export const groupsOf = (it) => [...new Set((it.groups || [it.group]).map(canonGroup))];

export function libraryGroups(items) {
  const m = new Map();
  for (const it of items)
    for (const g of groupsOf(it)) {
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(it);
    }
  const rank = (x) => (x.platform ? PLATFORMS.indexOf(x.platform) : PLATFORMS.length);
  const launch = (x) => (/lancamento/.test(normGroup(x.name)) ? 0 : 1);
  return [...m.entries()]
    .map(([name, list]) => ({ name, list, platform: platformOf(name), adult: ADULT_RE.test(name) }))
    .sort((a, b) => rank(a) - rank(b) || launch(a) - launch(b) || b.list.length - a.list.length);
}

export const inGroup = (it, group) => groupsOf(it).includes(group);

// Plataforma de streaming do título (pela primeira categoria que indicar uma).
export const platformOfItem = (it) => {
  for (const g of it.groups || [it.group]) {
    const p = platformOf(g);
    if (p) return p;
  }
  return null;
};

// ---------- Plataformas e gêneros (telas de Filmes e Séries) ----------
// Plataformas a que o título pertence (um título pode estar em mais de uma categoria).
export const platformsOfItem = (it) => [...new Set(groupsOf(it).map((g) => platformOf(g)).filter(Boolean))];

// Categorias que não são gênero: plataformas, lançamentos, qualidade, idioma, coletâneas…
const NOT_GENRE = /lancamento|legendad|dublad|\b4k\b|uhd|\bfhd\b|\bhd\b|cinema|coletanea|especial|filme em|nacionais|sem categoria|curtas|shorts|novelas?|programas|cursos|desenvolvimento|audio ?books|livros/;
const GENRE_ALIASES = { 'ficcao': 'Ficção Científica', 'sci-fi': 'Ficção Científica', 'ficcao cientifica': 'Ficção Científica', 'acao': 'Ação', 'action': 'Ação', 'comedy': 'Comédia', 'horror': 'Terror', 'animation': 'Animação', 'documentary': 'Documentário', 'romance': 'Romance', 'thriller': 'Suspense', 'mystery': 'Mistério', 'war': 'Guerra', 'family': 'Família', 'fantasy': 'Fantasia', 'western': 'Faroeste', 'crime': 'Crime', 'drama': 'Drama', 'adventure': 'Aventura' };
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Gêneros do título: categorias de gênero da lista + o campo "gênero" (séries Xtream).
export function genresOf(it) {
  const out = new Set();
  for (const g of groupsOf(it)) {
    const n = normGroup(g);
    if (platformOf(g) || NOT_GENRE.test(n)) continue;
    const clean = g.replace(/^s[ée]ries?\s+/i, '').replace(/^filmes?\s+(de\s+)?/i, '').trim();
    if (clean && clean.length <= 22) out.add(GENRE_ALIASES[normGroup(clean)] || titleCase(clean));
  }
  for (const part of String(it.genre || '').split(/[,/&|]+/)) {
    const p = part.trim();
    if (!p) continue;
    out.add(GENRE_ALIASES[normGroup(p)] || titleCase(p));
  }
  return [...out];
}
