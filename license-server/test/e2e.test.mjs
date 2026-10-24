// Teste de ponta a ponta com um "Shopify falso": node --test license-server/test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY = 864e5;
const SECRET = 'segredo-de-teste';
const shop = new Map(); // email -> { id, tags, orders: [] }
const gqlOrder = (o) => ({
  id: `gid://shopify/Order/${o.id}`,
  name: o.name,
  processedAt: new Date(o.paidAt).toISOString(),
  createdAt: new Date(o.paidAt).toISOString(),
  cancelledAt: o.cancelled ? new Date().toISOString() : null,
  displayFinancialStatus: o.financial || 'PAID',
  lineItems: { nodes: [{ sku: o.sku || 'GATES-MENSAL', quantity: 1, product: { id: 'gid://shopify/Product/777' }, variant: { id: 'gid://shopify/ProductVariant/1' } }] },
});
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { query, variables } = JSON.parse(body);
    let data = {};
    if (query.includes('customers(')) {
      const email = /email:"([^"]+)"/.exec(variables.q)?.[1];
      const c = shop.get(email);
      data = { customers: { nodes: c ? [{ id: `gid://shopify/Customer/${c.id}`, email, tags: c.tags, orders: { nodes: c.orders.map(gqlOrder) } }] : [] } };
    } else if (query.includes('order(')) {
      const id = variables.id.split('/').pop();
      const email = [...shop].find(([, c]) => c.orders.some((o) => String(o.id) === id))?.[0];
      data = { order: { email, customer: { email } } };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data }));
  });
});

let base, server, mod;
before(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-lic-'));
  Object.assign(process.env, {
    GATES_ENV_FILE: path.join(dir, 'nao-existe.env'),
    DATA_DIR: dir,
    STORE_PROVIDER: 'shopify',
    SHOPIFY_API_BASE: `http://127.0.0.1:${mock.address().port}`,
    SHOPIFY_WEBHOOK_SECRET: SECRET,
    SUBSCRIPTION_SKU_PREFIXES: 'GATES',
    SUBSCRIPTION_PLANS: 'GATES-MENSAL:30,GATES-ANUAL:365',
    PAYMENT_TOLERANCE_HOURS: '36',
    GRACE_DAYS: '4',
    MAX_DEVICES: '2',
    ADMIN_TOKEN: 'admin-teste',
    APP_TMDB_KEY: 'tmdb-do-servidor',
  });
  mod = await import('../server.mjs');
  server = mod.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  mock.close();
});

const post = async (p, body, headers = {}) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { ...(await r.json()), http: r.status };
};

// Confere a licença do jeito que o app confere (WebCrypto + chave pública).
async function verifyLikeApp(token) {
  const { jwk } = await (await fetch(base + '/api/v1/public-key')).json();
  const key = await crypto.webcrypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const [body, sig] = token.split('.');
  const ok = await crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(body));
  return ok ? JSON.parse(Buffer.from(body, 'base64url').toString()) : null;
}

const dev = (n) => ({ deviceId: 'dev-' + n, deviceName: 'Aparelho ' + n, platform: 'tv' });

test('pedido errado não ativa', async () => {
  shop.set('ana@x.com', { id: 1, tags: [], orders: [{ id: 101, name: '#1001', paidAt: Date.now() - 10 * DAY }] });
  const r = await post('/api/v1/activate', { email: 'ana@x.com', order: '#9999', ...dev(1) });
  assert.equal(r.http, 404);
  assert.equal(r.error, 'not_found');
});

test('em dia: ativo, licença assinada e configuração do servidor', async () => {
  const r = await post('/api/v1/activate', { email: 'ANA@x.com ', order: '1001', ...dev(1) });
  assert.equal(r.http, 200);
  assert.equal(r.ok, true);
  const p = await verifyLikeApp(r.token);
  assert.ok(p, 'assinatura válida');
  assert.equal(p.status, 'active');
  assert.equal(p.did, 'dev-1');
  assert.equal(p.cfg.tmdbKey, 'tmdb-do-servidor');
  // Licença adulterada é recusada.
  const forged = Buffer.from(JSON.stringify({ ...p, status: 'active', paidUntil: Date.now() + 999 * DAY })).toString('base64url') + '.' + r.token.split('.')[1];
  assert.equal(await verifyLikeApp(forged), null);
});

