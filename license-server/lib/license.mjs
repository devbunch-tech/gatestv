// Regras da assinatura e emissão das licenças assinadas (ECDSA P-256).
//
// Situação do assinante, calculada pelos pedidos pagos do produto de assinatura:
//   active     -> pago até "paidUntil" (+ folga para a cobrança recorrente)
//   grace      -> venceu; o app mostra 1x o aviso de que será suspenso em até GRACE_DAYS dias
//   suspended  -> passou do prazo (ou cliente bloqueado / sem assinatura)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { getCustomer, upsertCustomer } from './db.mjs';
import { provider } from './providers/index.mjs';

const sub = config.subscription;
const DAY = 864e5;

// ---------- Itens de assinatura ----------
export function subscriptionDays(order) {
  // Pagamentos do checkout próprio já trazem a duração do plano.
  if (order.days) return order.days;
  let days = 0;
  for (const li of order.items || []) {
    const sku = String(li.sku || '').toUpperCase();
    const byProduct = sub.productIds.length && sub.productIds.includes(String(li.productId));
    const bySku = sub.skuPrefixes.some((p) => sku.startsWith(p));
    // Sem nenhuma regra configurada, qualquer item conta (útil só em testes).
    const anyRule = sub.productIds.length || sub.skuPrefixes.length;
    if (anyRule && !byProduct && !bySku) continue;
    const plan = sub.plans.find((p) => sku.startsWith(p.match));
    days = Math.max(days, (plan?.days || sub.defaultPeriodDays) * Math.max(1, li.quantity || 1));
  }
  return days;
}

const PAID = new Set(['PAID', 'PARTIALLY_REFUNDED']);
export const orderCounts = (o) => !o.cancelled && PAID.has(o.financial) && subscriptionDays(o) > 0;

// Pago até: cada período começa no pagamento ou no fim do período anterior (renovação antecipada
// não "perde" dias), mais a folga da cobrança recorrente.
export function computePaidUntil(orders) {
  const valid = Object.values(orders || {})
    .filter(orderCounts)
    .sort((a, b) => a.paidAt - b.paidAt);
  let until = 0;
  for (const o of valid) until = Math.max(o.paidAt, until) + subscriptionDays(o) * DAY;
  return until ? until + sub.toleranceHours * 3600e3 : 0;
}

export function evaluate(c, now = Date.now()) {
  if (!c) return { status: 'suspended', reason: 'no_subscription', paidUntil: 0, suspendAt: 0 };
  if (c.override === 'blocked') return { status: 'suspended', reason: 'blocked', paidUntil: c.paidUntil || 0, suspendAt: 0 };
  if (c.override === 'active' && (!c.overrideUntil || c.overrideUntil > now)) {
    const until = c.overrideUntil || now + 365 * DAY;
    return { status: 'active', reason: 'manual', paidUntil: Math.max(until, c.paidUntil || 0), suspendAt: 0 };
  }
  const paidUntil = c.paidUntil || 0;
  // Comprou pelo checkout e ainda não pagou a 1ª mensalidade.
  if (!paidUntil && c.lastInvoiceUrl) return { status: 'suspended', reason: 'awaiting_payment', paidUntil: 0, suspendAt: 0 };
  if (!paidUntil) return { status: 'suspended', reason: 'no_subscription', paidUntil: 0, suspendAt: 0 };
  const suspendAt = paidUntil + sub.graceDays * DAY;
  if (now <= paidUntil) return { status: 'active', reason: 'paid', paidUntil, suspendAt };
  if (now <= suspendAt) return { status: 'grace', reason: 'payment_overdue', paidUntil, suspendAt };
  return { status: 'suspended', reason: 'payment_overdue', paidUntil, suspendAt };
}

// ---------- Sincronização com o Shopify ----------
function applyTags(c, tags) {
  const t = (tags || []).map((x) => String(x).toLowerCase());
  if (t.includes(sub.tagBlocked)) c.override = 'blocked';
  else if (t.includes(sub.tagActive)) {
    c.override = 'active';
    c.overrideUntil = 0;
  } else if (c.overrideSource === 'tag') c.override = null;
  if (t.includes(sub.tagBlocked) || t.includes(sub.tagActive)) c.overrideSource = 'tag';
  return c;
}

// Atualiza o cadastro local com os pedidos do cliente no Shopify.
export async function syncCustomer(email) {
  const remote = await provider.fetchCustomerByEmail(email);
  if (!remote) return getCustomer(email);
  return upsertCustomer(email, (c) => {
    c.customerId = remote.id;
    for (const o of remote.orders) c.orders[o.id] = o;
    if (remote.extra) Object.assign(c, remote.extra);
    applyTags(c, remote.tags);
    c.paidUntil = computePaidUntil(c.orders);
    c.syncedAt = Date.now();
    return c;
  });
}

