// Classificação indicativa brasileira (ClassInd): L, 10, 12, 14, 16, 18.
export const AGES = [0, 10, 12, 14, 16, 18];
export const ageLabel = (a) => (a === 0 ? 'L' : String(a));
export const ageText = (a) => (a === 0 ? 'Livre' : `${a} anos`);

export const ADULT_RE = /(adult|xxx|\+\s?18|18\s?\+|porn|er[oó]tic)/i;

const US = {
  G: 0, 'TV-Y': 0, 'TV-Y7': 0, 'TV-G': 0,
  PG: 10, 'TV-PG': 10, 'PG-13': 12, 'TV-14': 14,
  R: 16, 'NC-17': 18, 'TV-MA': 18,
};

export function ratingToAge(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  if (!s || ['N/A', 'NOT RATED', 'UNRATED', 'NR'].includes(s)) return null;
  if (['L', 'LIVRE', 'AL', 'ER', 'LIV'].includes(s)) return 0;
  if (US[s] != null) return US[s];
  const m = s.match(/(10|12|14|16|18)/);
  return m ? +m[1] : null;
}
