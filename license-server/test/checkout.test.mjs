// Checkout próprio + Asaas simulado: node --test license-server/test/checkout.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock, db, payPending } from './mock-asaas.mjs';

let base, server, mock;
before(async () => {
  mock = startMock(0);
  await new Promise((r) => mock.once('listening', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-chk-'));
  Object.assign(process.env, {
    GATES_ENV_FILE: path.join(dir, 'x.env'),
    DATA_DIR: dir,
    STORE_PROVIDER: 'checkout',
    ASAAS_API_BASE: `http://127.0.0.1:${mock.address().port}/v3`,
    ASAAS_API_KEY: 'chave',
    ASAAS_WEBHOOK_TOKEN: 'tok-webhook',
    ADMIN_TOKEN: 'adm',
    PUBLIC_URL: 'https://licenca.exemplo.com',
  });
  const { createServer } = await import('../server.mjs');
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => (server?.close(), mock?.close()));

const post = async (p, body, headers = {}) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { ...(await r.json()), http: r.status };
};
const dev = (n) => ({ deviceId: 'dev' + n, deviceName: 'TV', platform: 'tv' });

test('planos e páginas do checkout e do painel', async () => {
  const j = await (await fetch(base + '/api/v1/plans')).json();
  assert.ok(j.plans.length >= 1);
  assert.equal((await fetch(base + '/assinar')).status, 200);
  assert.equal((await fetch(base + '/admin')).status, 200);
});

test('clientes existentes no Asaas: em dia, aviso e suspenso (login com e-mail + CPF)', async () => {
  assert.equal((await post('/api/v1/activate', { email: 'em-dia@teste.com', order: '529.982.247-25', ...dev(1) })).status, 'active');
  assert.equal((await post('/api/v1/activate', { email: 'atrasado@teste.com', order: '11144477735', ...dev(1) })).status, 'grace');
  assert.equal((await post('/api/v1/activate', { email: 'suspenso@teste.com', order: '12345678909', ...dev(1) })).status, 'suspended');
  assert.equal((await post('/api/v1/activate', { email: 'em-dia@teste.com', order: '11144477735', ...dev(1) })).http, 404);
});

test('checkout valida os dados', async () => {
  const r = await post('/api/v1/checkout', { plan: 'mensal', name: 'Ana', email: 'x', cpf: '111.111.111-11' });
  assert.equal(r.http, 400);
  assert.ok(r.errors.name && r.errors.email && r.errors.cpf);
});

test('compra nova: código de acesso, fatura, pagamento via webhook libera o app', async () => {
  const r = await post('/api/v1/checkout', { plan: 'mensal', name: 'Nova Cliente', email: 'nova@teste.com', cpf: '935.411.347-80' });
  assert.equal(r.http, 200, r.message);
  assert.match(r.code, /^GTV-/);
  assert.match(r.invoiceUrl, /asaas/);
  // Antes de pagar: o código é reconhecido, mas a assinatura ainda não está ativa.
  assert.equal((await post('/api/v1/activate', { email: 'nova@teste.com', order: r.code, ...dev(2) })).status, 'suspended');
  // Cliente paga o PIX; o Asaas avisa o servidor.
  const cus = db.customers.find((c) => c.email === 'nova@teste.com');
  const pay = payPending(cus.id);
  const bad = await post('/webhooks/asaas', { event: 'PAYMENT_RECEIVED', payment: pay }, { 'asaas-access-token': 'errado' });
  assert.equal(bad.http, 401);
  const ok = await post('/webhooks/asaas', { id: 'evt1', event: 'PAYMENT_RECEIVED', payment: pay }, { 'asaas-access-token': 'tok-webhook' });
  assert.equal(ok.http, 200);
  const lic = await post('/api/v1/activate', { email: 'nova@teste.com', order: '93541134780', ...dev(2) });
  assert.equal(lic.status, 'active');
});

test('painel: resumo, liberação manual e cancelamento', async () => {
  const H = { Authorization: 'Bearer adm' };
  const s = await (await fetch(base + '/admin/api/summary', { headers: H })).json();
  assert.ok(s.total >= 4);
  const add = await post('/admin/api/customers', { email: 'cortesia@teste.com', name: 'Cortesia', until: '2099-12-31' }, H);
  assert.equal(add.customer.state.status, 'active');
  const cancel = await post('/admin/api/customers/nova@teste.com/cancel', {}, H);
  assert.ok(cancel.customer.cancelledAt);
  assert.equal(db.subscriptions.find((x) => x.customer === db.customers.find((c) => c.email === 'nova@teste.com').id).status, 'INACTIVE');
});

test('site: landing page e área do assinante', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/conta')).status, 200);
  assert.equal((await fetch(base + '/logo.png')).headers.get('content-type'), 'image/png');
  const plans = await (await fetch(base + '/api/v1/plans')).json();
  assert.ok(plans.maxDevices >= 1 && 'downloads' in plans);
  // Entrar com dados errados não mostra nada.
  assert.equal((await post('/api/v1/account', { email: 'em-dia@teste.com', doc: '11144477735' })).http, 404);
  const a = await post('/api/v1/account', { email: 'em-dia@teste.com', doc: '529.982.247-25' });
  assert.equal(a.account.status, 'active');
  assert.equal(a.account.devices.length, 1);
  assert.equal(a.account.cpf, undefined, 'CPF nunca é devolvido');
  const r = await post('/api/v1/account/device', { email: 'em-dia@teste.com', doc: '52998224725', deviceId: a.account.devices[0].id });
  assert.equal(r.account.devices.length, 0);
});