export async function freshCustomer(email, { force = false } = {}) {
  let c = getCustomer(email);
  const stale = !c?.syncedAt || Date.now() - c.syncedAt > config.license.resyncMinutes * 60e3;
  // Só consulta o Shopify se estiver configurado; com erro de rede, usa o que já sabemos.
  if (provider.configured()) {
    const needs = force || stale || evaluate(c).status !== 'active';
    if (needs) {
      try {
        c = await syncCustomer(email);
      } catch (err) {
        console.warn(`[${provider.name}] falha ao sincronizar`, email, err.message);
      }
    }
  }
  return c;
}

export function recordOrder(email, order, customerId) {
  return upsertCustomer(email, (c) => {
    if (customerId) c.customerId = String(customerId);
    c.orders[order.id] = { ...(c.orders[order.id] || {}), ...order };
    c.paidUntil = computePaidUntil(c.orders);
    return c;
  });
}

// O número do pedido digitado no app ("#1023", "1023") pertence a este cliente e é de assinatura?
export function matchOrder(c, typed) {
  const n = String(typed || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
  if (!n || !c) return null;
  // Checkout próprio: o cliente entra com o CPF ou com o código de acesso mostrado na compra.
  if (c.accessCode && n === String(c.accessCode).replace(/[^0-9a-z]/gi, '').toLowerCase()) return { name: c.accessCode };
  if (c.cpfHash && /^\d{11}$|^\d{14}$/.test(n) && c.cpfHash === hashDoc(n)) return { name: 'cpf' };
  return Object.values(c.orders || {}).find((o) => String(o.name || '').replace(/[^0-9a-z]/gi, '').toLowerCase() === n && subscriptionDays(o) > 0) || null;
}

// CPF/CNPJ guardado só como hash (LGPD): serve para conferir o login, não para ler o número.
export const hashDoc = (doc) => crypto.createHash('sha256').update('gates-doc:' + String(doc).replace(/\D/g, '')).digest('hex');

// ---------- Chaves e tokens ----------
let privateKey = null;
export let publicJwk = null;

export function loadKeys({ create = true } = {}) {
  const lic = config.license;
  let pem = lic.privateKeyPem;
  if (!pem && fs.existsSync(lic.privateKeyFile)) pem = fs.readFileSync(lic.privateKeyFile, 'utf8');
  if (!pem) {
    if (!create) throw new Error('Chave privada não encontrada.');
    const { privateKey: pk } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    pem = pk.export({ type: 'pkcs8', format: 'pem' });
    fs.mkdirSync(path.dirname(lic.privateKeyFile), { recursive: true });
    fs.writeFileSync(lic.privateKeyFile, pem, { mode: 0o600 });
    console.log('[licença] nova chave criada em', lic.privateKeyFile);
  }
  privateKey = crypto.createPrivateKey(pem);
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  return publicJwk;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload) {
  if (!privateKey) loadKeys();
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(body), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${body}.${b64u(sig)}`;
}

export function readToken(token) {
  if (!privateKey) loadKeys();
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const pub = crypto.createPublicKey(privateKey);
  const ok = crypto.verify('sha256', Buffer.from(body), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  if (!ok) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Licença para um aparelho: situação + datas + configuração do app. O app confere a assinatura
// com a chave pública e recalcula a situação localmente (funciona alguns dias sem internet).
export function issueLicense(c, deviceId) {
  const st = evaluate(c);
  const now = Date.now();
  const cfg = Object.fromEntries(Object.entries(config.license.appConfig).filter(([, v]) => v));
  // Checkout próprio: o botão "Renovar" do app abre a página de assinatura deste servidor.
  // Fatura em aberto (PIX/boleto/cartão) para o botão "Pagar agora".
  if (c.lastInvoiceUrl) cfg.payUrl = c.lastInvoiceUrl;
  if (!cfg.storeUrl && config.storeProvider === 'checkout') cfg.storeUrl = `${config.publicUrl}/assinar?email=${encodeURIComponent(c.email)}`;
  return {
    status: st.status,
    reason: st.reason,
    paidUntil: st.paidUntil,
    suspendAt: st.suspendAt,
    token: signToken({
      v: 1,
      email: c.email,
      did: deviceId,
      status: st.status,
      reason: st.reason,
      paidUntil: st.paidUntil,
      suspendAt: st.suspendAt,
      graceDays: sub.graceDays,
      iat: now,
      exp: now + config.license.tokenDays * DAY,
      cfg,
    }),
  };
}

// Registra o aparelho respeitando o limite (aparelhos sem uso há 30 dias liberam a vaga).
export function registerDevice(email, device) {
  let error = null;
  const c = upsertCustomer(email, (c) => {
    c.devices = c.devices || {};
    const now = Date.now();
    for (const [id, d] of Object.entries(c.devices)) if (now - d.lastSeen > 30 * DAY) delete c.devices[id];
    if (!c.devices[device.id] && Object.keys(c.devices).length >= config.license.maxDevices) {
      error = 'device_limit';
      return c;
    }
    c.devices[device.id] = { ...(c.devices[device.id] || { firstSeen: now }), name: device.name || '', platform: device.platform || '', lastSeen: now };
    return c;
  });
  return { customer: c, error };
}
