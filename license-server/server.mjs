// Servidor de licenças do GATES! TV: valida se o assinante está com a mensalidade paga na loja
// (Nuvemshop por padrão; Shopify como alternativa — ver lib/providers/)
// e entrega ao app uma licença assinada. Sem dependências externas (Node 18+).
//   node license-server/server.mjs           (configuração em license-server/.env)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './lib/config.mjs';
import { provider } from './lib/providers/index.mjs';
import * as ns from './lib/providers/nuvemshop.mjs';
import * as asaas from './lib/payments/asaas.mjs';
import { startCheckout } from './lib/checkout.mjs';
import { deleteCustomer, findCustomerByShopifyId, flush, getCustomer, listCustomers, normEmail, pairs, seenWebhook, upsertCustomer } from './lib/db.mjs';
import { fetchOrderEmail, normalizeWebhookOrder, verifyWebhook } from './lib/shopify.mjs';
import { evaluate, freshCustomer, issueLicense, loadKeys, matchOrder, publicJwk, readToken, recordOrder, registerDevice, syncCustomer } from './lib/license.mjs';

const MAX_BODY = 1 << 20;
const sendJson = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};
const fail = (res, code, error, message) => sendJson(res, code, { ok: false, error, message });

const MESSAGES = {
  bad_request: 'Dados incompletos.',
  not_found: 'Não encontramos uma assinatura com este e-mail e CPF (ou código de acesso).',
  device_limit: `Limite de ${config.license.maxDevices} aparelhos atingido. Remova um aparelho antigo para usar neste.`,
  invalid_token: 'Licença inválida. Entre novamente.',
  device_mismatch: 'Esta licença pertence a outro aparelho.',
  rate_limited: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  pair_expired: 'O código expirou. Gere um novo código no aparelho.',
  unavailable: 'Não foi possível consultar a loja agora. Tente novamente em instantes.',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const parseJson = (buf) => {
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    return null;
  }
};

// Limite simples de tentativas por IP (protege contra adivinhar números de pedido).
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
  h.push(now);
  hits.set(key, h);
  return h.length > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (!h.some((t) => now - t < 3600e3)) hits.delete(k);
  pairs.sweep();
}, 600e3).unref();

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  // O app roda em http://127.0.0.1:<porta> (TV/celular/Windows); outras origens só se liberadas.
  const ok = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*');
  if (!ok) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const device = (b) => ({
  id: String(b.deviceId || '').slice(0, 80),
  name: String(b.deviceName || '').slice(0, 80),
  platform: String(b.platform || '').slice(0, 20),
});

// ---------- App: ativação, renovação, saída ----------
async function activate(email, order, dev) {
  let c = await freshCustomer(email, { force: true });
  if (!matchOrder(c, order)) return { error: 'not_found' };
  const reg = registerDevice(email, dev);
  if (reg.error) return { error: reg.error };
  c = reg.customer;
  return { license: issueLicense(c, dev.id) };
}

async function apiActivate(req, res, b) {
  const email = normEmail(b.email);
  const dev = device(b);
  if (!email || !b.order || !dev.id) return fail(res, 400, 'bad_request', MESSAGES.bad_request);
  if (limited('act:' + clientIp(req), 10, 15 * 60e3) || limited('act:' + email, 8, 15 * 60e3)) return fail(res, 429, 'rate_limited', MESSAGES.rate_limited);
  const r = await activate(email, b.order, dev);
  if (r.error) return fail(res, r.error === 'not_found' ? 404 : 409, r.error, MESSAGES[r.error]);
  sendJson(res, 200, { ok: true, ...r.license });
}

async function apiRefresh(req, res, b) {
  const t = readToken(b.token);
  if (!t) return fail(res, 401, 'invalid_token', MESSAGES.invalid_token);
  if (b.deviceId && b.deviceId !== t.did) return fail(res, 401, 'device_mismatch', MESSAGES.device_mismatch);
  if (limited('ref:' + t.did, 30, 3600e3)) return fail(res, 429, 'rate_limited', MESSAGES.rate_limited);
  const c = await freshCustomer(t.email);
  if (!c) return fail(res, 401, 'invalid_token', MESSAGES.invalid_token);
  // Aparelho removido pelo administrador: precisa entrar de novo.
  if (!c.devices?.[t.did]) return fail(res, 401, 'invalid_token', MESSAGES.invalid_token);
  upsertCustomer(t.email, (x) => ((x.devices[t.did].lastSeen = Date.now()), x));
  sendJson(res, 200, { ok: true, ...issueLicense(c, t.did) });
}

