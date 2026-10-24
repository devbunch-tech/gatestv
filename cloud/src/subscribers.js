// Assinantes: sincronização com o Asaas e o fluxo do checkout (igual ao servidor Node).
import { computePaidUntil, evaluate, everPaid, hashDoc, trialStarted } from './license.js';
import { normEmail } from './db.js';

export function makeSubscribers(db, asaas, cfg) {
  const planById = (id) => cfg.plans.find((p) => p.id === id);

  async function sync(email) {
    const local = await db.get(email);
    let ids = local?.gateway?.customerIds || [];
    let doc = null;
    if (!ids.length) {
      const found = await asaas.findCustomersByEmail(email);
      ids = found.map((c) => c.id);
      doc = found[0]?.cpfCnpj || null;
    }
    if (!ids.length) return local;
    const subs = local?.gateway?.subscriptions || {};
    const planOf = (p) => planById(subs[p.subscription]) || cfg.plans.find((x) => Math.abs(x.price - p.value) < 0.01);
    const orders = [];
    for (const id of ids) orders.push(...(await asaas.fetchPayments(id, planOf)));
    const cpfHash = doc && !local?.cpfHash ? await hashDoc(doc) : null;
    return db.update(email, (c) => {
      c.gateway = { ...(c.gateway || {}), customerIds: ids };
      if (cpfHash) c.cpfHash = cpfHash;
      for (const o of orders) c.orders[o.id] = o;
      c.paidUntil = computePaidUntil(c.orders, cfg);
      c.syncedAt = Date.now();
      return c;
    });
  }

  // Ressincroniza se o cadastro estiver velho ou se não estiver em dia (pode ter acabado de pagar).
  async function fresh(email, { force = false } = {}) {
    let c = await db.get(email);
    const stale = !c?.syncedAt || Date.now() - c.syncedAt > cfg.resyncMinutes * 60e3;
    if (asaas.configured() && (force || stale || evaluate(c, cfg).status !== 'active')) {
      try {
        c = await sync(email);
      } catch (err) {
        console.warn('[asaas] falha ao sincronizar', err.message);
      }
    }
    return c;
  }

  return { sync, fresh };
}