test('vencido: aviso de suspensão em até 4 dias, depois suspenso', async () => {
  shop.set('bia@x.com', { id: 2, tags: [], orders: [{ id: 201, name: '#2001', paidAt: Date.now() - 32 * DAY }] });
  const g = await post('/api/v1/activate', { email: 'bia@x.com', order: '#2001', ...dev(1) });
  assert.equal(g.http, 200);
  assert.equal((await verifyLikeApp(g.token)).status, 'grace');
  assert.ok(g.suspendAt - g.paidUntil === 4 * DAY);

  shop.set('cid@x.com', { id: 3, tags: [], orders: [{ id: 301, name: '#3001', paidAt: Date.now() - 40 * DAY }] });
  const s = await post('/api/v1/activate', { email: 'cid@x.com', order: '#3001', ...dev(1) });
  assert.equal((await verifyLikeApp(s.token)).status, 'suspended');
});

test('webhook orders/paid renova; HMAC inválido é recusado; repetição é ignorada', async () => {
  const order = {
    id: 302, name: '#3002', email: 'cid@x.com', customer: { id: 3, email: 'cid@x.com' },
    processed_at: new Date().toISOString(), financial_status: 'paid', cancelled_at: null,
    line_items: [{ sku: 'GATES-MENSAL', product_id: 777, variant_id: 1, quantity: 1 }],
  };
  const raw = JSON.stringify(order);
  const hmac = crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  const bad = await post('/webhooks/shopify', raw, { 'X-Shopify-Hmac-Sha256': 'x' + hmac.slice(1), 'X-Shopify-Topic': 'orders/paid' });
  assert.equal(bad.http, 401);
  const ok = await post('/webhooks/shopify', raw, { 'X-Shopify-Hmac-Sha256': hmac, 'X-Shopify-Topic': 'orders/paid', 'X-Shopify-Webhook-Id': 'w1' });
  assert.equal(ok.http, 200);
  const dup = await post('/webhooks/shopify', raw, { 'X-Shopify-Hmac-Sha256': hmac, 'X-Shopify-Topic': 'orders/paid', 'X-Shopify-Webhook-Id': 'w1' });
  assert.equal(dup.duplicate, true);
  // A loja também passa a ter o pedido (como no Shopify de verdade).
  shop.get('cid@x.com').orders.push({ id: 302, name: '#3002', paidAt: Date.now() });
  const c = await (await fetch(base + '/admin/api/customers/cid@x.com', { headers: { Authorization: 'Bearer admin-teste' } })).json();
  assert.equal(c.customer.state.status, 'active');
});

test('renovação do aparelho e limite de aparelhos', async () => {
  const a = await post('/api/v1/activate', { email: 'ana@x.com', order: '#1001', ...dev(2) });
  assert.equal(a.http, 200);
  const third = await post('/api/v1/activate', { email: 'ana@x.com', order: '#1001', ...dev(3) });
  assert.equal(third.http, 409);
  assert.equal(third.error, 'device_limit');
  const r = await post('/api/v1/refresh', { token: a.token, deviceId: 'dev-2' });
  assert.equal(r.http, 200);
  // Administrador remove o aparelho: a renovação passa a pedir novo login.
  await fetch(base + '/admin/api/customers/ana@x.com/devices/dev-2', { method: 'DELETE', headers: { Authorization: 'Bearer admin-teste' } });
  const r2 = await post('/api/v1/refresh', { token: a.token, deviceId: 'dev-2' });
  assert.equal(r2.http, 401);
});

test('pareamento por código (TV)', async () => {
  const s = await post('/api/v1/pair/start', dev(9));
  assert.match(s.code, /^[A-Z0-9]{6}$/);
  const pending = await (await fetch(`${base}/api/v1/pair/poll?id=${s.pairId}`)).json();
  assert.equal(pending.pair, 'pending');
  const c = await post('/api/v1/pair/confirm', { code: s.code.toLowerCase(), email: 'bia@x.com', order: '2001' });
  assert.equal(c.http, 200);
  const done = await (await fetch(`${base}/api/v1/pair/poll?id=${s.pairId}`)).json();
  assert.equal(done.pair, 'done');
  assert.equal((await verifyLikeApp(done.token)).did, 'dev-9');
});

test('tag de bloqueio no Shopify suspende; liberação manual pelo admin', async () => {
  shop.get('ana@x.com').tags = ['gates-bloqueado'];
  const r = await post('/api/v1/activate', { email: 'ana@x.com', order: '#1001', ...dev(1) });
  assert.equal((await verifyLikeApp(r.token)).status, 'suspended');
  shop.get('ana@x.com').tags = [];
  const adm = await post('/admin/api/customers/cid@x.com', { override: 'active', overrideUntil: '2099-01-01' }, { Authorization: 'Bearer admin-teste' });
  assert.equal(adm.customer.state.status, 'active');
  const noAuth = await post('/admin/api/customers/cid@x.com', { override: 'active' });
  assert.equal(noAuth.http, 401);
});