async function apiLogout(req, res, b) {
  const t = readToken(b.token);
  if (t) upsertCustomer(t.email, (x) => (delete x.devices?.[t.did], x));
  sendJson(res, 200, { ok: true });
}

// ---------- Pareamento (TV): o aparelho mostra um código; o cliente confirma no celular ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');

async function pairStart(req, res, b) {
  const dev = device(b);
  if (!dev.id) return fail(res, 400, 'bad_request', MESSAGES.bad_request);
  if (limited('pair:' + clientIp(req), 20, 15 * 60e3)) return fail(res, 429, 'rate_limited', MESSAGES.rate_limited);
  let code;
  do code = newCode();
  while (pairs.byCode(code));
  const p = { id: crypto.randomBytes(18).toString('base64url'), code, device: dev, expiresAt: Date.now() + 30 * 60e3, license: null };
  pairs.put(p);
  sendJson(res, 200, { ok: true, pairId: p.id, code, expiresAt: p.expiresAt, url: `${config.publicUrl}/ativar`, qr: `${config.publicUrl}/ativar?c=${code}` });
}

function pairPoll(req, res, url) {
  const p = pairs.get(url.searchParams.get('id') || '');
  if (!p || p.expiresAt < Date.now()) return fail(res, 410, 'pair_expired', MESSAGES.pair_expired);
  if (!p.license) return sendJson(res, 200, { ok: true, pair: 'pending' });
  pairs.del(p.id);
  sendJson(res, 200, { ok: true, ...p.license, pair: 'done' });
}

async function pairConfirm(req, res, b) {
  const email = normEmail(b.email);
  const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!email || !b.order || !code) return fail(res, 400, 'bad_request', MESSAGES.bad_request);
  if (limited('act:' + clientIp(req), 10, 15 * 60e3)) return fail(res, 429, 'rate_limited', MESSAGES.rate_limited);
  const p = pairs.byCode(code);
  if (!p) return fail(res, 410, 'pair_expired', MESSAGES.pair_expired);
  const r = await activate(email, b.order, p.device);
  if (r.error) return fail(res, r.error === 'not_found' ? 404 : 409, r.error, MESSAGES[r.error]);
  pairs.put({ ...p, license: r.license });
  sendJson(res, 200, { ok: true, status: r.license.status, device: p.device.name });
}

// ---------- Checkout próprio ----------
const publicPlans = () => config.checkout.plans.map(({ id, name, price, days }) => ({ id, name, price, days }));

// ---------- Área do assinante (site) ----------
// Entrada com e-mail + CPF (ou código de acesso). Mostra só os dados da própria assinatura.
async function accountFor(req, b) {
  const email = normEmail(b.email);
  if (!email || !b.doc) return { http: 400, error: 'bad_request' };
  if (limited('acc:' + clientIp(req), 20, 15 * 60e3) || limited('acc:' + email, 12, 15 * 60e3)) return { http: 429, error: 'rate_limited' };
  const c = await freshCustomer(email);
  if (!c || !matchOrder(c, b.doc)) return { http: 404, error: 'not_found' };
  return { c };
}
const accountView = (c) => {
  const st = evaluate(c);
  const plan = config.checkout.plans.find((p) => p.id === c.plan);
  return {
    name: c.name || '',
    email: c.email,
    accessCode: c.accessCode || null,
    plan: plan ? { name: plan.name, price: plan.price } : null,
    status: st.status,
    reason: st.reason,
    paidUntil: st.paidUntil,
    suspendAt: st.suspendAt,
    payUrl: st.status !== 'active' ? c.lastInvoiceUrl || null : null,
    renewUrl: `/assinar?email=${encodeURIComponent(c.email)}`,
    cancelled: !!c.cancelledAt,
    canCancel: !!Object.keys(c.gateway?.subscriptions || {}).length && !c.cancelledAt,
    devices: Object.entries(c.devices || {}).map(([id, d]) => ({ id, name: d.name, platform: d.platform, lastSeen: d.lastSeen })),
    maxDevices: config.license.maxDevices,
  };
};
async function apiAccount(req, res, b, action) {
  const r = await accountFor(req, b);
  if (r.error) return fail(res, r.http, r.error, MESSAGES[r.error]);
  let c = r.c;
  if (action === 'device' && b.deviceId) c = upsertCustomer(c.email, (x) => (delete x.devices?.[String(b.deviceId)], x));
  if (action === 'cancel' && !c.cancelledAt) {
    // Cancela as próximas cobranças; o acesso continua até o fim do período já pago.
    for (const id of Object.keys(c.gateway?.subscriptions || {})) await asaas.cancelSubscription(id).catch((e) => console.warn('[cancelar]', e.message));
    c = upsertCustomer(c.email, (x) => ((x.cancelledAt = Date.now()), x));
  }
  sendJson(res, 200, { ok: true, account: accountView(c) });
}

