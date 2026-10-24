// Seções da tela inicial por plataforma de streaming. Os itens são identificados pela
// categoria (grupo) da fonte, ex.: "FILMES | NETFLIX", "Séries HBO Max", "(L) Séries Apple".
import { PLATFORMS } from './platforms';

export const PROVIDERS = Object.fromEntries(PLATFORMS.map((p) => [p.key, p]));

export const PROVIDER_ROWS = [
  { key: 'hbo-movie', title: 'Filmes HBO', type: 'movie', prov: 'hbo' },
  { key: 'hbo-series', title: 'Séries HBO', type: 'series', prov: 'hbo' },
  { key: 'netflix-movie', title: 'Filmes Netflix', type: 'movie', prov: 'netflix' },
  { key: 'netflix-series', title: 'Séries Netflix', type: 'series', prov: 'netflix' },
  { key: 'apple-movie', title: 'Filmes Apple TV', type: 'movie', prov: 'apple' },
  { key: 'apple-series', title: 'Séries Apple TV', type: 'series', prov: 'apple' },
  { key: 'telecine-movie', title: 'Filmes Telecine', type: 'movie', prov: 'telecine' },
  { key: 'crunchyroll-series', title: 'Séries Crunchyroll', type: 'series', prov: 'crunchyroll' },
  { key: 'prime-series', title: 'Séries Prime Video', type: 'series', prov: 'prime' },
  { key: 'prime-movie', title: 'Filmes Prime Video', type: 'movie', prov: 'prime' },
  { key: 'starz-series', title: 'Séries Starzplay - Lionsgate', type: 'series', prov: 'starz' },
  { key: 'universal-series', title: 'Séries Universal+', type: 'series', prov: 'universal' },
];

export const PROVIDER_ROW_LIMIT = 8;
export const HOME_CACHE_DAYS = 3;
