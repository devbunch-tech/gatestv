// Pausa com trailer: a cada 30 min assistindo um filme (ou série), mostra o trailer de um
// lançamento do mesmo tipo e depois volta ao ponto em que parou.
import { recentUnique } from './home';
import { cleanTitle, findTitle, getDetails, hasMetaKey } from './meta';

export const BREAK_EVERY = 30 * 60; // segundos assistidos entre um trailer e outro
export const BREAK_SKIP_AFTER = 5; // segundos até liberar o "Pular"
export const BREAK_MAX = 180; // segundos: se o trailer não avisar que acabou, volta ao vídeo

const ADULT = /adult|\+18|xxx|er[oó]tic/i;
const RELEASE = /lan[cç]amento|estreia|novidade/i;

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Lançamento aleatório com trailer: { key (YouTube), title }. null = nenhum encontrado.
export async function pickTrailer(catalog, type, { exclude, isRestricted } = {}) {
  const pool = (type === 'series' ? catalog.series : catalog.movies).filter(
    (it) => it.id !== exclude && !(it.groups || [it.group]).some((g) => ADULT.test(g || '')) && !isRestricted?.(it)
  );
  const releases = pool.filter((it) => (it.groups || [it.group]).some((g) => RELEASE.test(g || '')));
  const base = shuffle(releases.length >= 5 ? releases : recentUnique(pool, 60));
  for (const it of base.slice(0, 8)) {
    const name = it.displayName || it.series?.name || it.name;
    if (it.trailer) return { key: it.trailer, title: name };
    if (!hasMetaKey()) continue;
    const { title, year } = cleanTitle(name);
    const found = await findTitle({ title, year, type: type === 'series' ? 'tv' : 'movie' }).catch(() => null);
    if (!found) continue;
    const d = await getDetails(found.type, found.id).catch(() => null);
    const t = d?.trailers?.[0];
    if (t?.key) return { key: t.key, title: d.title || name };
  }
  return null;
}