// Arquivos do site (logo, ícone).
const ASSETS = { '/logo.png': 'image/png', '/icon.png': 'image/png', '/favicon.ico': 'image/png' };

async function apiCheckout(req, res, b) {
  if (limited('chk:' + clientIp(req), 8, 15 * 60e3)) return fail(res, 429, 'rate_limited', MESSAGES.rate_limited);
  if (!asaas.configured()) return fail(res, 503, 'unavailable', 'Pagamentos ainda não configurados.');
  try {
    const r = await startCheckout(b);
    if (r.errors) return sendJson(res, 400, { ok: false, error: 'invalid', errors: r.errors, message: Object.values(r.errors)[0] });
    sendJson(res, 200, { ok: true, code: r.code, invoiceUrl: r.invoiceUrl, plan: r.plan.name, downloads: config.checkout.downloads });
  } catch (err) {
    console.error('[checkout]', err.message);
    fail(res, 502, 'gateway', err.message.replace(/^Asaas: /, ''));
  }
}

// Asaas avisa cada pagamento (recebido, confirmado, vencido, estornado): ressincroniza o cliente.
async function webhookAsaas(req, res, raw) {
  if (!asaas.verifyWebhook(req)) return fail(res, 401, 'invalid_token', 'Webhook não autorizado.');
  const b = parseJson(raw) || {};
  if (seenWebhook(b.id ? 'asaas-' + b.id : `asaas-${b.event}-${b.payment?.id}-${b.payment?.status}`)) return sendJson(res, 200, { ok: true, duplicate: true });
  try {
    const custId = b.payment?.customer || b.subscription?.customer;
    if (custId) {
      const local = listCustomers().find((c) => c.gateway?.customerIds?.includes(custId));
      const email = local?.email || (await asaas.fetchCustomer(custId))?.email;
      if (email) await syncCustomer(email);
    }
    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('[webhook asaas]', b.event, err.message);
    sendJson(res, 500, { ok: false });
  }
}

// ---------- Webhooks da Nuvemshop ----------
// O corpo traz só { store_id, event, id }: o pedido é reconsultado na API e o cliente ressincronizado.
async function webhookNS(req, res, raw) {
  if (!ns.verifyWebhook(req, raw)) return fail(res, 401, 'invalid_hmac', 'Assinatura do webhook inválida.');
  const b = parseJson(raw) || {};
  const event = String(b.event || '');
  if (seenWebhook(`ns-${event}-${b.id}-${req.headers['x-request-id'] || ''}`)) return sendJson(res, 200, { ok: true, duplicate: true });
  try {
    if (event.startsWith('order/')) {
      const email = await ns.fetchOrderEmail(b.id);
      if (email) await syncCustomer(email);
    } else if (event === 'customers/redact') {
      // LGPD: apaga os dados do cliente.
      const cust = (b.customer?.email && getCustomer(b.customer.email)) || (b.customer?.id && findCustomerByShopifyId(b.customer.id));
      if (cust) deleteCustomer(cust.email);
    }
    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('[webhook nuvemshop]', event, err.message);
    sendJson(res, 500, { ok: false });
  }
}

// ---------- Webhooks do Shopify ----------
async function webhook(req, res, raw) {
  if (!verifyWebhook(raw, req.headers['x-shopify-hmac-sha256'])) return fail(res, 401, 'invalid_hmac', 'Assinatura do webhook inválida.');
  const topic = String(req.headers['x-shopify-topic'] || '');
  const id = String(req.headers['x-shopify-webhook-id'] || req.headers['x-shopify-event-id'] || '');
  // Responde rápido (o Shopify espera até 5 s) e ignora repetições.
  if (seenWebhook(id)) return sendJson(res, 200, { ok: true, duplicate: true });
  const body = parseJson(raw) || {};
  try {
    await handleWebhook(topic, body);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('[webhook]', topic, err.message);
    // 500 faz o Shopify tentar de novo mais tarde.
    sendJson(res, 500, { ok: false });
  }
}

