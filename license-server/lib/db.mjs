// Armazenamento em arquivo JSON (sem dependências). Suficiente para milhares de assinantes;
// para volumes maiores, troque estas funções por um banco (a interface é pequena de propósito).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';

const file = path.join(config.dataDir, 'db.json');
const EMPTY = { customers: {}, webhooks: {}, pairs: {} };
let db = null;
let timer = null;

function load() {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  try {
    db = { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    db = structuredClone(EMPTY);
  }
  return db;
}

// Grava de forma atômica (arquivo temporário + rename), agrupando várias mudanças seguidas.
function persist() {
  clearTimeout(timer);
  timer = setTimeout(flush, 150);
}
export function flush() {
  clearTimeout(timer);
  if (!db) return;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, file);
}
process.on('exit', flush);

export const normEmail = (e) => String(e || '').trim().toLowerCase();

export function getCustomer(email) {
  return load().customers[normEmail(email)] || null;
}

export function upsertCustomer(email, patch) {
  const key = normEmail(email);
  const d = load();
  const cur = d.customers[key] || { email: key, orders: {}, devices: {}, createdAt: Date.now() };
  const next = typeof patch === 'function' ? patch(structuredClone(cur)) : { ...cur, ...patch };
  next.updatedAt = Date.now();
  d.customers[key] = next;
  persist();
  return next;
}

export function deleteCustomer(email) {
  const d = load();
  delete d.customers[normEmail(email)];
  persist();
}

export function listCustomers() {
  return Object.values(load().customers);
}

export function findCustomerByShopifyId(id) {
  const sid = String(id).replace(/\D/g, '');
  return listCustomers().find((c) => c.customerId && String(c.customerId).replace(/\D/g, '') === sid) || null;
}

// Webhooks já processados (o Shopify pode reenviar o mesmo evento).
export function seenWebhook(id) {
  if (!id) return false;
  const d = load();
  if (d.webhooks[id]) return true;
  d.webhooks[id] = Date.now();
  // Mantém só os últimos 7 dias.
  const cut = Date.now() - 7 * 864e5;
  for (const [k, t] of Object.entries(d.webhooks)) if (t < cut) delete d.webhooks[k];
  persist();
  return false;
}

// Pareamento de aparelhos (código mostrado na TV).
export const pairs = {
  put(p) {
    load().pairs[p.id] = p;
    persist();
  },
  get(id) {
    return load().pairs[id] || null;
  },
  byCode(code) {
    return Object.values(load().pairs).find((p) => p.code === code && p.expiresAt > Date.now()) || null;
  },
  del(id) {
    delete load().pairs[id];
    persist();
  },
  sweep() {
    const d = load();
    for (const [k, p] of Object.entries(d.pairs)) if (p.expiresAt < Date.now() - 3600e3) delete d.pairs[k];
    persist();
  },
};
