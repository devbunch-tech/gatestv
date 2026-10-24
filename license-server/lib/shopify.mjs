// Conexão com o Shopify Admin API (GraphQL) e validação dos webhooks.
// Escopos necessários no app do Shopify: read_customers, read_orders.
import crypto from 'node:crypto';
import { config, shopifyConfigured } from './config.mjs';

const s = config.shopify;
let cached = { token: s.adminToken || '', exp: s.adminToken ? Infinity : 0 };

// Token de acesso: fixo (SHOPIFY_ADMIN_TOKEN) ou obtido por client credentials (app do Dev Dashboard),
// renovado automaticamente antes de expirar.
async function accessToken() {
  if (cached.token && cached.exp > Date.now() + 60e3) return cached.token;
  if (!s.clientId || !s.clientSecret) throw new Error('Shopify não configurado (SHOPIFY_ADMIN_TOKEN ou SHOPIFY_CLIENT_ID/SECRET).');
  const res = await fetch(`https://${s.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: s.clientId, client_secret: s.clientSecret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Shopify recusou as credenciais do app (HTTP ${res.status}).`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 86400) * 1000 };
  return cached.token;
}

export async function graphql(query, variables = {}) {
  if (!shopifyConfigured() && !s.apiBase) throw new Error('Shopify não configurado.');
  const base = s.apiBase || `https://${s.shop}/admin/api/${s.apiVersion}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': s.apiBase ? 'test' : await accessToken() },
      body: JSON.stringify({ query, variables }),
    });
    // Limite de requisições: espera e tenta de novo.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 && !s.adminToken && attempt < 1) {
      cached = { token: '', exp: 0 };
      continue;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
    const throttled = j.errors?.some?.((e) => e.extensions?.code === 'THROTTLED');
    if (throttled && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (j.errors?.length) throw new Error('Shopify: ' + j.errors.map((e) => e.message).join('; '));
    return j.data;
  }
}

const ORDER_FIELDS = `
  id name processedAt createdAt cancelledAt displayFinancialStatus
  lineItems(first: 30) { nodes { sku quantity product { id } variant { id } } }`;

// Cliente + últimos pedidos, pelo e-mail.
export async function fetchCustomerByEmail(email) {
  const q = `query($q: String!) {
    customers(first: 1, query: $q) {
      nodes { id email tags orders(first: 50, sortKey: PROCESSED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } } }
    }
  }`;
  const data = await graphql(q, { q: `email:"${String(email).replace(/"/g, '')}"` });
  const c = data?.customers?.nodes?.[0];
  if (!c) return null;
  return { id: c.id, email: c.email, tags: c.tags || [], orders: (c.orders?.nodes || []).map(normalizeGqlOrder) };
}

// E-mail do cliente de um pedido (usado nos webhooks de reembolso).
export async function fetchOrderEmail(orderId) {
  const gid = String(orderId).startsWith('gid://') ? orderId : `gid://shopify/Order/${orderId}`;
  const data = await graphql(`query($id: ID!) { order(id: $id) { email customer { email } } }`, { id: gid });
  return data?.order?.customer?.email || data?.order?.email || null;
}

const gidNum = (g) => String(g || '').split('/').pop();

function normalizeGqlOrder(o) {
  return {
    id: gidNum(o.id),
    name: o.name,
    paidAt: Date.parse(o.processedAt || o.createdAt),
    cancelled: !!o.cancelledAt,
    financial: String(o.displayFinancialStatus || '').toUpperCase(),
    items: (o.lineItems?.nodes || []).map((li) => ({ sku: li.sku || '', productId: gidNum(li.product?.id), variantId: gidNum(li.variant?.id), quantity: li.quantity || 1 })),
  };
}

// Pedido no formato do webhook REST (orders/paid, orders/cancelled, orders/updated).
export function normalizeWebhookOrder(o) {
  return {
    id: String(o.id),
    name: o.name,
    paidAt: Date.parse(o.processed_at || o.created_at),
    cancelled: !!o.cancelled_at,
    financial: String(o.financial_status || '').toUpperCase(),
    items: (o.line_items || []).map((li) => ({ sku: li.sku || '', productId: String(li.product_id || ''), variantId: String(li.variant_id || ''), quantity: li.quantity || 1 })),
  };
}

// Valida a assinatura HMAC do webhook (cabeçalho X-Shopify-Hmac-Sha256, corpo bruto).
export function verifyWebhook(rawBody, hmacHeader) {
  if (!s.webhookSecret || !hmacHeader) return false;
  const digest = crypto.createHmac('sha256', s.webhookSecret).update(rawBody).digest();
  const given = Buffer.from(String(hmacHeader), 'base64');
  return given.length === digest.length && crypto.timingSafeEqual(given, digest);
}

// Teste de conexão: nome da loja e escopos liberados para o app.
export async function checkConnection() {
  const data = await graphql(`{ shop { name myshopifyDomain } appInstallation { accessScopes { handle } } }`);
  return { shop: data.shop?.name, domain: data.shop?.myshopifyDomain, scopes: (data.appInstallation?.accessScopes || []).map((x) => x.handle) };
}

// Cadastra (ou confirma) os webhooks que o servidor de licenças usa.
export const WEBHOOK_TOPICS = ['ORDERS_PAID', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'REFUNDS_CREATE', 'CUSTOMERS_UPDATE'];
export async function registerWebhooks(callbackUrl) {
  const existing = await graphql(`{ webhookSubscriptions(first: 100) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`);
  const have = new Set(
    (existing.webhookSubscriptions?.nodes || []).filter((w) => w.endpoint?.callbackUrl === callbackUrl).map((w) => w.topic)
  );
  const results = [];
  for (const topic of WEBHOOK_TOPICS) {
    if (have.has(topic)) {
      results.push({ topic, status: 'já existia' });
      continue;
    }
    const r = await graphql(
      `mutation($topic: WebhookSubscriptionTopic!, $url: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
          webhookSubscription { id } userErrors { field message }
        }
      }`,
      { topic, url: callbackUrl }
    );
    const errs = r.webhookSubscriptionCreate?.userErrors || [];
    results.push({ topic, status: errs.length ? 'erro: ' + errs.map((e) => e.message).join('; ') : 'criado' });
  }
  return results;
}
