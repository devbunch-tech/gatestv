// Edição de assinantes: onde o app valida a assinatura.
// O endereço pode ser trocado na hora de gerar o app: VITE_LICENSE_API=https://... npm run build:assinantes
export const LICENSE_API_URL = (import.meta.env.VITE_LICENSE_API || 'https://licenca.seudominio.com.br').replace(/\/$/, '');

// Versões de TESTE (npm run build:teste): selo "TESTE", servidor de licenças da rede local e
// opção de trocar o endereço do servidor na tela de ativação.
export const IS_TEST = import.meta.env.VITE_TEST === '1';

// Chave PÚBLICA do servidor de licenças (node license-server/cli.mjs chave). Só confere assinaturas;
// a chave privada fica apenas no servidor. Se trocar a chave do servidor, atualize aqui.
// As versões de teste recebem a chave do servidor de teste (VITE_LICENSE_PUBKEY).
const PRODUCTION_KEY = {
  kty: 'EC',
  crv: 'P-256',
  x: '-eu6Y2_VKtQkJSc76ZSaqnRW-VJempNAZzb5rGokQ_A',
  y: 'i_KEE3VSC-c5iqYiGCo2tgxNn6kJmDrFVEMuDWl6ZHA',
};
export const LICENSE_PUBLIC_KEY = import.meta.env.VITE_LICENSE_PUBKEY ? JSON.parse(import.meta.env.VITE_LICENSE_PUBKEY) : PRODUCTION_KEY;

// Endereço em uso: nas versões de teste, pode ser trocado na tela de ativação.
const API_KEY = 'gates:licenseApi';
export function licenseApiUrl() {
  if (IS_TEST) {
    // Aberto pelo próprio servidor de teste (http://.../app/): usa esse mesmo servidor.
    if (typeof location !== 'undefined' && location.pathname.startsWith('/app/') && location.port === '8787') return location.origin;
    try {
      const v = localStorage.getItem(API_KEY);
      if (v) return v;
    } catch {
      /* sem armazenamento */
    }
  }
  return LICENSE_API_URL;
}
export function setLicenseApiUrl(url) {
  try {
    const v = String(url || '').trim().replace(/\/$/, '');
    if (!v || v === LICENSE_API_URL) localStorage.removeItem(API_KEY);
    else localStorage.setItem(API_KEY, /^https?:\/\//.test(v) ? v : 'http://' + v);
  } catch {
    /* sem armazenamento */
  }
}

// Link da loja para renovar (o servidor pode mandar outro em STORE_URL).
export const STORE_URL = import.meta.env.VITE_STORE_URL || '';

// Renova a licença ao abrir o app e depois a cada 6 horas.
export const REFRESH_HOURS = 6;
// Sem internet, a última licença continua valendo por mais estes dias depois de vencer.
export const OFFLINE_DAYS = 7;