async function handleWebhook(topic, b) {
  switch (topic) {
    case 'orders/paid':
    case 'orders/create':
    case 'orders/updated':
    case 'orders/cancelled': {
      const email = b.customer?.email || b.email || b.contact_email;
      if (!email) return;
      recordOrder(email, normalizeWebhookOrder(b), b.customer?.id);
      return;
    }
    case 'refunds/create': {
      // O reembolso não traz o e-mail: busca o pedido e ressincroniza o cliente.
      const email = await fetchOrderEmail(b.order_id);
      if (email) await syncCustomer(email);
      return;
    }
    case 'customers/update': {
      if (b.email) await syncCustomer(b.email).catch(() => upsertCustomer(b.email, { customerId: String(b.id) }));
      return;
    }
    case 'customers/redact': {
      // LGPD/GDPR: apaga os dados do cliente.
      const c = (b.customer?.email && getCustomer(b.customer.email)) || (b.customer?.id && findCustomerByShopifyId(b.customer.id));
      if (c) deleteCustomer(c.email);
      return;
    }
    case 'customers/data_request':
    case 'shop/redact':
    default:
      return;
  }
}

// ---------- Administração (Authorization: Bearer ADMIN_TOKEN) ----------
const isAdmin = (req) => {
  if (!config.adminToken) return false;
  const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(config.adminToken);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
};
const view = (c) => (c ? { ...c, state: evaluate(c) } : null);

async function admin(req, res, url, b) {
  if (!isAdmin(req)) return fail(res, 401, 'unauthorized', 'Token de administrador inválido.');
  const parts = url.pathname.split('/').filter(Boolean).slice(2); // ["customers", email, ...]
  if (parts[0] === 'summary') {
    const all = listCustomers().map(view);
    const count = (st) => all.filter((c) => c.state.status === st).length;
    return sendJson(res, 200, { ok: true, total: all.length, active: count('active'), grace: count('grace'), suspended: count('suspended'), store: provider.label, connected: provider.configured(), plans: publicPlans() });
  }
  if (parts[0] !== 'customers') return fail(res, 404, 'not_found', 'Rota inexistente.');
  // Novo assinante manual (ex.: venda por fora, cortesia): { email, name, until: "2026-12-31" }
  if (!parts[1] && req.method === 'POST') {
    if (!b.email) return fail(res, 400, 'bad_request', 'Informe o e-mail.');
    const code = getCustomer(b.email)?.accessCode || 'GTV-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const c = upsertCustomer(b.email, (x) => ({ ...x, name: b.name || x.name || '', accessCode: code, override: 'active', overrideSource: 'admin', overrideUntil: b.until ? Date.parse(b.until + 'T23:59:59') : 0 }));
    return sendJson(res, 200, { ok: true, customer: view(c) });
  }
  const email = parts[1] ? normEmail(decodeURIComponent(parts[1])) : '';
  if (!email) {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    return sendJson(res, 200, { ok: true, customers: listCustomers().filter((c) => !q || c.email.includes(q)).map(view) });
  }
  if (parts[2] === 'cancel' && req.method === 'POST') {
    const c = getCustomer(email);
    for (const id of Object.keys(c?.gateway?.subscriptions || {})) await asaas.cancelSubscription(id).catch((e) => console.warn('[cancelar]', e.message));
    return sendJson(res, 200, { ok: true, customer: view(upsertCustomer(email, (x) => ((x.cancelledAt = Date.now()), x))) });
  }
  if (parts[2] === 'sync' && req.method === 'POST') return sendJson(res, 200, { ok: true, customer: view(await syncCustomer(email)) });
  if (parts[2] === 'devices' && parts[3] && req.method === 'DELETE') {
    const c = upsertCustomer(email, (x) => (delete x.devices?.[decodeURIComponent(parts[3])], x));
    return sendJson(res, 200, { ok: true, customer: view(c) });
  }
  if (req.method === 'POST') {
    // { override: "active" | "blocked" | null, overrideUntil: "2026-12-31", paidUntil: "2026-11-30" }
    const c = upsertCustomer(email, (x) => {
      if ('override' in b) {
        x.override = b.override || null;
        x.overrideSource = 'admin';
      }
      if ('overrideUntil' in b) x.overrideUntil = b.overrideUntil ? Date.parse(b.overrideUntil) : 0;
      if ('paidUntil' in b) x.paidUntil = b.paidUntil ? Date.parse(b.paidUntil) : 0;
      if ('note' in b) x.note = String(b.note || '');
      return x;
    });
    return sendJson(res, 200, { ok: true, customer: view(c) });
  }
  if (req.method === 'DELETE') {
    deleteCustomer(email);
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 200, { ok: true, customer: view(getCustomer(email)) });
}

