// Checkout próprio: os pagamentos são lidos no Asaas (lib/payments/asaas.mjs).
import { config } from '../config.mjs';
import { getCustomer } from '../db.mjs';
import * as asaas from '../payments/asaas.mjs';

export const name = 'checkout';
export const label = 'Checkout próprio (Asaas)';
export const configured = () => asaas.configured();

const planById = (id) => config.checkout.plans.find((p) => p.id === id);

export async function fetchCustomerByEmail(email) {
  const local = getCustomer(email);
  let ids = local?.gateway?.customerIds || [];
  let doc = null;
  if (!ids.length) {
    const found = await asaas.findCustomerByEmail(email);
    ids = found.map((c) => c.id);
    doc = found[0]?.cpfCnpj || null;
  }
  if (!ids.length) return null;
  const subs = local?.gateway?.subscriptions || {};
  // Duração de cada pagamento: plano da assinatura; sem registro, pelo valor pago.
  const planOf = (p) => planById(subs[p.subscription]) || config.checkout.plans.find((x) => Math.abs(x.price - p.value) < 0.01);
  const orders = [];
  for (const id of ids) orders.push(...(await asaas.fetchPayments(id, planOf)));
  const extra = { gateway: { ...(local?.gateway || {}), customerIds: ids } };
  if (doc && !local?.cpfHash) {
    const { hashDoc } = await import('../license.mjs');
    extra.cpfHash = hashDoc(doc);
  }
  return { id: ids[0], email, tags: [], orders, extra };
}

export async function fetchOrderEmail(paymentCustomerId) {
  const c = await asaas.fetchCustomer(paymentCustomerId);
  return c?.email || null;
}

export const checkConnection = () => asaas.checkConnection();
export async function registerWebhooks() {
  return [{ topic: 'Asaas', status: `cadastre no painel do Asaas: Integrações → Webhooks → ${config.publicUrl}/webhooks/asaas (token = ASAAS_WEBHOOK_TOKEN)` }];
}
