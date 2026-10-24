// Teste com a Nuvemshop simulada: node --test license-server/test/nuvemshop.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock, customers } from './mock-nuvemshop.mjs';

const SECRET = 'segredo-do-app';
let base, server, mock;
before(async () => {
  mock = startMock(0);
  await new Promise((r) => mock.once('listening', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-ns-'));
  Object.assign(process.env, {
    GATES_ENV_FILE: path.join(dir, 'x.env'),
    DATA_DIR: dir,
    STORE_PROVIDER: 'nuvemshop',
    NS_API_BASE: `http://127.0.0.1:${mock.address().port}/v1/1`,
    NS_ACCESS_TOKEN: 'x',
    NS_APP_SECRET: SECRET,
    SUBSCRIPTION_SKU_PREFIXES: 'GATES',
  });
  const { createServer } = await import('../server.mjs');
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => (server?.close(), mock?.close()));

const post = async (p, body, headers = {}) => {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { ...(await r.json()), http: r.status };
};
const dev = { deviceId: 'd1', deviceName: 'TV', platform: 'tv' };

test('Nuvemshop: em dia, aviso, suspenso e pedido errado', async () => {
  assert.equal((await post('/api/v1/activate', { email: 'em-dia@teste.com', order: '1001', ...dev })).status, 'active');
  assert.equal((await post('/api/v1/activate', { email: 'atrasado@teste.com', order: '#1002', ...dev })).status, 'grace');
  assert.equal((await post('/api/v1/activate', { email: 'suspenso@teste.com', order: '1003', ...dev })).status, 'suspended');
  assert.equal((await post('/api/v1/activate', { email: 'em-dia@teste.com', order: '9999', ...dev })).http, 404);
});

test('Nuvemshop: webhook order/paid (HMAC) libera o suspenso; assinatura errada é recusada', async () => {
  customers['suspenso@teste.com'].orders.push({ id: 9004, number: 1004, ago: 0, pay: 'paid' });
  const raw = JSON.stringify({ store_id: 1, event: 'order/paid', id: 9004 });
  const hmac = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  assert.equal((await post('/webhooks/nuvemshop', raw, { 'x-linkedstore-hmac-sha256': 'ab' + hmac.slice(2) })).http, 401);
  assert.equal((await post('/webhooks/nuvemshop', raw, { 'x-linkedstore-hmac-sha256': hmac })).http, 200);
  assert.equal((await post('/api/v1/activate', { email: 'suspenso@teste.com', order: '1004', ...dev })).status, 'active');
});

test('Nuvemshop: pedido reembolsado não conta', async () => {
  customers['em-dia@teste.com'].orders[0].pay = 'refunded';
  const r = await post('/api/v1/activate', { email: 'em-dia@teste.com', order: '1001', deviceId: 'd2' });
  assert.equal(r.status, 'suspended');
});
