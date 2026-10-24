// Asaas: cobrança recorrente por PIX, boleto ou cartão (sem mensalidade). Mesmo comportamento do
// license-server/lib/payments/asaas.mjs, adaptado para a Cloudflare.
export function makeAsaas(cfg) {
  const a = cfg.asaas;
  const base = a.apiBase || (a.environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3');

  async function api(path, { method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(base + path, {
        method,
        headers: { access_token: a.apiKey, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'GATES-TV-Licencas' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      const j = await res.json().catch(() => ({}));
      if (res.status === 404) return null;
      if (!res.ok) {
        const err = new Error('Asaas: ' + (j.errors?.map((e) => e.description).join('; ') || `HTTP ${res.status}`));
        err.http = res.status;
        throw err;
      }
      return j;
    }
  }

  const PAID = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
  const toOrder = (p, planOf) => {
    const status = String(p.status || '').toUpperCase();
    const d = p.confirmedDate || p.paymentDate || p.clientPaymentDate || p.dueDate;
    return {
      id: String(p.id),
      name: String(p.id),
      paidAt: Date.parse(d + (String(d).length === 10 ? 'T12:00:00-03:00' : '')),
      cancelled: status.startsWith('REFUND') || status.startsWith('CHARGEBACK') || !!p.deleted,
      financial: PAID.has(status) ? 'PAID' : status,
      days: planOf(p)?.days || 30,
      subscription: p.subscription || null,
      value: p.value,
    };
  };

  return {
    configured: () => !!(a.apiKey || a.apiBase),
    async ensureCustomer({ name, email, cpf, phone, ref }) {
      const doc = String(cpf).replace(/\D/g, '');
      const cur = (await api(`/customers?cpfCnpj=${doc}`))?.data?.[0];
      if (cur) {
        if (cur.email !== email) await api(`/customers/${cur.id}`, { method: 'PUT', body: { email } }).catch(() => {});
        return cur.id;
      }
      const c = await api('/customers', { method: 'POST', body: { name, email, cpfCnpj: doc, mobilePhone: phone || undefined, externalReference: ref, notificationDisabled: false } });
      return c.id;
    },
    async createSubscription({ customerId, plan, code, tvCode }) {
      const body = {
        customer: customerId,
        billingType: a.billingType,
        value: plan.price,
        nextDueDate: new Date().toISOString().slice(0, 10),
        cycle: plan.cycle,
        description: `${cfg.brand} — plano ${plan.name}`,
        externalReference: code,
        // Depois de pagar, o cliente volta para a nossa página "Pagamento confirmado" (editável no painel).
        callback: { successUrl: `${cfg.publicUrl}/obrigado${tvCode ? '?tv=' + tvCode : ''}`, autoRedirect: true },
      };
      let sub;
      try {
        sub = await api('/subscriptions', { method: 'POST', body });
      } catch (err) {
        // O Asaas só aceita o retorno se o domínio estiver cadastrado em Minha Conta → Informações.
        // Sem isso, a venda não pode travar: cria a assinatura sem o redirecionamento.
        if (!/dom[ií]nio|site/i.test(err.message)) throw err;
        console.warn('[checkout] retorno recusado pelo Asaas, seguindo sem redirecionamento:', err.message);
        delete body.callback;
        sub = await api('/subscriptions', { method: 'POST', body });
      }
      const first = (await api(`/subscriptions/${sub.id}/payments`))?.data?.[0];
      return { subscriptionId: sub.id, invoiceUrl: first?.invoiceUrl || null, firstPaymentId: first?.id || null };
    },
    cancelSubscription: (id) => api(`/subscriptions/${id}`, { method: 'DELETE' }),
    fetchPayment: (id) => api(`/payments/${id}`),
    // Divide a cobrança com a carteira Asaas do indicador (ou remove a divisão: split = []).
    setPaymentSplit: (id, split) => api(`/payments/${id}`, { method: 'PUT', body: { split } }),
    async subscriptionPayments(subId) {
      return (await api(`/subscriptions/${subId}/payments`))?.data || [];
    },
    async fetchPayments(customerId, planOf) {
      const r = await api(`/payments?customer=${customerId}&limit=100`);
      return (r?.data || []).map((p) => toOrder(p, planOf));
    },
    fetchCustomer: (id) => api(`/customers/${id}`),
    async findCustomersByEmail(email) {
      return (await api(`/customers?email=${encodeURIComponent(email)}`))?.data || [];
    },
    async accountName() {
      const r = await api('/myAccount/commercialInfo');
      return r?.name || r?.companyName || 'Asaas';
    },
    // Webhook: o Asaas envia o token cadastrado no cabeçalho "asaas-access-token".
    verifyWebhook(req) {
      const got = req.headers.get('asaas-access-token') || '';
      if (!a.webhookToken || !got || got.length !== a.webhookToken.length) return false;
      let diff = 0;
      for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ a.webhookToken.charCodeAt(i);
      return diff === 0;
    },
  };
}
