// Configuração do servidor de licenças (variáveis de ambiente ou arquivo .env ao lado do server.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carrega o .env (formato CHAVE=valor) sem dependências externas.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(process.env.GATES_ENV_FILE || path.join(root, '.env'));

const env = (k, d = '') => (process.env[k] ?? d).trim();
const num = (k, d) => (env(k) === '' ? d : Number(env(k)));
const list = (k) => env(k).split(',').map((s) => s.trim()).filter(Boolean);

// "GATES-MENSAL:30,GATES-ANUAL:365" -> [{ match: 'GATES-MENSAL', days: 30 }, ...]
const plans = (k) =>
  list(k).map((x) => {
    const [match, days] = x.split(':');
    return { match: match.trim().toUpperCase(), days: Number(days) || 30 };
  });

export const config = {
  root,
  port: num('PORT', 8787),
  host: env('HOST', '0.0.0.0'),
  // Endereço público deste servidor (usado no link da página de ativação mostrada na TV).
  publicUrl: env('PUBLIC_URL', 'http://localhost:8787').replace(/\/$/, ''),
  dataDir: path.resolve(root, env('DATA_DIR', './data')),

  // Quem confere os pagamentos: 'checkout' (checkout próprio + Asaas, padrão), 'nuvemshop' ou 'shopify'.
  storeProvider: env('STORE_PROVIDER', 'checkout').toLowerCase(),

  // ---------- Checkout próprio ----------
  checkout: {
    brand: env('BRAND_NAME', 'GATES! TV'),
    // Planos: id:Nome:preço:dias:ciclo  (ciclo do Asaas: MONTHLY, QUARTERLY, SEMIANNUALLY, YEARLY)
    plans: list('PLANS').length
      ? list('PLANS').map((p) => {
          const [id, name, price, days, cycle] = p.split(':');
          return { id: id.trim(), name: (name || id).trim(), price: Number(price) || 0, days: Number(days) || 30, cycle: (cycle || 'MONTHLY').trim().toUpperCase() };
        })
      : [
          { id: 'mensal', name: 'Mensal', price: 29.9, days: 30, cycle: 'MONTHLY' },
          { id: 'trimestral', name: 'Trimestral', price: 79.9, days: 90, cycle: 'QUARTERLY' },
          { id: 'anual', name: 'Anual', price: 299.0, days: 365, cycle: 'YEARLY' },
        ],
    // Links para baixar os apps (mostrados depois da compra). Ex.: https://seusite.com/GatesTV-TV.apk
    downloads: {
      tv: env('DOWNLOAD_TV'),
      tvLite: env('DOWNLOAD_TV_LITE'),
      phone: env('DOWNLOAD_PHONE'),
      phoneLite: env('DOWNLOAD_PHONE_LITE'),
      tablet: env('DOWNLOAD_TABLET'),
      windows: env('DOWNLOAD_WINDOWS'),
    },
    supportWhatsapp: env('SUPPORT_WHATSAPP'),
  },

  // ---------- Asaas (PIX, boleto e cartão; sem mensalidade) ----------
  asaas: {
    apiKey: env('ASAAS_API_KEY'),
    // sandbox (testes) ou production
    environment: env('ASAAS_ENV', 'sandbox').toLowerCase(),
    // Token que você define ao cadastrar o webhook no Asaas (chega no cabeçalho asaas-access-token).
    webhookToken: env('ASAAS_WEBHOOK_TOKEN'),
    // UNDEFINED = o cliente escolhe PIX, boleto ou cartão na fatura.
    billingType: env('ASAAS_BILLING_TYPE', 'UNDEFINED').toUpperCase(),
    // Apenas para testes.
    apiBase: env('ASAAS_API_BASE'),
  },

  nuvemshop: {
    // App da Nuvemshop (Portal de Parceiros): id da loja e token de acesso obtidos na instalação.
    storeId: env('NS_STORE_ID'),
    accessToken: env('NS_ACCESS_TOKEN'),
    // Segredo do app (client secret): valida a assinatura dos webhooks.
    appSecret: env('NS_APP_SECRET'),
    // A Nuvemshop exige um User-Agent com nome do app e e-mail de contato.
    userAgent: env('NS_USER_AGENT', 'GATES! TV Licencas (contato@seudominio.com.br)'),
    // Situações de pagamento que contam como pago (A CONFIRMAR: paid, partially_refunded…).
    paidStatuses: env('NS_PAID_STATUSES', 'paid,partially_refunded').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // Apenas para testes.
    apiBase: env('NS_API_BASE'),
  },

  shopify: {
    // loja.myshopify.com
    shop: env('SHOPIFY_SHOP').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    apiVersion: env('SHOPIFY_API_VERSION', '2026-07'),
    // Opção 1: token fixo do Admin API (shpat_...).
    adminToken: env('SHOPIFY_ADMIN_TOKEN'),
    // Opção 2: app do Dev Dashboard (client credentials) — o token é renovado sozinho.
    clientId: env('SHOPIFY_CLIENT_ID'),
    clientSecret: env('SHOPIFY_CLIENT_SECRET'),
    // Segredo para validar os webhooks (normalmente o "client secret" do app).
    webhookSecret: env('SHOPIFY_WEBHOOK_SECRET') || env('SHOPIFY_CLIENT_SECRET'),
    // Apenas para testes: substitui https://<loja>/admin/api/<versão>.
    apiBase: env('SHOPIFY_API_BASE'),
  },

  subscription: {
    // Quais itens do pedido contam como assinatura (qualquer uma das regras).
    productIds: list('SUBSCRIPTION_PRODUCT_IDS').map((x) => x.replace(/\D/g, '')),
    skuPrefixes: list('SUBSCRIPTION_SKU_PREFIXES').map((x) => x.toUpperCase()),
    // Duração de cada plano pelo SKU (prefixo). Sem regra: DEFAULT_PERIOD_DAYS.
    plans: plans('SUBSCRIPTION_PLANS'),
    defaultPeriodDays: num('DEFAULT_PERIOD_DAYS', 30),
    // Folga para a cobrança recorrente cair (horário/fuso) antes de considerar atrasado.
    toleranceHours: num('PAYMENT_TOLERANCE_HOURS', 36),
    // Depois de vencer: dias com aviso antes de suspender.
    graceDays: num('GRACE_DAYS', 4),
    // Tags de cliente no Shopify que forçam o estado.
    tagActive: env('TAG_ACTIVE', 'gates-liberado').toLowerCase(),
    tagBlocked: env('TAG_BLOCKED', 'gates-bloqueado').toLowerCase(),
  },

  license: {
    privateKeyPem: env('LICENSE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    // Padrão: dentro de DATA_DIR (produção: data/, teste: data-demo/).
    privateKeyFile: env('LICENSE_PRIVATE_KEY_FILE') ? path.resolve(root, env('LICENSE_PRIVATE_KEY_FILE')) : path.join(path.resolve(root, env('DATA_DIR', './data')), 'license-private.pem'),
    // Validade de cada token emitido (o app renova sozinho ao abrir e a cada poucas horas).
    tokenDays: num('TOKEN_DAYS', 3),
    maxDevices: num('MAX_DEVICES', 3),
    // Ressincroniza com o Shopify no login/renovação se o cadastro for mais antigo que isso.
    resyncMinutes: num('RESYNC_MINUTES', 30),
    // Configuração entregue ao app junto com a licença (ex.: chaves do TMDB/OMDb).
    appConfig: {
      tmdbKey: env('APP_TMDB_KEY'),
      omdbKey: env('APP_OMDB_KEY'),
      storeUrl: env('STORE_URL'),
      supportUrl: env('SUPPORT_URL'),
    },
  },

  adminToken: env('ADMIN_TOKEN'),
  // Origens liberadas para chamar a API (o app roda em http://127.0.0.1:<porta>).
  corsOrigins: list('CORS_ORIGINS'),
};

export function shopifyConfigured() {
  const s = config.shopify;
  return !!(s.shop && (s.adminToken || (s.clientId && s.clientSecret)));
}
