// Quanto conteúdo cada tela carrega ao mesmo tempo. O modo LITE (aparelhos mais simples) reduz
// os números, troca as fileiras por categorias em blocos e usa imagens menores.
import { LITE } from '../lib/device';

const NORMAL = {
  homeRecent: 10, // filmes/séries recentes no Início
  providerRows: 99, // quantas fileiras de plataformas no Início
  providerRowItems: 8,
  homeGames: 10,
  featuredGames: 8,
  libraryTiles: false, // Filmes/Séries em blocos de categoria em vez de fileiras
  libraryRowItems: 10,
  libraryRecent: 8,
  heroItems: 5,
  heroRotate: true,
  gridPage: 60,
  gridMargin: '800px',
  liveBatch: 100,
  searchLimit: 40,
  personLimit: 120,
};

const LITE_PERF = {
  homeRecent: 6,
  providerRows: 4,
  providerRowItems: 6,
  homeGames: 6,
  featuredGames: 3,
  libraryTiles: true,
  libraryRowItems: 6,
  libraryRecent: 6,
  heroItems: 3,
  heroRotate: false,
  gridPage: 24,
  gridMargin: '300px',
  liveBatch: 40,
  searchLimit: 15,
  personLimit: 40,
};

export const PERF = LITE ? LITE_PERF : NORMAL;

// Imagens do TMDB: tamanhos menores no LITE (menos memória e download).
const LITE_IMG = { w1280: 'w780', w780: 'w500', w500: 'w342', original: 'w780' };
export const imgSize = (size) => (LITE ? LITE_IMG[size] || size : size);
