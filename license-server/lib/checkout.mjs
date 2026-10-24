// Fluxo do checkout próprio: valida os dados, cria cliente + assinatura no Asaas e devolve o
// código de acesso (para entrar no app) e o link da fatura (PIX, boleto ou cartão).
import crypto from 'node:crypto';
import { config } from './config.mjs';
import { getCustomer, normEmail, upsertCustomer } from './db.mjs';
import { hashDoc } from './license.mjs';
import * as asaas from './payments/asaas.mjs';

export function validCpf(v) {
  const d = String(v).replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => 'GTV-' + Array.from(crypto.randomBytes(8), (x, i) => (i === 4 ? '-' : '') + CHARS[x % CHARS.length]).join('');

export async function startCheckout({ plan: planId, name, email, cpf, phone }) {
  const plan = config.checkout.plans.find((p) => p.id === planId);
  const mail = normEmail(email);
  const errors = {};
  if (!plan) errors.plan = 'Escolha um plano.';
  if (String(name || '').trim().split(/\s+/).length < 2) errors.name = 'Informe nome e sobrenome.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) errors.email = 'E-mail inválido.';
  if (!validCpf(cpf)) errors.cpf = 'CPF inválido.';
  if (Object.keys(errors).length) return { errors };

  const existing = getCustomer(mail);
  const code = existing?.accessCode || newCode();
  const customerId = await asaas.ensureCustomer({ name: name.trim(), email: mail, cpf, phone, ref: code });
  const sub = await asaas.createSubscription({ customerId, plan, code, brand: config.checkout.brand });
  upsertCustomer(mail, (c) => {
    c.name = name.trim();
    c.accessCode = code;
    c.cpfHash = hashDoc(cpf);
    c.plan = plan.id;
    c.gateway = c.gateway || {};
    c.gateway.customerIds = [...new Set([...(c.gateway.customerIds || []), customerId])];
    c.gateway.subscriptions = { ...(c.gateway.subscriptions || {}), [sub.subscriptionId]: plan.id };
    c.lastInvoiceUrl = sub.invoiceUrl;
    c.checkoutAt = Date.now();
    return c;
  });
  return { code, invoiceUrl: sub.invoiceUrl, plan };
}