// ---------- Rotas ----------
const ativarHtml = path.join(config.root, 'public', 'ativar.html');
function page(res, file) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  res.end(fs.readFileSync(path.join(config.root, 'public', file)));
}

export function createServer() {
  loadKeys();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    cors(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    try {
      const raw = req.method === 'POST' || req.method === 'DELETE' ? await readBody(req) : Buffer.alloc(0);
      const p = url.pathname;
      if (p === '/webhooks/shopify' && req.method === 'POST') return await webhook(req, res, raw);
      if (p === '/webhooks/asaas' && req.method === 'POST') return await webhookAsaas(req, res, raw);
      if (p === '/webhooks/nuvemshop' && req.method === 'POST') return await webhookNS(req, res, raw);
      const b = parseJson(raw);
      if (b === null) return fail(res, 400, 'bad_request', 'JSON inválido.');
      if (p === '/health') return sendJson(res, 200, { ok: true, store: provider.name, connected: provider.configured(), shopify: provider.name === 'shopify' && provider.configured(), time: Date.now() });
      if (p === '/api/v1/public-key') return sendJson(res, 200, { ok: true, jwk: publicJwk });
      if (p === '/api/v1/plans')
        return sendJson(res, 200, { ok: true, brand: config.checkout.brand, plans: publicPlans(), downloads: config.checkout.downloads, support: config.checkout.supportWhatsapp || '', maxDevices: config.license.maxDevices, graceDays: config.subscription.graceDays });
      if (p === '/api/v1/account' && req.method === 'POST') return await apiAccount(req, res, b);
      if (p === '/api/v1/account/device' && req.method === 'POST') return await apiAccount(req, res, b, 'device');
      if (p === '/api/v1/account/cancel' && req.method === 'POST') return await apiAccount(req, res, b, 'cancel');
      if (p === '/' || p === '/index.html') return page(res, 'index.html');
      if (p === '/conta' || p === '/conta/') return page(res, 'conta.html');
      if (ASSETS[p]) {
        res.writeHead(200, { 'Content-Type': ASSETS[p], 'Cache-Control': 'public, max-age=86400' });
        return res.end(fs.readFileSync(path.join(config.root, 'public', p === '/favicon.ico' ? 'icon.png' : p.slice(1))));
      }
      if (p === '/api/v1/checkout' && req.method === 'POST') return await apiCheckout(req, res, b);
      if (p === '/assinar' || p === '/assinar/') return page(res, 'assinar.html');
      if (p === '/admin' || p === '/admin/') return page(res, 'admin.html');
      if (p === '/api/v1/activate' && req.method === 'POST') return await apiActivate(req, res, b);
      if (p === '/api/v1/refresh' && req.method === 'POST') return await apiRefresh(req, res, b);
      if (p === '/api/v1/logout' && req.method === 'POST') return await apiLogout(req, res, b);
      if (p === '/api/v1/pair/start' && req.method === 'POST') return await pairStart(req, res, b);
      if (p === '/api/v1/pair/poll') return pairPoll(req, res, url);
      if (p === '/api/v1/pair/confirm' && req.method === 'POST') return await pairConfirm(req, res, b);
      if (p.startsWith('/admin/api/')) return await admin(req, res, url, b || {});
      if (p === '/ativar' || p === '/ativar/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(fs.readFileSync(ativarHtml));
      }
      fail(res, 404, 'not_found', 'Rota inexistente.');
    } catch (err) {
      console.error('[erro]', req.method, url.pathname, err);
      if (!res.headersSent) fail(res, 503, 'unavailable', MESSAGES.unavailable);
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`GATES! TV — servidor de licenças em http://${config.host}:${config.port}`);
    console.log(provider.configured() ? `Loja: ${provider.label}` : `Aviso: ${provider.label} ainda não configurada (veja .env.example).`);
    console.log('Chave pública (cole em src/config/license.js):', JSON.stringify(publicJwk));
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (flush(), process.exit(0)));
}
