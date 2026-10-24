// Asaas: cobrança recorrente por PIX, boleto ou cartão, sem mensalidade (só taxa por pagamento).
// Documentação: https://docs.asaas.com — conta de testes em https://sandbox.asaas.com
// Autenticação: cabeçalho "access_token: <ASAAS_API_KEY>".
import crypto from 'node:crypto';
import { config } from '../config.mjs';

const a = () => config.asaas;
export const configured = () => !!(a().apiKey || a().apiBase);
const base = () => a().apiBase || (a().environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3');

async function api(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base() + path, {
      method,
      headers: { access_token: a().apiKey, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'GATES-TV-Licencas' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const j = await res.json().catch(() => ({}));
    if (res.status === 404) return null;
    if (!res.ok) {
      const msg = j.errors?.map((e) => e.description).join('; ') || `HTTP ${res.status}`;
      const err = new Error('Asaas: ' + msg);
      err.http = res.status;
      throw err;
    }
    return j;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

// Cliente (reaproveita se já existir com o mesmo CPF/CNPJ).
export async function ensureCustomer({ name, email, cpf, phone, ref }) {
  const doc = String(cpf).replace(/\D/g, '');
  const found = await api(`/customers?cpfCnpj=${doc}`);
  const cur = found?.data?.[0];
  if (cur) {
    if (cur.email !== email) await api(`/customers/${cur.id}`, { method: 'PUT', body: { email } }).catch(() => {});
    return cur.id;
  }
  const c = await api('/customers', { method: 'POST', body: { name, email, cpfCnpj: doc, mobilePhone: phone || undefined, externalReference: ref, notificationDisabled: false } });
  return c.id;
}

// Assinatura: o Asaas gera uma cobrança por ciclo e avisa o cliente (e-mail/SMS) sozinho.
// Devolve a fatura da 1ª cobrança (página do Asaas com PIX, boleto e cartão).
export async function createSubscription({ customerId, plan, code, brand }) {
  const sub = await api('/subscriptions', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType: a().billingType,
      value: plan.price,
      nextDueDate: today(),
      cycle: plan.cycle,
      description: `${brand} — plano ${plan.name}`,
      externalReference: code,
    },
  });
  const pays = await api(`/subscriptions/${sub.id}/payments`);
  const first = pays?.data?.[0];
  return { subscriptionId: sub.id, invoiceUrl: first?.invoiceUrl || null, paymentId: first?.id || null };
}

export async function cancelSubscription(id) {
  return api(`/subscriptions/${id}`, { method: 'DELETE' });
}

const PAID = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

// Pagamentos de um cliente no formato de "pedido" usado pelas regras da licença.
export async function fetchPayments(customerId, planOf) {
  const r = await api(`/payments?customer=${customerId}&limit=100`);
  return (r?.data || []).map((p) => toOrder(p, planOf));
}

export function toOrder(p, planOf) {
  const status = String(p.status || '').toUpperCase();
  const paidDate = p.confirmedDate || p.paymentDate || p.clientPaymentDate || p.dueDate;
  return {
    id: String(p.id),
    name: String(p.id),
    paidAt: Date.parse(paidDate + (String(paidDate).length === 10 ? 'T12:00:00-03:00' : '')),
    cancelled: status.startsWith('REFUND') || status === 'CHARGEBACK_REQUESTED' || status === 'CHARGEBACK_DISPUTE' || !!p.deleted,
    financial: PAID.has(status) ? 'PAID' : status,
    days: planOf(p)?.days || 30,
    subscription: p.subscription || null,
    value: p.value,
    invoiceUrl: p.invoiceUrl,
  };
}

export async function fetchCustomer(id) {
  return api(`/customers/${id}`);
}
export async function findCustomerByEmail(email) {
  const r = await api(`/customers?email=${encodeURIComponent(email)}`);
  return r?.data || [];
}
export async function fetchSubscription(id) {
  return api(`/subscriptions/${id}`);
}

// Webhook: o Asaas envia o token cadastrado no cabeçalho "asaas-access-token".
export function verifyWebhook(req) {
  const want = a().webhookToken;
  const got = String(req.headers['asaas-access-token'] || '');
  if (!want || !got) return false;
  const x = Buffer.from(got);
  const y = Buffer.from(want);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function checkConnection() {
  const r = await api('/myAccount/commercialInfo').catch(() => api('/finance/balance'));
  return { shop: r?.name || r?.companyName || 'Asaas', domain: a().environment, scopes: [] };
}
