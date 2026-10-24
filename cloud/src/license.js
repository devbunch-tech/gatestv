// Regras da assinatura e licenças assinadas (ECDSA P-256 via WebCrypto). Mesmas regras do
// license-server (Node): em dia (active) → aviso (grace, GRACE_DAYS dias) → suspensa.
const DAY = 864e5;
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

// CPF/CNPJ guardado só como hash (igual ao servidor Node).
export async function hashDoc(doc) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode('gates-doc:' + String(doc).replace(/\D/g, ''))));
}

export const subscriptionDays = (o) => o.days || 30;
const PAID = new Set(['PAID', 'PARTIALLY_REFUNDED']);
export const orderCounts = (o) => !o.cancelled && PAID.has(o.financial) && subscriptionDays(o) > 0;

export function computePaidUntil(orders, cfg) {
  const valid = Object.values(orders || {})
    .filter(orderCounts)
    .sort((a, b) => a.paidAt - b.paidAt);
  let until = 0;
  for (const o of valid) until = Math.max(o.paidAt, until) + subscriptionDays(o) * DAY;
  return until ? until + cfg.toleranceHours * 3600e3 : 0;
}

// Teste grátis: só começa a contar quando o primeiro aparelho é ativado. Cadastros antigos (antes do
// trialStartedAt) contam como iniciados se chegaram a ter aparelho.
export const trialStarted = (c) => !!(c?.trialStartedAt || (c?.trialUntil && Object.keys(c.devices || {}).length));
export const everPaid = (c) => !!(c?.paidUntil || Object.values(c?.orders || {}).some(orderCounts));
// Pediu o teste e ainda não ativou nenhum aparelho (nem pagou): o teste está guardado para ele.
export const trialReady = (c) => !!(c?.trialAt && !trialStarted(c) && !everPaid(c));

export function evaluate(c, cfg, now = Date.now()) {
  if (!c) return { status: 'suspended', reason: 'no_subscription', paidUntil: 0, suspendAt: 0 };
  if (c.override === 'blocked') return { status: 'suspended', reason: 'blocked', paidUntil: c.paidUntil || 0, suspendAt: 0 };
  if (c.override === 'active' && (!c.overrideUntil || c.overrideUntil > now)) {
    const until = c.overrideUntil || now + 365 * DAY;
    return { status: 'active', reason: 'manual', paidUntil: Math.max(until, c.paidUntil || 0), suspendAt: 0 };
  }
  const paidUntil = c.paidUntil || 0;
  if (trialReady(c)) return { status: 'active', reason: 'trial_ready', paidUntil: 0, suspendAt: 0 };
  // Teste grátis: vale até trialUntil (se a pessoa assinar antes, o pagamento passa a valer).
  if (c.trialUntil && now < c.trialUntil && now > paidUntil) return { status: 'active', reason: 'trial', paidUntil: c.trialUntil, suspendAt: 0 };
  if (!paidUntil && c.trialUntil && !c.lastInvoiceUrl) return { status: 'suspended', reason: 'trial_ended', paidUntil: c.trialUntil, suspendAt: 0 };
  if (!paidUntil && c.lastInvoiceUrl) return { status: 'suspended', reason: 'awaiting_payment', paidUntil: 0, suspendAt: 0 };
  if (!paidUntil) return { status: 'suspended', reason: 'no_subscription', paidUntil: 0, suspendAt: 0 };
  const suspendAt = paidUntil + cfg.graceDays * DAY;
  if (now <= paidUntil) return { status: 'active', reason: 'paid', paidUntil, suspendAt };
  if (now <= suspendAt) return { status: 'grace', reason: 'payment_overdue', paidUntil, suspendAt };
  return { status: 'suspended', reason: 'payment_overdue', paidUntil, suspendAt };
}

// O que o cliente digitou (CPF ou código de acesso) confere com o cadastro?
export async function matchLogin(c, typed) {
  const n = String(typed || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
  if (!n || !c) return false;
  if (c.accessCode && n === String(c.accessCode).replace(/[^0-9a-z]/gi, '').toLowerCase()) return true;
  if (c.cpfHash && /^\d{11}$|^\d{14}$/.test(n) && c.cpfHash === (await hashDoc(n))) return true;
  return false;
}

// ---------- Chaves ----------
let keys = null;
async function loadKeys(cfg) {
  if (keys) return keys;
  if (!cfg.privateJwk) throw new Error('LICENSE_PRIVATE_JWK não configurado.');
  const jwk = JSON.parse(cfg.privateJwk);
  const priv = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const pub = await crypto.subtle.importKey('jwk', { ...pubJwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  keys = { priv, pub, pubJwk };
  return keys;
}
export async function publicJwk(cfg) {
  return (await loadKeys(cfg)).pubJwk;
}

export async function signToken(payload, cfg) {
  const { priv } = await loadKeys(cfg);
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, enc.encode(body));
  return `${body}.${b64u(sig)}`;
}

export async function readToken(token, cfg) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  try {
    const { pub } = await loadKeys(cfg);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64u(sig), enc.encode(body));
    return ok ? JSON.parse(new TextDecoder().decode(fromB64u(body))) : null;
  } catch {
    return null;
  }
}

export async function issueLicense(c, deviceId, cfg) {
  const st = evaluate(c, cfg);
  const now = Date.now();
  const app = Object.fromEntries(Object.entries(cfg.appConfig).filter(([, v]) => v));
  if (c.lastInvoiceUrl) app.payUrl = c.lastInvoiceUrl;
  app.storeUrl = `${cfg.publicUrl}/assinar?email=${encodeURIComponent(c.email)}`;
  return {
    status: st.status,
    reason: st.reason,
    paidUntil: st.paidUntil,
    suspendAt: st.suspendAt,
    token: await signToken(
      { v: 1, email: c.email, did: deviceId, status: st.status, reason: st.reason, paidUntil: st.paidUntil, suspendAt: st.suspendAt, graceDays: cfg.graceDays, iat: now, exp: now + cfg.tokenDays * DAY, cfg: app },
      cfg
    ),
  };
}

// Aparelhos sem uso há 30 dias liberam a vaga.
export async function registerDevice(db, email, device, cfg) {
  let error = null;
  const c = await db.update(email, (c) => {
    c.devices = c.devices || {};
    const now = Date.now();
    for (const [id, d] of Object.entries(c.devices)) if (now - d.lastSeen > 30 * DAY) delete c.devices[id];
    if (!c.devices[device.id] && Object.keys(c.devices).length >= cfg.maxDevices) {
      error = 'device_limit';
      return c;
    }
    c.devices[device.id] = {
      ...(c.devices[device.id] || { firstSeen: now }),
      name: device.name || '',
      platform: device.platform || '',
      lastSeen: now,
      ...(device.city ? { city: device.city } : {}),
    };
    return c;
  });
  return { customer: c, error };
}
