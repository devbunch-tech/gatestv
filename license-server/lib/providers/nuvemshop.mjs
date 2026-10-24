// Conector da Nuvemshop (API v1: https://api.nuvemshop.com.br/v1/<store_id>).
// PRÉ-PRONTO: os detalhes finais (como a recorrência é cobrada, quais situações valem como pago)
// serão ajustados quando o fluxo na Nuvemshop for definido. Pontos a confirmar: "A CONFIRMAR".
//
// Autenticação: cabeçalho "Authentication: bearer <NS_ACCESS_TOKEN>" (sim, "Authentication") e um
// User-Agent identificando o app, exigido pela Nuvemshop.
// Escopos do app: read_customers, read_orders (e write_webhooks se usar "registrar-webhooks").
import crypto from 'node:crypto';
import { config } from '../config.mjs';

const ns = () => config.nuvemshop;
export const name = 'nuvemshop';
export const label = 'Nuvemshop';
export const configured = () => !!((ns().storeId && ns().accessToken) || ns().apiBase);

async function api(pathAndQuery, { method = 'GET', body } = {}) {
  const base = ns().apiBase || `https://api.nuvemshop.com.br/v1/${ns().storeId}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + pathAndQuery, {
      method,
      headers: {
        Authentication: `bearer ${ns().accessToken}`,
        'User-Agent': ns().userAgent,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Limite de requisições (429) ou instabilidade: espera e tenta de novo.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Nuvemshop HTTP ${res.status}`);
    return res.json();
  }
}

const PAID = () => new Set(ns().paidStatuses);
const REVERSED = new Set(['refunded', 'voided']);

function normalizeOrder(o) {
  const pay = String(o.payment_status || '').toLowerCase();
  return {
    id: String(o.id),
    // O cliente digita o número do pedido (ex.: #1001), não o id interno.
    name: '#' + (o.number ?? o.id),
    paidAt: Date.parse(o.paid_at || o.created_at),
    cancelled: String(o.status || '').toLowerCase() === 'cancelled' || REVERSED.has(pay) || !!o.cancelled_at,
    financial: PAID().has(pay) ? 'PAID' : pay.toUpperCase(),
    items: (o.products || []).map((p) => ({
      sku: p.sku || '',
      productId: String(p.product_id || ''),
      variantId: String(p.variant_id || ''),
      quantity: Number(p.quantity) || 1,
    })),
  };
}

const emailOf = (o) => o?.customer?.email || o?.contact_email || null;

// Cliente + pedidos pelo e-mail.
export async function fetchCustomerByEmail(email) {
  const want = String(email).trim().toLowerCase();
  const found = (await api(`/customers?q=${encodeURIComponent(want)}&per_page=50`)) || [];
  const c = found.find((x) => String(x.email || '').toLowerCase() === want);
  if (!c) return null;
  // A CONFIRMAR: filtro por cliente (customer_ids); sem ele, busca pelo e-mail e filtra aqui.
  let orders = (await api(`/orders?customer_ids=${c.id}&per_page=50`)) || [];
  if (!orders.length) orders = ((await api(`/orders?q=${encodeURIComponent(want)}&per_page=50`)) || []).filter((o) => String(emailOf(o) || '').toLowerCase() === want);
  // Tags: usamos a "nota" do cliente para liberar/bloquear manualmente (ex.: "gates-liberado").
  const tags = String(c.note || '').split(/[\s,;]+/).filter(Boolean);
  return { id: String(c.id), email: c.email, tags, orders: orders.map(normalizeOrder) };
}

export async function fetchOrderEmail(orderId) {
  return emailOf(await api(`/orders/${orderId}`));
}

// Webhooks: a Nuvemshop assina o corpo com HMAC-SHA256 (hex) usando o segredo do app,
// no cabeçalho x-linkedstore-hmac-sha256. O corpo traz só { store_id, event, id }.
export function verifyWebhook(req, raw) {
  const secret = ns().appSecret;
  const given = String(req.headers['x-linkedstore-hmac-sha256'] || '');
  if (!secret || !given) return false;
  const want = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(given.toLowerCase());
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function checkConnection() {
  const s = await api('/store');
  return { shop: s?.name?.pt || s?.name?.es || Object.values(s?.name || {})[0] || 'Nuvemshop', domain: s?.original_domain || s?.url_with_protocol || '', scopes: [] };
}

// Cadastra (ou confirma) os webhooks de pedido apontando para o servidor.
export const WEBHOOK_EVENTS = ['order/paid', 'order/updated', 'order/cancelled'];
export async function registerWebhooks(url) {
  const existing = (await api('/webhooks')) || [];
  const out = [];
  for (const event of WEBHOOK_EVENTS) {
    if (existing.some((w) => w.event === event && w.url === url)) {
      out.push({ topic: event, status: 'já existia' });
      continue;
    }
    try {
      await api('/webhooks', { method: 'POST', body: { event, url } });
      out.push({ topic: event, status: 'criado' });
    } catch (err) {
      out.push({ topic: event, status: 'erro: ' + err.message });
    }
  }
  return out;
}

// Instalação do app: a Nuvemshop redireciona com ?code=...; este código (vale poucos minutos)
// é trocado pelo token de acesso permanente e pelo id da loja.
export async function exchangeInstallCode(code, clientId, clientSecret) {
  const res = await fetch('https://www.tiendanube.com/apps/authorize/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(j.error_description || j.error || `HTTP ${res.status}`);
  return { accessToken: j.access_token, storeId: String(j.user_id), scope: j.scope };
}
