// Fontes e ajustes carregados automaticamente na PRIMEIRA abertura do app (instaladores de
// Windows e Android TV), para não digitar tudo pelo controle remoto. Depois disso, o que for
// alterado nas Configurações do app passa a valer.
// Atenção: estes dados ficam gravados dentro do instalador — não compartilhe o APK/EXE.
// No app de ASSINANTES (build com VITE_SUBSCRIBER=1) nada disso entra: o compilador remove
// estes valores e o assinante adiciona a própria lista; as chaves vêm do servidor de licenças.
const DEMO_BUILD = import.meta.env.VITE_DEMO === '1';
const SUBSCRIBER_BUILD = import.meta.env.VITE_SUBSCRIBER === '1' || DEMO_BUILD;

// Degustação: só canais de sinal aberto oficial (ver scripts/web-builds.mjs → demo-canais.m3u).
export const DEFAULT_SOURCES = DEMO_BUILD ? [{ name: 'Canais abertos', type: 'url', url: './demo-canais.m3u' }] : SUBSCRIBER_BUILD ? [] : [
  { name: 'Gates Lista', type: 'xtream', server: 'http://dnsflow.info', username: '777412455', password: '815624845', output: 'ts' },
];

// Ajustes iniciais.
export const DEFAULT_APP_SETTINGS = DEMO_BUILD
  ? { proxyMode: 'never', liveDelay: 0, curatedZap: false }
  : SUBSCRIBER_BUILD
  ? import.meta.env.VITE_PLATFORM || import.meta.env.VITE_WEB === '1'
    ? { proxyMode: 'never' }
    : {}
  : {
      tmdbKey: '27aa2f314716725de1e05120d5947fbc',
      omdbKey: 'f6e80753',
    };

// Conta que já abre logada no app instalado (precisa existir em src/config/accounts.js).
export const DEFAULT_LOGIN_EMAIL = SUBSCRIBER_BUILD ? '' : 'prsergiokent@gmail.com';
