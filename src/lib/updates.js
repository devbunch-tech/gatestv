// "Procurar atualizações": a mesma tela para todas as plataformas.
// Android (GatesAndroid.otaInfo/otaCheck/otaApply) e Windows (GatesDesktop.ota*) baixam a interface
// nova em segundo plano (OtaUpdater.java / electron/ota.cjs); a versão web só precisa recarregar.
// Estados: idle | checking | downloading | ready | uptodate | native (precisa de app novo) | error.
import { useEffect, useState } from 'react';
import { SMART_TV, WEB, hasNative, native } from './device';

/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
// Página "Minha conta" do site, onde o assinante baixa o APK / instalador novo.
export const ACCOUNT_URL = (import.meta.env.VITE_LICENSE_API || 'https://gatesapptv.pages.dev').replace(/\/$/, '') + '/conta';

const desktop = () => (typeof window !== 'undefined' ? window.GatesDesktop : null);
export const platform = () => (hasNative('otaInfo') ? 'android' : desktop()?.otaInfo ? 'desktop' : WEB ? 'web' : SMART_TV ? 'smarttv' : 'other');

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const readOta = () =>
  fetch('./ota.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

// Versão web: a interface aberta agora (lida uma vez) comparada com a que o site publica.
let loaded = null;
const loadedOta = () => (loaded ||= readOta());
let webState = { state: 'idle', checkedAt: 0, error: '' };

async function webCheck() {
  webState = { state: 'checking', checkedAt: webState.checkedAt, error: '' };
  const [cur, pub] = await Promise.all([loadedOta(), readOta()]);
  if (!pub) webState = { state: 'error', error: 'sem conexão com o site', checkedAt: Date.now() };
  else webState = { state: cur && pub.build > cur.build ? 'ready' : 'uptodate', checkedAt: Date.now(), error: '', available: pub };
}

// Situação atual. App antigo (sem a ponte nova): enabled = false e a tela só mostra a versão.
export async function getInfo() {
  const p = platform();
  if (p === 'android') return parse(native('otaInfo')) || { enabled: false };
  if (p === 'desktop') return (await desktop().otaInfo().catch(() => null)) || { enabled: false };
  if (p === 'web') return { enabled: true, current: await loadedOta(), ...webState, pending: webState.state === 'ready' ? webState.available : null };
  return { enabled: false, current: await loadedOta() };
}

export async function checkNow() {
  const p = platform();
  if (p === 'android') return native('otaCheck');
  if (p === 'desktop') return desktop().otaCheck();
  if (p === 'web') return webCheck();
  return false;
}

// Passa a usar a versão baixada: recarrega a tela (Android/web) ou reabre o app (Windows).
export function applyNow() {
  const p = platform();
  if (p === 'android') native('otaApply');
  else if (p === 'desktop') desktop().otaApply();
  else location.reload();
}

export function openAccount() {
  if (hasNative('openUrl')) native('openUrl', ACCOUNT_URL);
  else window.open(ACCOUNT_URL, '_blank');
}

// Há algo para o usuário fazer (versão pronta ou app novo para instalar)? Usado no aviso do menu.
export const needsAction = (info) => !!info && (info.state === 'ready' || info.state === 'native');

// Aviso no menu: consulta a situação a cada minuto (Android e Windows já procuram sozinhos;
// a versão web procura no site a cada 6 horas).
export function useUpdateAlert() {
  const [alert, setAlert] = useState(false);
  useEffect(() => {
    let alive = true;
    const look = () => getInfo().then((i) => alive && setAlert(needsAction(i)));
    const web = platform() === 'web';
    const first = setTimeout(() => (web ? checkNow().then(look) : look()), web ? 20e3 : 2e3);
    const every = setInterval(look, 60e3);
    const webEvery = web ? setInterval(checkNow, 6 * 3600e3) : 0;
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(every);
      clearInterval(webEvery);
    };
  }, []);
  return alert;
}
