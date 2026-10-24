// Teste da versão Cloudflare rodando localmente (wrangler pages dev) com o Asaas simulado.
//   BASE=http://127.0.0.1:8788 FATURA=http://127.0.0.1:8795 node --test cloud/test/cloud.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const post = async (p, body, headers = {}) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { ...(await r.json().catch(() => ({}))), http: r.status };
};
const dev = (n) => ({ deviceId: 'cf-dev' + n, deviceName: 'Teste ' + n, platform: 'tv' });
const unique = Date.now().toString(36);
// CPF válido novo a cada execução.
const randomCpf = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); const c = (n) => { let t = 0; for (let i = 0; i < n; i++) t += d[i] * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; }; d.push(c(9)); d.push(c(10)); return d.join(''); };
const CPF = randomCpf();

async function verify(token) {
  const { jwk } = await (await fetch(BASE + '/api/v1/public-key')).json();
  const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const [body, sig] = token.split('.');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(body));
  return ok ? JSON.parse(Buffer.from(body, 'base64url').toString()) : null;
}

test('páginas do site e planos', async () => {
  for (const p of ['/', '/assinar', '/conta', '/admin', '/ativar', '/instalar', '/termos', '/privacidade', '/logo.png']) assert.equal((await fetch(BASE + p)).status, 200, p);
  const j = await (await fetch(BASE + '/api/v1/plans')).json();
  assert.ok(j.plans.length >= 1 && j.maxDevices >= 1);
});

test('assinantes existentes: em dia, aviso, suspenso, dados errados', async () => {
  const a = await post('/api/v1/activate', { email: 'em-dia@teste.com', order: '529.982.247-25', ...dev(1) });
  assert.equal(a.status, 'active');
  assert.equal((await verify(a.token)).status, 'active');
  assert.equal((await post('/api/v1/activate', { email: 'atrasado@teste.com', order: '11144477735', ...dev(1) })).status, 'grace');
  assert.equal((await post('/api/v1/activate', { email: 'suspenso@teste.com', order: '12345678909', ...dev(1) })).status, 'suspended');
  assert.equal((await post('/api/v1/activate', { email: 'em-dia@teste.com', order: '11144477735', ...dev(1) })).http, 404);
  const r = await post('/api/v1/refresh', { token: a.token, deviceId: 'cf-dev1' });
  assert.equal(r.status, 'active');
});

test('compra nova → aguardando → fatura paga (webhook) → liberado', async () => {
  const bad = await post('/api/v1/checkout', { plan: 'mensal', name: 'X', email: 'x', cpf: '111' });
  assert.equal(bad.http, 400);
  const email = `cf-${unique}@teste.com`;
  const c = await post('/api/v1/checkout', { plan: 'mensal', name: 'Cliente Cloudflare', email, cpf: CPF, acceptTerms: true });
  assert.equal(c.http, 200, c.message);
  assert.match(c.code, /^GTV-/);
  const before = await post('/api/v1/activate', { email, order: c.code, ...dev(2) });
  assert.equal(before.reason, 'awaiting_payment');
  // Webhook com token errado é recusado.
  assert.equal((await post('/webhooks/asaas', { event: 'PAYMENT_RECEIVED' }, { 'asaas-access-token': 'errado' })).http, 401);
  // Cliente paga a fatura de teste (o Asaas simulado avisa o servidor).
  const pay = await fetch(c.invoiceUrl + '/pagar', { method: 'POST', redirect: 'manual' });
  assert.equal(pay.status, 303);
  const after = await post('/api/v1/activate', { email, order: CPF, ...dev(2) });
  assert.equal(after.status, 'active');
});

test('pareamento por código (TV)', async () => {
  const s = await post('/api/v1/pair/start', dev(9));
  assert.match(s.code, /^[A-Z0-9]{6}$/);
  assert.equal((await (await fetch(`${BASE}/api/v1/pair/poll?id=${s.pairId}`)).json()).pair, 'pending');
  assert.equal((await post('/api/v1/pair/confirm', { code: s.code, email: 'em-dia@teste.com', order: '52998224725' })).http, 200);
  const done = await (await fetch(`${BASE}/api/v1/pair/poll?id=${s.pairId}`)).json();
  assert.equal(done.pair, 'done');
  assert.equal((await verify(done.token)).did, 'cf-dev9');
});

test('área do assinante e painel', async () => {
  const a = await post('/api/v1/account', { email: 'em-dia@teste.com', doc: '529.982.247-25' });
  assert.equal(a.account.status, 'active');
  assert.ok(a.account.devices.length >= 1);
  const r = await post('/api/v1/account/device', { email: 'em-dia@teste.com', doc: '52998224725', deviceId: a.account.devices[0].id });
  assert.equal(r.account.devices.length, a.account.devices.length - 1);
  assert.equal((await fetch(BASE + '/admin/api/summary')).status, 401);
  const H = { Authorization: 'Bearer adm-local' };
  const s = await (await fetch(BASE + '/admin/api/summary', { headers: H })).json();
  assert.ok(s.total >= 1);
  const add = await post('/admin/api/customers', { email: `cortesia-${unique}@teste.com`, name: 'Cortesia', until: '2099-12-31' }, H);
  assert.equal(add.customer.state.status, 'active');
  assert.equal(add.customer.cpfHash, undefined);
});

test('termos obrigatórios e download só para quem está em dia', async () => {
  const r = await post('/api/v1/checkout', { plan: 'mensal', name: 'Sem Aceite', email: 'sem-aceite@teste.com', cpf: CPF });
  assert.equal(r.http, 400);
  assert.ok(r.errors.terms);
  // Suspenso: não baixa.
  const s = await post('/api/v1/account/downloads', { email: 'suspenso@teste.com', doc: '12345678909' });
  assert.equal(s.http, 403);
  // Em dia: recebe links curtos.
  const ok = await post('/api/v1/account/downloads', { email: 'atrasado@teste.com', doc: '11144477735' });
  assert.equal(ok.http, 200);
  assert.equal(ok.files.length, 6);
  assert.match(ok.files[0].url, /\/d\/[A-Z0-9]{6}$/);
  assert.equal((await fetch(BASE + '/d/ZZZZZZ')).status, 410);
});
