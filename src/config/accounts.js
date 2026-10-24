import { EDITION } from '../lib/device';

// Edição "admin" (APK Celular Admin): um único perfil, sem foto, identificado pelas letras "ADM".
const ADMIN_PROFILES = [{ id: 'sergio-admin', name: 'Admin', initials: 'ADM', emoji: '', color: '#ec0b43', master: true }];

// Contas habilitadas. A senha NÃO fica aqui: guardamos apenas sal + hash (ver src/lib/sha256.js).
// Para trocar a senha: node scripts/hash-password.mjs "NovaSenha" e cole salt/hash abaixo.
// App de assinantes: nenhuma conta da família vai junto (o compilador remove esta lista).
const FAMILY_ACCOUNTS = import.meta.env.VITE_SUBSCRIBER === '1' || import.meta.env.VITE_DEMO === '1' ? [] : [
  {
    id: 'sergio',
    email: 'prsergiokent@gmail.com',
    name: 'Sergio',
    salt: '05cba421d5df1fef6c0c7895e8140b04',
    hash: '4b6011a22bddc0565f49c5bc6014336f0a20532ca378d5c523a64210f4902cdc',
    // Perfis da conta. O primeiro é o master: o que ele oculta ou exclui vale para todos.
    // Ao aumentar "profilesVersion", foto e "infantil" destes perfis são reaplicados nos aparelhos.
    profilesVersion: 2,
    profiles: [
      { id: 'sergio-master', name: 'Sergio e Paula', emoji: '😎', color: '#ec0b43', master: true, photo: '/avatars/sergio-paula.png', photoPos: '50% 35%' },
      { id: 'sergio-leticia', name: 'Leticia', emoji: '🦄', color: '#a855f7', photo: '/avatars/leticia.jpg', photoPos: '50% 18%' },
      { id: 'sergio-melissa', name: 'Melissa', emoji: '🐱', color: '#ec4899', photo: '/avatars/melissa.jpg', photoPos: '50% 22%', kids: true, maxAge: 10, hideRestricted: true },
      { id: 'sergio-marina', name: 'Marina', emoji: '🌟', color: '#f59e0b', photo: '/avatars/marina.png', photoPos: '50% 22%', kids: true, maxAge: 10, hideRestricted: true },
      { id: 'sergio-clark', name: 'Clark', emoji: '🐶', color: '#0ea5e9', photo: '/avatars/clark.png', photoPos: '50% 25%', kids: true, maxAge: 10, hideRestricted: true },
    ],
  },
];

// Edição admin: conta local sem e-mail e sem senha — instalou, já está usando.
const ADMIN_ACCOUNT = { id: 'admin', name: 'Admin', noLogin: true, profilesVersion: 1, profiles: ADMIN_PROFILES };

// Degustação: visitante sem login.
const DEMO_ACCOUNT = { id: 'demo', name: 'Visitante', noLogin: true, profilesVersion: 1, profiles: [{ id: 'demo-visitante', name: 'Visitante', emoji: '👀', color: '#ec0b43', master: true }] };

export const ACCOUNTS = EDITION === 'demo' ? [DEMO_ACCOUNT] : EDITION === 'admin' ? [ADMIN_ACCOUNT] : FAMILY_ACCOUNTS;