export function validCpf(v) {
  const d = String(v).replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (k) => {
    let s = 0;
    for (let i = 0; i < k; i++) s += Number(d[i]) * (k + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = () => 'GTV-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (x, i) => (i === 4 ? '-' : '') + CHARS[x % CHARS.length]).join('');

// Código de indicação do assinante (link: /assinar?ref=CODIGO).
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newRefCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => REF_CHARS[x % REF_CHARS.length]).join('');

// Código fixo da TV, só números (fácil de digitar no controle): <site>/tv/123456 baixa o app da TV.
const newTvCode = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
export async function uniqueTvCode(db) {
  let code;
  do code = newTvCode();
  while (await db.byTvCode(code));
  return code;
}
export async function ensureTvCode(db, c) {
  if (!c || c.tvCode) return c;
  const code = await uniqueTvCode(db);
  return db.update(c.email, (x) => ((x.tvCode = x.tvCode || code), x));
}

// Divide a cobrança com o indicador SOMENTE se ele estiver em dia e tiver a carteira Asaas
// cadastrada; senão, a cobrança fica 100% com a loja. Chamado ao criar cada cobrança.
export async function applyReferralSplit(db, asaas, cfg, referee, paymentId) {
  if (!referee?.referredBy || !paymentId) return null;
  const ref = await db.get(referee.referredBy);
  const ok = ref && ref.walletId && evaluate(ref, cfg).status === 'active' && ref.email !== referee.email;
  const split = ok ? [{ walletId: ref.walletId, percentualValue: cfg.referralPercent }] : [];
  try {
    await asaas.setPaymentSplit(paymentId, split);
  } catch (err) {
    console.warn('[indicação] split não aplicado', paymentId, err.message);
    return null;
  }
  await db.update(referee.email, (c) => {
    c.splits = c.splits || {};
    c.splits[paymentId] = ok ? ref.walletId : null;
    return c;
  });
  return ok;
}

// Pagamento recebido de um indicado com divisão aplicada: soma a comissão no extrato do indicador.
export async function recordCommission(db, cfg, referee, payment) {
  const wallet = referee?.splits?.[payment.id];
  if (!wallet || !referee.referredBy) return;
  await db.update(referee.referredBy, (c) => {
    c.commissions = c.commissions || {};
    if (!c.commissions[payment.id])
      c.commissions[payment.id] = { from: referee.name || referee.email, value: Math.round(Number(payment.value || 0) * cfg.referralPercent) / 100, at: Date.now() };
    return c;
  });
}

const onlyDigits = (v) => String(v || '').replace(/\D/g, '');

// DDDs válidos no Brasil.
const DDD = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
// Celular brasileiro (WhatsApp): DDD + 9 dígitos começando com 9, guardado sem o 55.
// O 55 (Brasil) é tirado da frente quando vier junto. Retorna '' se o número não for válido.
export function normPhone(v) {
  let d = onlyDigits(v);
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  return d.length === 11 && DDD.has(d.slice(0, 2)) && d[2] === '9' ? d : '';
}
export const PHONE_ERROR = 'Confira o WhatsApp: DDD (2 números) + celular com 9 dígitos, começando com 9.';

// Teste grátis: guarda o pedido; as horas só começam a contar quando o primeiro aparelho é
// ativado (app.js → activate). Uma vez por e-mail, CPF e celular — mas só conta como usado
// quem chegou a ativar um aparelho no teste ou já pagou. Cadastro de compra que não foi paga
// não impede o teste.
export async function startTrial(db, cfg, { name, email, cpf, phone, acceptTerms, optMessages, city }) {
  const mail = normEmail(email);
  const tel = normPhone(phone);
  const errors = {};
  if (String(name || '').trim().split(/\s+/).length < 2) errors.name = 'Informe nome e sobrenome.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) errors.email = 'E-mail inválido.';
  if (!validCpf(cpf)) errors.cpf = 'CPF inválido.';
  if (!tel) errors.phone = PHONE_ERROR;
  if (!acceptTerms) errors.terms = 'É preciso aceitar os Termos de uso e a Política de privacidade.';
  if (Object.keys(errors).length) return { errors };
  const cpfHash = await hashDoc(cpf);
  const existing = await db.get(mail);
  const spent = (c) => c && (trialStarted(c) || everPaid(c));
  const others = [...(await db.findAllBy('cpfHash', cpfHash)), ...(await db.findAllBy('phone', tel))];
  if (spent(existing) || others.some(spent)) return { used: true };
  const tvCode = await uniqueTvCode(db);
  const now = Date.now();
  const saved = await db.update(mail, (c) => {
    c.name = String(name).trim();
    c.accessCode = c.accessCode || newCode();
    c.cpfHash = cpfHash;
    c.phone = tel;
    c.optMessages = optMessages !== false;
    c.optMessagesAt = now;
    c.termsAcceptedAt = now;
    c.refCode = c.refCode || newRefCode();
    c.tvCode = c.tvCode || tvCode;
    if (city) c.city = city;
    c.trialAt = c.trialAt || now;
    // Pedido antigo que nunca ativou aparelho: o relógio volta a zero e só começa na ativação.
    delete c.trialUntil;
    delete c.trialStartedAt;
    return c;
  });
  return { customer: saved };
}

export async function startCheckout(db, asaas, cfg, { plan: planId, name, email, cpf, phone, acceptTerms, optMessages, city, ref }) {
  const plan = cfg.plans.find((p) => p.id === planId);
  const mail = normEmail(email);
  const errors = {};
  if (!plan) errors.plan = 'Escolha um plano.';
  if (String(name || '').trim().split(/\s+/).length < 2) errors.name = 'Informe nome e sobrenome.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) errors.email = 'E-mail inválido.';
  if (!validCpf(cpf)) errors.cpf = 'CPF inválido.';
  const telDigits = normPhone(phone);
  if (!telDigits) errors.phone = PHONE_ERROR;
  if (!acceptTerms) errors.terms = 'É preciso aceitar os Termos de uso e a Política de privacidade.';
  if (Object.keys(errors).length) return { errors };
  const existing = await db.get(mail);
  const code = existing?.accessCode || newCode();
  const tvCode = existing?.tvCode || (await uniqueTvCode(db));
  // Indicação: vale só para quem nunca foi assinante, e não pode ser a própria pessoa.
  const cpfHashNew = await hashDoc(cpf);
  let referredBy = existing?.referredBy || null;
  if (!referredBy && ref && !existing?.paidUntil && !existing?.gateway) {
    const referrer = await db.byRefCode(ref);
    if (referrer && referrer.email !== mail && referrer.cpfHash !== cpfHashNew) referredBy = referrer.email;
  }
  // Assinaturas que nunca tiveram pagamento (cliques repetidos em "Assinar").
  const paidSubs = new Set(Object.values(existing?.orders || {}).filter((o) => o.financial === 'PAID' && o.subscription).map((o) => o.subscription));
  const unpaid = Object.keys(existing?.gateway?.subscriptions || {}).filter((id) => !paidSubs.has(id));
  const payingNow = existing?.paidUntil && Date.now() < existing.paidUntil;
  // Mesmo plano, sem pagar, nas últimas 24 h: reaproveita a fatura em vez de criar outra assinatura.
  if (!payingNow && unpaid.length && existing.lastInvoiceUrl && existing.plan === plan.id && Date.now() - (existing.checkoutAt || 0) < 24 * 3600e3)
    return { code, tvCode: existing.tvCode || tvCode, invoiceUrl: existing.lastInvoiceUrl, plan };
  const customerId = await asaas.ensureCustomer({ name: name.trim(), email: mail, cpf, phone: telDigits, ref: code });
  const sub = await asaas.createSubscription({ customerId, plan, code, tvCode });
  // Trocou de plano antes de pagar: cancela a assinatura anterior que nunca foi paga (evita cobrança em dobro).
  for (const id of unpaid) await asaas.cancelSubscription(id).catch((e) => console.warn('[checkout] não cancelou', id, e.message));
  const cpfHash = cpfHashNew;
  const saved = await db.update(mail, (c) => {
    c.name = name.trim();
    c.accessCode = code;
    c.tvCode = c.tvCode || tvCode;
    c.cpfHash = cpfHash;
    c.plan = plan.id;
    c.gateway = c.gateway || {};
    c.gateway.customerIds = [...new Set([...(c.gateway.customerIds || []), customerId])];
    c.gateway.subscriptions = { ...Object.fromEntries(Object.entries(c.gateway.subscriptions || {}).filter(([id]) => !unpaid.includes(id))), [sub.subscriptionId]: plan.id };
    c.lastInvoiceUrl = sub.invoiceUrl;
    c.checkoutAt = Date.now();
    c.termsAcceptedAt = Date.now();
    c.refCode = c.refCode || newRefCode();
    if (referredBy) c.referredBy = referredBy;
    if (city) c.city = city;
    c.phone = telDigits;
    // Autorização para receber avisos e novidades por WhatsApp (LGPD).
    c.optMessages = optMessages !== false;
    c.optMessagesAt = Date.now();
    delete c.cancelledAt;
    return c;
  });
  if (saved.referredBy && sub.firstPaymentId) await applyReferralSplit(db, asaas, cfg, saved, sub.firstPaymentId);
  return { code, tvCode: saved.tvCode, invoiceUrl: sub.invoiceUrl, plan };
}
