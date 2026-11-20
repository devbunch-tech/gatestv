// Sincronização entre aparelhos e histórico de reprodução, direto no código da Cloudflare
// (cloud/src/app.js) com um banco D1 simulado em SQLite (node:sqlite, Node 22.5+). Sem rede.
//   node --test cloud/test/sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../src/app.js';
import { signToken } from '../src/license.js';
import { makeConfig } from '../src/config.js';

// D1 mínimo (prepare/bind/first/all/run/batch) sobre SQLite em memória.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())), raw: db };
}

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const DB = fakeD1();
const env = { DB, LICENSE_PRIVATE_JWK: JSON.stringify(jwk), ADMIN_TOKEN: 'painel-teste' };
const cfg = makeConfig(env);
const EMAIL = 'familia@teste.com';
DB.raw
  .prepare('INSERT INTO customers (email, data, updated_at) VALUES (?, ?, ?)')
  .run(EMAIL, JSON.stringify({ email: EMAIL, orders: {}, override: 'active', devices: { tv1: { name: 'TV · Sala', platform: 'tv', lastSeen: Date.now() }, cel1: { name: 'Celular', platform: 'phone', lastSeen: Date.now() } } }), Date.now());
const tokenFor = (did) => signToken({ email: EMAIL, did, exp: Date.now() + 864e5 }, cfg);

const call = async (path, body, headers = {}) => {
  const res = await handle(new Request('https://x.test' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  return { http: res.status, ...(await res.json()) };
};

test('sincroniza perfis e favoritos entre aparelhos (vale a mudança mais nova)', async () => {
  const tv = await tokenFor('tv1');
  const cel = await tokenFor('cel1');
  const profiles = [{ id: 'sub-x-main', name: 'Família', master: true }, { id: 'u1', name: 'Ana' }];
  let r = await call('/api/v1/sync/push', { token: tv, deviceId: 'tv1', data: { profiles: { v: profiles, at: 1000 }, 'p:u1:favorites': { v: ['~p~abc~m12'], at: 1000 } } });
  assert.equal(r.saved, 2);
  r = await call('/api/v1/sync/pull', { token: cel, deviceId: 'cel1' });
  assert.deepEqual(r.data.profiles.v, profiles);
  assert.deepEqual(r.data['p:u1:favorites'].v, ['~p~abc~m12']);
  // Mudança mais antiga não sobrescreve a mais nova.
  await call('/api/v1/sync/push', { token: cel, deviceId: 'cel1', data: { 'p:u1:favorites': { v: [], at: 500 } } });
  r = await call('/api/v1/sync/pull', { token: cel, deviceId: 'cel1' });
  assert.deepEqual(r.data['p:u1:favorites'].v, ['~p~abc~m12']);
  await call('/api/v1/sync/push', { token: cel, deviceId: 'cel1', data: { 'p:u1:favorites': { v: ['~p~abc~s7'], at: 2000 } } });
  r = await call('/api/v1/sync/pull', { token: tv, deviceId: 'tv1' });
  assert.deepEqual(r.data['p:u1:favorites'].v, ['~p~abc~s7']);
  // Chaves fora do padrão são ignoradas.
  r = await call('/api/v1/sync/push', { token: tv, deviceId: 'tv1', data: { settings: { v: { x: 1 }, at: 3000 }, 'p:u1:../x': { v: 1, at: 3000 } } });
  assert.equal(r.saved, 0);
});

test('recusa aparelho que não é da conta ou token adulterado', async () => {
  const tv = await tokenFor('tv1');
  assert.equal((await call('/api/v1/sync/pull', { token: tv, deviceId: 'outro' })).http, 401);
  assert.equal((await call('/api/v1/sync/pull', { token: tv.slice(0, -3) + 'AAA', deviceId: 'tv1' })).http, 401);
  assert.equal((await call('/api/v1/sync/pull', { token: await tokenFor('removido'), deviceId: 'removido' })).http, 401);
});

test('registra o que cada perfil assiste e mostra no painel', async () => {
  const tv = await tokenFor('tv1');
  const session = { sid: 'sess-abc123', profileId: 'u1', profileName: 'Ana', type: 'episode', title: 'A Casa do Dragão', sub: 'T3 · E2', position: 600, duration: 3600 };
  assert.equal((await call('/api/v1/sync/watch', { token: tv, deviceId: 'tv1', session })).ok, true);
  await call('/api/v1/sync/watch', { token: tv, deviceId: 'tv1', session: { ...session, position: 1200 } });
  assert.equal((await call('/api/v1/sync/watch', { token: tv, deviceId: 'tv1', session: { sid: 'x' } })).http, 400);
  assert.equal((await call('/admin/api/customers/' + encodeURIComponent(EMAIL) + '/watch')).http, 401);
  const auth = { Authorization: 'Bearer painel-teste' };
  const w = await call('/admin/api/customers/' + encodeURIComponent(EMAIL) + '/watch', null, auth);
  assert.equal(w.sessions.length, 1);
  assert.equal(w.sessions[0].position, 1200);
  assert.equal(w.sessions[0].device, 'TV · Sala');
  assert.equal(w.profiles.length, 2);
  const now = await call('/admin/api/watching', null, auth);
  assert.equal(now.sessions[0].title, 'A Casa do Dragão');
});

test('excluir o assinante apaga também os dados sincronizados e o histórico', async () => {
  const r = await call('/admin/api/customers/' + encodeURIComponent(EMAIL), null, { Authorization: 'Bearer painel-teste' });
  assert.equal(r.ok, true);
  await handle(new Request('https://x.test/admin/api/customers/' + encodeURIComponent(EMAIL), { method: 'DELETE', headers: { Authorization: 'Bearer painel-teste' } }), env);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS c FROM userdata').get().c, 0);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS c FROM watchlog').get().c, 0);
});

test('estatísticas do jogo: recusa ID inválido', async () => {
  assert.equal((await call('/api/v1/match?id=../x')).http, 400);
  assert.equal((await call('/api/v1/match?id=nba-123456')).http, 400);
});
