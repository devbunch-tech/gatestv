// Plataformas de streaming reconhecidas pelo nome da categoria da fonte
// (ex.: "Séries Netflix", "(L) Netflix", "Netflix Lançamentos 2026", "HBO Max").
// O teste é feito no nome da categoria normalizado (minúsculas, sem acentos).
// "domain" é usado para buscar o ícone pequeno; a faixa de Filmes/Séries usa o logo oficial
// guardado em public/platform-logos/<key>.png. A ordem da lista é a ordem da faixa.
export const PLATFORMS = [
  { key: 'netflix', name: 'Netflix', domain: 'netflix.com', test: (g) => /netflix/.test(g) },
  { key: 'prime', name: 'Prime Video', domain: 'primevideo.com', test: (g) => /prime ?video|amazon/.test(g) },
  { key: 'disney', name: 'Disney+', domain: 'disneyplus.com', test: (g) => /disney/.test(g) },
  { key: 'hbo', name: 'HBO Max', domain: 'max.com', test: (g) => /\bhbo\b|\bmax\b/.test(g) },
  { key: 'apple', name: 'Apple TV', domain: 'tv.apple.com', test: (g) => /\bapple\b/.test(g) },
  { key: 'paramount', name: 'Paramount+', domain: 'paramountplus.com', test: (g) => /paramount/.test(g) },
  { key: 'globoplay', name: 'Globoplay', domain: 'globoplay.globo.com', test: (g) => /globo ?play/.test(g) },
  { key: 'universal', name: 'Universal+', domain: 'universalplus.com', test: (g) => /universal/.test(g) },
  { key: 'crunchyroll', name: 'Crunchyroll', domain: 'crunchyroll.com', test: (g) => /crunchyroll/.test(g) },
  { key: 'starz', name: 'Starzplay - Lionsgate', domain: 'lionsgateplus.com', test: (g) => /starz|lionsgate/.test(g) },
  { key: 'star', name: 'Star+', domain: 'starplus.com', test: (g) => /\bstar ?\+|\bstar plus\b/.test(g) },
  { key: 'discovery', name: 'Discovery+', domain: 'discoveryplus.com', test: (g) => /discovery/.test(g) },
  { key: 'brasilparalelo', name: 'Brasil Paralelo', domain: 'brasilparalelo.com.br', test: (g) => /brasil paralelo/.test(g) },
  // Categorias "Exclusivo" / "Séries Exclusivas" da lista aparecem como GATES! TV.
  { key: 'gates', name: 'GATES! TV', domain: 'gatesapptv.pages.dev', test: (g) => /exclusiv/.test(g) },
  // Reconhecidas, mas fora da faixa de logos.
  { key: 'telecine', name: 'Telecine', domain: 'telecineplay.com.br', test: (g) => /telecine/.test(g), noStrip: true },
  { key: 'looke', name: 'Looke', domain: 'looke.com.br', test: (g) => /\blooke\b/.test(g), noStrip: true },
];

export const normGroup = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const platformOf = (group) => {
  const g = normGroup(group);
  return PLATFORMS.find((p) => p.test(g)) || null;
};

export const platformLogo = (p) => (p ? `https://www.google.com/s2/favicons?domain=${p.domain}&sz=64` : '');
// Logo oficial (horizontal) usado na faixa de plataformas de Filmes e Séries.
export const platformWordmark = (p) => (p && !p.noStrip ? `./platform-logos/${p.key}.png` : '');
