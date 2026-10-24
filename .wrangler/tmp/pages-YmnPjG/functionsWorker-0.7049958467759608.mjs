var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../src/config.js
var s = /* @__PURE__ */ __name((env, k, d = "") => String(env[k] ?? d).trim(), "s");
var n = /* @__PURE__ */ __name((env, k, d) => s(env, k) === "" ? d : Number(s(env, k)), "n");
function makeConfig(env) {
  const plansRaw = s(env, "PLANS", "mensal:Mensal:29.90:30:MONTHLY");
  return {
    publicUrl: s(env, "PUBLIC_URL", "https://gatesapptv.pages.dev").replace(/\/$/, ""),
    brand: s(env, "BRAND_NAME", "GATES! TV"),
    plans: plansRaw.split(",").map((x) => x.trim()).filter(Boolean).map((p) => {
      const [id, name, price, days, cycle] = p.split(":");
      return { id: id.trim(), name: (name || id).trim(), price: Number(price) || 0, days: Number(days) || 30, cycle: (cycle || "MONTHLY").trim().toUpperCase() };
    }),
    downloads: {
      tv: s(env, "DOWNLOAD_TV"),
      tvLite: s(env, "DOWNLOAD_TV_LITE"),
      phone: s(env, "DOWNLOAD_PHONE"),
      phoneLite: s(env, "DOWNLOAD_PHONE_LITE"),
      tablet: s(env, "DOWNLOAD_TABLET"),
      windows: s(env, "DOWNLOAD_WINDOWS")
    },
    support: s(env, "SUPPORT_WHATSAPP"),
    company: s(env, "COMPANY_NAME"),
    contactEmail: s(env, "CONTACT_EMAIL"),
    cnpj: s(env, "COMPANY_CNPJ"),
    address: s(env, "COMPANY_ADDRESS"),
    graceDays: n(env, "GRACE_DAYS", 4),
    // Programa de indicação: % de cada mensalidade paga pelo indicado (split do Asaas).
    referralPercent: n(env, "REFERRAL_PERCENT", 20),
    toleranceHours: n(env, "PAYMENT_TOLERANCE_HOURS", 36),
    tokenDays: n(env, "TOKEN_DAYS", 3),
    maxDevices: n(env, "MAX_DEVICES", 3),
    resyncMinutes: n(env, "RESYNC_MINUTES", 30),
    adminToken: s(env, "ADMIN_TOKEN"),
    privateJwk: s(env, "LICENSE_PRIVATE_JWK"),
    corsOrigins: s(env, "CORS_ORIGINS").split(",").map((x) => x.trim()).filter(Boolean),
    appConfig: { tmdbKey: s(env, "APP_TMDB_KEY"), omdbKey: s(env, "APP_OMDB_KEY"), supportUrl: s(env, "SUPPORT_URL") },
    asaas: {
      apiKey: s(env, "ASAAS_API_KEY"),
      environment: s(env, "ASAAS_ENV", "sandbox").toLowerCase(),
      webhookToken: s(env, "ASAAS_WEBHOOK_TOKEN"),
      billingType: s(env, "ASAAS_BILLING_TYPE", "UNDEFINED").toUpperCase(),
      apiBase: s(env, "ASAAS_API_BASE")
    }
  };
}
__name(makeConfig, "makeConfig");

// ../src/db.js
var normEmail = /* @__PURE__ */ __name((e) => String(e || "").trim().toLowerCase(), "normEmail");
function makeDb(D1) {
  const now = /* @__PURE__ */ __name(() => Date.now(), "now");
  return {
    async get(email) {
      const r = await D1.prepare("SELECT data FROM customers WHERE email = ?").bind(normEmail(email)).first();
      return r ? JSON.parse(r.data) : null;
    },
    // Atualiza com uma função (lê, altera, grava). Cria o cadastro se não existir.
    async update(email, fn) {
      const key = normEmail(email);
      const cur = await this.get(key) || { email: key, orders: {}, devices: {}, createdAt: now() };
      const next = await fn(structuredClone(cur)) || cur;
      next.updatedAt = now();
      await D1.prepare("INSERT INTO customers (email, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(key, JSON.stringify(next), next.updatedAt).run();
      return next;
    },
    async remove(email) {
      await D1.prepare("DELETE FROM customers WHERE email = ?").bind(normEmail(email)).run();
    },
    async list() {
      const r = await D1.prepare("SELECT data FROM customers ORDER BY updated_at DESC LIMIT 5000").all();
      return (r.results || []).map((x) => JSON.parse(x.data));
    },
    async byRefCode(code) {
      const c = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!c) return null;
      const r = await D1.prepare("SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 1").bind(`"refCode":"${c}"`).first();
      return r ? JSON.parse(r.data) : null;
    },
    async referredBy(email) {
      const r = await D1.prepare("SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 500").bind(`"referredBy":"${String(email).replace(/"/g, "")}"`).all();
      return (r.results || []).map((x) => JSON.parse(x.data));
    },
    async byGatewayCustomer(id) {
      const r = await D1.prepare("SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 1").bind(`"${String(id).replace(/"/g, "")}"`).first();
      return r ? JSON.parse(r.data) : null;
    },
    // Webhooks já processados (o Asaas pode reenviar o mesmo evento).
    async seenWebhook(id) {
      if (!id) return false;
      const r = await D1.prepare("INSERT OR IGNORE INTO webhooks (id, at) VALUES (?, ?)").bind(String(id), now()).run();
      if (Math.random() < 0.02) await D1.prepare("DELETE FROM webhooks WHERE at < ?").bind(now() - 7 * 864e5).run();
      return !r.meta?.changes;
    },
    // Limite de tentativas (protege contra adivinhar CPF/código).
    async limited(k, max, windowMs) {
      const since = now() - windowMs;
      const r = await D1.prepare("SELECT COUNT(*) AS c FROM hits WHERE k = ? AND at > ?").bind(k, since).first();
      await D1.prepare("INSERT INTO hits (k, at) VALUES (?, ?)").bind(k, now()).run();
      if (Math.random() < 0.02) await D1.prepare("DELETE FROM hits WHERE at < ?").bind(now() - 36e5).run();
      return (r?.c || 0) >= max;
    },
    // Textos editáveis pelo painel (ex.: página de confirmação de compra).
    settings: {
      async get(k) {
        const r = await D1.prepare("SELECT v FROM settings WHERE k = ?").bind(k).first();
        return r ? JSON.parse(r.v) : null;
      },
      async put(k, v) {
        await D1.prepare("INSERT INTO settings (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at").bind(k, JSON.stringify(v), now()).run();
      }
    },
    // Links de download temporários (código curto, ex.: /d/AB12CD, para digitar na TV).
    downloads: {
      async put(code, file, email, expiresAt) {
        await D1.prepare("INSERT INTO downloads (code, file, email, expires_at) VALUES (?, ?, ?, ?)").bind(code, file, email, expiresAt).run();
        if (Math.random() < 0.05) await D1.prepare("DELETE FROM downloads WHERE expires_at < ?").bind(now()).run();
      },
      async get(code) {
        return D1.prepare("SELECT * FROM downloads WHERE code = ? AND expires_at > ?").bind(code, now()).first();
      }
    },
    pairs: {
      async put(p) {
        await D1.prepare("INSERT INTO pairs (id, code, data, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").bind(p.id, p.code, JSON.stringify(p), p.expiresAt).run();
      },
      async get(id) {
        const r = await D1.prepare("SELECT data FROM pairs WHERE id = ?").bind(id).first();
        return r ? JSON.parse(r.data) : null;
      },
      async byCode(code) {
        const r = await D1.prepare("SELECT data FROM pairs WHERE code = ? AND expires_at > ?").bind(code, now()).first();
        return r ? JSON.parse(r.data) : null;
      },
      async del(id) {
        await D1.prepare("DELETE FROM pairs WHERE id = ?").bind(id).run();
        if (Math.random() < 0.05) await D1.prepare("DELETE FROM pairs WHERE expires_at < ?").bind(now() - 36e5).run();
      }
    }
  };
}
__name(makeDb, "makeDb");

// ../src/asaas.js
function makeAsaas(cfg) {
  const a = cfg.asaas;
  const base = a.apiBase || (a.environment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3");
  async function api(path, { method = "GET", body } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(base + path, {
        method,
        headers: { access_token: a.apiKey, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "GATES-TV-Licencas" },
        body: body ? JSON.stringify(body) : void 0
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      const j = await res.json().catch(() => ({}));
      if (res.status === 404) return null;
      if (!res.ok) {
        const err = new Error("Asaas: " + (j.errors?.map((e) => e.description).join("; ") || `HTTP ${res.status}`));
        err.http = res.status;
        throw err;
      }
      return j;
    }
  }
  __name(api, "api");
  const PAID2 = /* @__PURE__ */ new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
  const toOrder = /* @__PURE__ */ __name((p, planOf) => {
    const status = String(p.status || "").toUpperCase();
    const d = p.confirmedDate || p.paymentDate || p.clientPaymentDate || p.dueDate;
    return {
      id: String(p.id),
      name: String(p.id),
      paidAt: Date.parse(d + (String(d).length === 10 ? "T12:00:00-03:00" : "")),
      cancelled: status.startsWith("REFUND") || status.startsWith("CHARGEBACK") || !!p.deleted,
      financial: PAID2.has(status) ? "PAID" : status,
      days: planOf(p)?.days || 30,
      subscription: p.subscription || null,
      value: p.value
    };
  }, "toOrder");
  return {
    configured: /* @__PURE__ */ __name(() => !!(a.apiKey || a.apiBase), "configured"),
    async ensureCustomer({ name, email, cpf, phone, ref }) {
      const doc = String(cpf).replace(/\D/g, "");
      const cur = (await api(`/customers?cpfCnpj=${doc}`))?.data?.[0];
      if (cur) {
        if (cur.email !== email) await api(`/customers/${cur.id}`, { method: "PUT", body: { email } }).catch(() => {
        });
        return cur.id;
      }
      const c = await api("/customers", { method: "POST", body: { name, email, cpfCnpj: doc, mobilePhone: phone || void 0, externalReference: ref, notificationDisabled: false } });
      return c.id;
    },
    async createSubscription({ customerId, plan, code }) {
      const sub = await api("/subscriptions", {
        method: "POST",
        body: {
          customer: customerId,
          billingType: a.billingType,
          value: plan.price,
          nextDueDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          cycle: plan.cycle,
          description: `${cfg.brand} \u2014 plano ${plan.name}`,
          externalReference: code,
          // Depois de pagar, o cliente volta para a nossa página "Pagamento confirmado" (editável no painel).
          callback: { successUrl: `${cfg.publicUrl}/obrigado`, autoRedirect: true }
        }
      });
      const first = (await api(`/subscriptions/${sub.id}/payments`))?.data?.[0];
      return { subscriptionId: sub.id, invoiceUrl: first?.invoiceUrl || null, firstPaymentId: first?.id || null };
    },
    cancelSubscription: /* @__PURE__ */ __name((id) => api(`/subscriptions/${id}`, { method: "DELETE" }), "cancelSubscription"),
    fetchPayment: /* @__PURE__ */ __name((id) => api(`/payments/${id}`), "fetchPayment"),
    // Divide a cobrança com a carteira Asaas do indicador (ou remove a divisão: split = []).
    setPaymentSplit: /* @__PURE__ */ __name((id, split) => api(`/payments/${id}`, { method: "PUT", body: { split } }), "setPaymentSplit"),
    async subscriptionPayments(subId) {
      return (await api(`/subscriptions/${subId}/payments`))?.data || [];
    },
    async fetchPayments(customerId, planOf) {
      const r = await api(`/payments?customer=${customerId}&limit=100`);
      return (r?.data || []).map((p) => toOrder(p, planOf));
    },
    fetchCustomer: /* @__PURE__ */ __name((id) => api(`/customers/${id}`), "fetchCustomer"),
    async findCustomersByEmail(email) {
      return (await api(`/customers?email=${encodeURIComponent(email)}`))?.data || [];
    },
    async accountName() {
      const r = await api("/myAccount/commercialInfo");
      return r?.name || r?.companyName || "Asaas";
    },
    // Webhook: o Asaas envia o token cadastrado no cabeçalho "asaas-access-token".
    verifyWebhook(req) {
      const got = req.headers.get("asaas-access-token") || "";
      if (!a.webhookToken || !got || got.length !== a.webhookToken.length) return false;
      let diff = 0;
      for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ a.webhookToken.charCodeAt(i);
      return diff === 0;
    }
  };
}
__name(makeAsaas, "makeAsaas");

// ../src/license.js
var DAY = 864e5;
var enc = new TextEncoder();
var b64u = /* @__PURE__ */ __name((bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64u");
var fromB64u = /* @__PURE__ */ __name((s2) => Uint8Array.from(atob(s2.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s2.length / 4) * 4, "=")), (c) => c.charCodeAt(0)), "fromB64u");
var hex = /* @__PURE__ */ __name((buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join(""), "hex");
async function hashDoc(doc) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode("gates-doc:" + String(doc).replace(/\D/g, ""))));
}
__name(hashDoc, "hashDoc");
var subscriptionDays = /* @__PURE__ */ __name((o) => o.days || 30, "subscriptionDays");
var PAID = /* @__PURE__ */ new Set(["PAID", "PARTIALLY_REFUNDED"]);
var orderCounts = /* @__PURE__ */ __name((o) => !o.cancelled && PAID.has(o.financial) && subscriptionDays(o) > 0, "orderCounts");
function computePaidUntil(orders, cfg) {
  const valid = Object.values(orders || {}).filter(orderCounts).sort((a, b) => a.paidAt - b.paidAt);
  let until = 0;
  for (const o of valid) until = Math.max(o.paidAt, until) + subscriptionDays(o) * DAY;
  return until ? until + cfg.toleranceHours * 36e5 : 0;
}
__name(computePaidUntil, "computePaidUntil");
function evaluate(c, cfg, now = Date.now()) {
  if (!c) return { status: "suspended", reason: "no_subscription", paidUntil: 0, suspendAt: 0 };
  if (c.override === "blocked") return { status: "suspended", reason: "blocked", paidUntil: c.paidUntil || 0, suspendAt: 0 };
  if (c.override === "active" && (!c.overrideUntil || c.overrideUntil > now)) {
    const until = c.overrideUntil || now + 365 * DAY;
    return { status: "active", reason: "manual", paidUntil: Math.max(until, c.paidUntil || 0), suspendAt: 0 };
  }
  const paidUntil = c.paidUntil || 0;
  if (!paidUntil && c.lastInvoiceUrl) return { status: "suspended", reason: "awaiting_payment", paidUntil: 0, suspendAt: 0 };
  if (!paidUntil) return { status: "suspended", reason: "no_subscription", paidUntil: 0, suspendAt: 0 };
  const suspendAt = paidUntil + cfg.graceDays * DAY;
  if (now <= paidUntil) return { status: "active", reason: "paid", paidUntil, suspendAt };
  if (now <= suspendAt) return { status: "grace", reason: "payment_overdue", paidUntil, suspendAt };
  return { status: "suspended", reason: "payment_overdue", paidUntil, suspendAt };
}
__name(evaluate, "evaluate");
async function matchLogin(c, typed) {
  const n2 = String(typed || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
  if (!n2 || !c) return false;
  if (c.accessCode && n2 === String(c.accessCode).replace(/[^0-9a-z]/gi, "").toLowerCase()) return true;
  if (c.cpfHash && /^\d{11}$|^\d{14}$/.test(n2) && c.cpfHash === await hashDoc(n2)) return true;
  return false;
}
__name(matchLogin, "matchLogin");
var keys = null;
async function loadKeys(cfg) {
  if (keys) return keys;
  if (!cfg.privateJwk) throw new Error("LICENSE_PRIVATE_JWK n\xE3o configurado.");
  const jwk = JSON.parse(cfg.privateJwk);
  const priv = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const pub = await crypto.subtle.importKey("jwk", { ...pubJwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  keys = { priv, pub, pubJwk };
  return keys;
}
__name(loadKeys, "loadKeys");
async function publicJwk(cfg) {
  return (await loadKeys(cfg)).pubJwk;
}
__name(publicJwk, "publicJwk");
async function signToken(payload, cfg) {
  const { priv } = await loadKeys(cfg);
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, enc.encode(body));
  return `${body}.${b64u(sig)}`;
}
__name(signToken, "signToken");
async function readToken(token, cfg) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  try {
    const { pub } = await loadKeys(cfg);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64u(sig), enc.encode(body));
    return ok ? JSON.parse(new TextDecoder().decode(fromB64u(body))) : null;
  } catch {
    return null;
  }
}
__name(readToken, "readToken");
async function issueLicense(c, deviceId, cfg) {
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
    )
  };
}
__name(issueLicense, "issueLicense");
async function registerDevice(db, email, device2, cfg) {
  let error = null;
  const c = await db.update(email, (c2) => {
    c2.devices = c2.devices || {};
    const now = Date.now();
    for (const [id, d] of Object.entries(c2.devices)) if (now - d.lastSeen > 30 * DAY) delete c2.devices[id];
    if (!c2.devices[device2.id] && Object.keys(c2.devices).length >= cfg.maxDevices) {
      error = "device_limit";
      return c2;
    }
    c2.devices[device2.id] = {
      ...c2.devices[device2.id] || { firstSeen: now },
      name: device2.name || "",
      platform: device2.platform || "",
      lastSeen: now,
      ...device2.city ? { city: device2.city } : {}
    };
    return c2;
  });
  return { customer: c, error };
}
__name(registerDevice, "registerDevice");

// ../src/subscribers.js
function makeSubscribers(db, asaas, cfg) {
  const planById = /* @__PURE__ */ __name((id) => cfg.plans.find((p) => p.id === id), "planById");
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
    const planOf = /* @__PURE__ */ __name((p) => planById(subs[p.subscription]) || cfg.plans.find((x) => Math.abs(x.price - p.value) < 0.01), "planOf");
    const orders = [];
    for (const id of ids) orders.push(...await asaas.fetchPayments(id, planOf));
    const cpfHash = doc && !local?.cpfHash ? await hashDoc(doc) : null;
    return db.update(email, (c) => {
      c.gateway = { ...c.gateway || {}, customerIds: ids };
      if (cpfHash) c.cpfHash = cpfHash;
      for (const o of orders) c.orders[o.id] = o;
      c.paidUntil = computePaidUntil(c.orders, cfg);
      c.syncedAt = Date.now();
      return c;
    });
  }
  __name(sync, "sync");
  async function fresh(email, { force = false } = {}) {
    let c = await db.get(email);
    const stale = !c?.syncedAt || Date.now() - c.syncedAt > cfg.resyncMinutes * 6e4;
    if (asaas.configured() && (force || stale || evaluate(c, cfg).status !== "active")) {
      try {
        c = await sync(email);
      } catch (err) {
        console.warn("[asaas] falha ao sincronizar", err.message);
      }
    }
    return c;
  }
  __name(fresh, "fresh");
  return { sync, fresh };
}
__name(makeSubscribers, "makeSubscribers");
function validCpf(v) {
  const d = String(v).replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = /* @__PURE__ */ __name((k) => {
    let s2 = 0;
    for (let i = 0; i < k; i++) s2 += Number(d[i]) * (k + 1 - i);
    const r = s2 * 10 % 11;
    return r === 10 ? 0 : r;
  }, "calc");
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
__name(validCpf, "validCpf");
var CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var newCode = /* @__PURE__ */ __name(() => "GTV-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (x, i) => (i === 4 ? "-" : "") + CHARS[x % CHARS.length]).join(""), "newCode");
var REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var newRefCode = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => REF_CHARS[x % REF_CHARS.length]).join(""), "newRefCode");
async function applyReferralSplit(db, asaas, cfg, referee, paymentId) {
  if (!referee?.referredBy || !paymentId) return null;
  const ref = await db.get(referee.referredBy);
  const ok = ref && ref.walletId && evaluate(ref, cfg).status === "active" && ref.email !== referee.email;
  const split = ok ? [{ walletId: ref.walletId, percentualValue: cfg.referralPercent }] : [];
  try {
    await asaas.setPaymentSplit(paymentId, split);
  } catch (err) {
    console.warn("[indica\xE7\xE3o] split n\xE3o aplicado", paymentId, err.message);
    return null;
  }
  await db.update(referee.email, (c) => {
    c.splits = c.splits || {};
    c.splits[paymentId] = ok ? ref.walletId : null;
    return c;
  });
  return ok;
}
__name(applyReferralSplit, "applyReferralSplit");
async function recordCommission(db, cfg, referee, payment) {
  const wallet = referee?.splits?.[payment.id];
  if (!wallet || !referee.referredBy) return;
  await db.update(referee.referredBy, (c) => {
    c.commissions = c.commissions || {};
    if (!c.commissions[payment.id])
      c.commissions[payment.id] = { from: referee.name || referee.email, value: Math.round(Number(payment.value || 0) * cfg.referralPercent) / 100, at: Date.now() };
    return c;
  });
}
__name(recordCommission, "recordCommission");
async function startCheckout(db, asaas, cfg, { plan: planId, name, email, cpf, phone, acceptTerms, city, ref }) {
  const plan = cfg.plans.find((p) => p.id === planId);
  const mail = normEmail(email);
  const errors = {};
  if (!plan) errors.plan = "Escolha um plano.";
  if (String(name || "").trim().split(/\s+/).length < 2) errors.name = "Informe nome e sobrenome.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) errors.email = "E-mail inv\xE1lido.";
  if (!validCpf(cpf)) errors.cpf = "CPF inv\xE1lido.";
  if (!acceptTerms) errors.terms = "\xC9 preciso aceitar os Termos de uso e a Pol\xEDtica de privacidade.";
  if (Object.keys(errors).length) return { errors };
  const existing = await db.get(mail);
  const code = existing?.accessCode || newCode();
  const cpfHashNew = await hashDoc(cpf);
  let referredBy = existing?.referredBy || null;
  if (!referredBy && ref && !existing?.paidUntil && !existing?.gateway) {
    const referrer = await db.byRefCode(ref);
    if (referrer && referrer.email !== mail && referrer.cpfHash !== cpfHashNew) referredBy = referrer.email;
  }
  const customerId = await asaas.ensureCustomer({ name: name.trim(), email: mail, cpf, phone, ref: code });
  const sub = await asaas.createSubscription({ customerId, plan, code });
  const cpfHash = cpfHashNew;
  const saved = await db.update(mail, (c) => {
    c.name = name.trim();
    c.accessCode = code;
    c.cpfHash = cpfHash;
    c.plan = plan.id;
    c.gateway = c.gateway || {};
    c.gateway.customerIds = [.../* @__PURE__ */ new Set([...c.gateway.customerIds || [], customerId])];
    c.gateway.subscriptions = { ...c.gateway.subscriptions || {}, [sub.subscriptionId]: plan.id };
    c.lastInvoiceUrl = sub.invoiceUrl;
    c.checkoutAt = Date.now();
    c.termsAcceptedAt = Date.now();
    c.refCode = c.refCode || newRefCode();
    if (referredBy) c.referredBy = referredBy;
    if (city) c.city = city;
    delete c.cancelledAt;
    return c;
  });
  if (saved.referredBy && sub.firstPaymentId) await applyReferralSplit(db, asaas, cfg, saved, sub.firstPaymentId);
  return { code, invoiceUrl: sub.invoiceUrl, plan };
}
__name(startCheckout, "startCheckout");

// ../src/app.js
var json = /* @__PURE__ */ __name((code, obj, headers = {}) => new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } }), "json");
var MESSAGES = /* @__PURE__ */ __name((cfg) => ({
  bad_request: "Dados incompletos.",
  not_found: "N\xE3o encontramos uma assinatura com este e-mail e CPF (ou c\xF3digo de acesso).",
  device_limit: `Limite de ${cfg.maxDevices} aparelhos atingido. Remova um aparelho antigo em "Minha conta" para usar neste.`,
  invalid_token: "Licen\xE7a inv\xE1lida. Entre novamente.",
  device_mismatch: "Esta licen\xE7a pertence a outro aparelho.",
  rate_limited: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  pair_expired: "O c\xF3digo expirou. Gere um novo c\xF3digo no aparelho.",
  unavailable: "N\xE3o foi poss\xEDvel concluir agora. Tente novamente em instantes."
}), "MESSAGES");
function corsHeaders(req, cfg) {
  const origin = req.headers.get("Origin");
  if (!origin) return {};
  const ok = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) || cfg.corsOrigins.includes(origin) || origin === cfg.publicUrl;
  return ok ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" } : {};
}
__name(corsHeaders, "corsHeaders");
var APKS = {
  tv: { key: "apk:tv", name: "GatesTV-TV.apk", label: "Android TV / TV Box" },
  tvLite: { key: "apk:tvLite", name: "GatesTV-TV-LITE.apk", label: "Android TV / TV Box (LITE)" },
  phone: { key: "apk:phone", name: "GatesTV-Celular.apk", label: "Celular Android" },
  phoneLite: { key: "apk:phoneLite", name: "GatesTV-Celular-LITE.apk", label: "Celular Android (LITE)" },
  tablet: { key: "apk:tablet", name: "GatesTV-Tablet.apk", label: "Tablet Android" },
  tabletLite: { key: "apk:tabletLite", name: "GatesTV-Tablet-LITE.apk", label: "Tablet Android (LITE)" }
};
var DL_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var dlCode = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => DL_CHARS[x % DL_CHARS.length]).join(""), "dlCode");
var CONFIRMATION_DEFAULT = {
  titulo: "Quase l\xE1!",
  subtitulo: "Guarde seu c\xF3digo de acesso (ele tamb\xE9m funciona junto com o seu e-mail):",
  botaoPagar: "Pagar agora (PIX, boleto ou cart\xE3o)",
  passos: [
    "Pague a primeira mensalidade no bot\xE3o acima. Com PIX ou cart\xE3o, a libera\xE7\xE3o \xE9 na hora.",
    "Baixe e instale o app em Minha conta (o download \xE9 liberado assim que o pagamento \xE9 confirmado). Veja o passo a passo de instala\xE7\xE3o.",
    "No app, entre com o seu e-mail e o CPF (ou o c\xF3digo acima). Na TV, use a op\xE7\xE3o de c\xF3digo e confirme pelo celular."
  ],
  rodape: "As pr\xF3ximas mensalidades chegam por e-mail. Se atrasar, voc\xEA tem 4 dias antes da suspens\xE3o.",
  whatsapp: "D\xFAvidas? Fale com a gente no WhatsApp."
};
var PAID_DEFAULT = {
  titulo: "Pagamento confirmado! \u{1F389}",
  texto: "Bem-vindo ao GATES! TV. Sua assinatura j\xE1 est\xE1 liberada.",
  passos: [
    "Baixe o app em Minha conta (escolha a vers\xE3o do seu aparelho).",
    "Siga o passo a passo de instala\xE7\xE3o, se for a primeira vez.",
    "Entre no app com o seu e-mail e o CPF (ou o c\xF3digo de acesso)."
  ],
  botao: "Ir para Minha conta",
  whatsapp: "Precisa de ajuda? Fale com a gente no WhatsApp."
};
var clean = /* @__PURE__ */ __name((v, max) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max), "clean");
var cleanConfirmation = /* @__PURE__ */ __name((b) => ({
  titulo: clean(b.titulo, 80) || CONFIRMATION_DEFAULT.titulo,
  subtitulo: clean(b.subtitulo, 300),
  botaoPagar: clean(b.botaoPagar, 60) || CONFIRMATION_DEFAULT.botaoPagar,
  passos: (Array.isArray(b.passos) ? b.passos : []).map((x) => clean(x, 400)).filter(Boolean).slice(0, 6),
  rodape: clean(b.rodape, 400),
  whatsapp: clean(b.whatsapp, 120)
}), "cleanConfirmation");
var device = /* @__PURE__ */ __name((b) => ({ id: String(b.deviceId || "").slice(0, 80), name: String(b.deviceName || "").slice(0, 80), platform: String(b.platform || "").slice(0, 20) }), "device");
var CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var pairCode = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => CODE_CHARS[x % CODE_CHARS.length]).join(""), "pairCode");
var randomId = /* @__PURE__ */ __name(() => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]), "randomId");
async function handle(req, env) {
  const cfg = makeConfig(env);
  const cors = corsHeaders(req, cfg);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const res = await route(req, env, cfg).catch((err) => {
    console.error("[erro]", err?.stack || err);
    const dbg = cfg.adminToken && req.headers.get("X-Debug") === cfg.adminToken ? { detail: String(err?.stack || err).slice(0, 800) } : {};
    return json(503, { ok: false, error: "unavailable", message: MESSAGES(cfg).unavailable, ...dbg });
  });
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}
__name(handle, "handle");
async function route(req, env, cfg) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/$/, "") || "/";
  const msg = MESSAGES(cfg);
  const fail = /* @__PURE__ */ __name((code, error) => json(code, { ok: false, error, message: msg[error] || error }), "fail");
  const db = makeDb(env.DB);
  const asaas = makeAsaas(cfg);
  const subs = makeSubscribers(db, asaas, cfg);
  const ip = req.headers.get("CF-Connecting-IP") || "x";
  const city = [req.cf?.city, req.cf?.regionCode].filter(Boolean).join("/");
  const raw = req.method === "POST" || req.method === "DELETE" ? await req.text() : "";
  let b = {};
  if (raw) {
    try {
      b = JSON.parse(raw);
    } catch {
      if (!p.startsWith("/webhooks")) return fail(400, "bad_request");
    }
  }
  if (p === "/health") return json(200, { ok: true, store: "checkout", connected: asaas.configured(), time: Date.now() });
  if (p === "/api/v1/public-key") return json(200, { ok: true, jwk: await publicJwk(cfg) });
  if (p === "/api/v1/plans")
    return json(200, {
      ok: true,
      company: cfg.company,
      contactEmail: cfg.contactEmail,
      cnpj: cfg.cnpj,
      address: cfg.address,
      brand: cfg.brand,
      plans: cfg.plans.map(({ id, name, price, days }) => ({ id, name, price, days })),
      downloads: cfg.downloads,
      support: cfg.support,
      maxDevices: cfg.maxDevices,
      graceDays: cfg.graceDays,
      referralPercent: cfg.referralPercent
    });
  if (p === "/api/v1/content/obrigado")
    return json(200, { ok: true, content: { ...PAID_DEFAULT, ...await db.settings.get("obrigado") || {} }, support: cfg.support });
  if (p === "/api/v1/content/confirmacao")
    return json(200, { ok: true, content: { ...CONFIRMATION_DEFAULT, ...await db.settings.get("confirmacao") || {} }, support: cfg.support });
  if (p === "/api/v1/checkout" && req.method === "POST") {
    if (await db.limited("chk:" + ip, 8, 15 * 6e4)) return fail(429, "rate_limited");
    if (!asaas.configured()) return json(503, { ok: false, error: "unavailable", message: "Pagamentos ainda n\xE3o configurados." });
    try {
      const r = await startCheckout(db, asaas, cfg, { ...b, city, ref: b.ref });
      if (r.errors) return json(400, { ok: false, error: "invalid", errors: r.errors, message: Object.values(r.errors)[0] });
      return json(200, { ok: true, code: r.code, invoiceUrl: r.invoiceUrl, plan: r.plan.name, downloads: cfg.downloads });
    } catch (err) {
      console.error("[checkout]", err.message);
      return json(502, { ok: false, error: "gateway", message: String(err.message).replace(/^Asaas: /, "") });
    }
  }
  const activate = /* @__PURE__ */ __name(async (email, typed, dev) => {
    let c = await subs.fresh(email, { force: true });
    if (!await matchLogin(c, typed)) return { error: "not_found" };
    const reg = await registerDevice(db, email, { ...dev, city }, cfg);
    if (reg.error) return { error: reg.error };
    return { license: await issueLicense(reg.customer, dev.id, cfg) };
  }, "activate");
  if (p === "/api/v1/activate" && req.method === "POST") {
    const email = normEmail(b.email);
    const dev = device(b);
    if (!email || !b.order || !dev.id) return fail(400, "bad_request");
    if (await db.limited("act:" + ip, 10, 15 * 6e4) || await db.limited("act:" + email, 8, 15 * 6e4)) return fail(429, "rate_limited");
    const r = await activate(email, b.order, dev);
    if (r.error) return fail(r.error === "not_found" ? 404 : 409, r.error);
    return json(200, { ok: true, ...r.license });
  }
  if (p === "/api/v1/refresh" && req.method === "POST") {
    const t = await readToken(b.token, cfg);
    if (!t) return fail(401, "invalid_token");
    if (b.deviceId && b.deviceId !== t.did) return fail(401, "device_mismatch");
    if (await db.limited("ref:" + t.did, 30, 36e5)) return fail(429, "rate_limited");
    const c = await subs.fresh(t.email);
    if (!c?.devices?.[t.did]) return fail(401, "invalid_token");
    const upd = await db.update(t.email, (x) => (x.devices[t.did].lastSeen = Date.now(), x));
    return json(200, { ok: true, ...await issueLicense(upd, t.did, cfg) });
  }
  if (p === "/api/v1/logout" && req.method === "POST") {
    const t = await readToken(b.token, cfg);
    if (t) await db.update(t.email, (x) => (delete x.devices?.[t.did], x));
    return json(200, { ok: true });
  }
  if (p === "/api/v1/pair/start" && req.method === "POST") {
    const dev = device(b);
    if (!dev.id) return fail(400, "bad_request");
    if (await db.limited("pair:" + ip, 20, 15 * 6e4)) return fail(429, "rate_limited");
    let code;
    do
      code = pairCode();
    while (await db.pairs.byCode(code));
    const pr = { id: randomId(), code, device: dev, expiresAt: Date.now() + 10 * 6e4, license: null };
    await db.pairs.put(pr);
    return json(200, { ok: true, pairId: pr.id, code, expiresAt: pr.expiresAt, url: `${cfg.publicUrl}/ativar`, qr: `${cfg.publicUrl}/ativar?c=${code}` });
  }
  if (p === "/api/v1/pair/poll") {
    const pr = await db.pairs.get(url.searchParams.get("id") || "");
    if (!pr || pr.expiresAt < Date.now()) return fail(410, "pair_expired");
    if (!pr.license) return json(200, { ok: true, pair: "pending" });
    await db.pairs.del(pr.id);
    return json(200, { ok: true, ...pr.license, pair: "done" });
  }
  if (p === "/api/v1/pair/confirm" && req.method === "POST") {
    const email = normEmail(b.email);
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!email || !b.order || !code) return fail(400, "bad_request");
    if (await db.limited("act:" + ip, 10, 15 * 6e4)) return fail(429, "rate_limited");
    const pr = await db.pairs.byCode(code);
    if (!pr) return fail(410, "pair_expired");
    const r = await activate(email, b.order, pr.device);
    if (r.error) return fail(r.error === "not_found" ? 404 : 409, r.error);
    await db.pairs.put({ ...pr, license: r.license });
    return json(200, { ok: true, status: r.license.status, device: pr.device.name });
  }
  const dl = p.match(/^\/d\/([A-Za-z0-9]{6})$/);
  if (dl && req.method === "GET") {
    if (await db.limited("dl:" + ip, 40, 15 * 6e4)) return fail(429, "rate_limited");
    const row = await db.downloads.get(dl[1].toUpperCase());
    const apk = row && APKS[row.file];
    if (!apk) return new Response("Link de download expirado. Gere um novo em " + cfg.publicUrl + "/conta", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const obj = await env.FILES.get(apk.key, { type: "stream" });
    if (!obj) return new Response("Arquivo ainda n\xE3o publicado.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response(obj, {
      headers: { "Content-Type": "application/vnd.android.package-archive", "Content-Disposition": `attachment; filename="${apk.name}"`, "Cache-Control": "no-store" }
    });
  }
  if (p === "/api/v1/account/downloads" && req.method === "POST") {
    const email = normEmail(b.email);
    if (!email || !b.doc) return fail(400, "bad_request");
    if (await db.limited("acc:" + ip, 20, 15 * 6e4) || await db.limited("acc:" + email, 12, 15 * 6e4)) return fail(429, "rate_limited");
    const c = await subs.fresh(email);
    if (!c || !await matchLogin(c, b.doc)) return fail(404, "not_found");
    const st = evaluate(c, cfg);
    if (st.status !== "active" && st.status !== "grace")
      return json(403, { ok: false, error: "not_active", message: "O download fica dispon\xEDvel com a assinatura em dia. Pague a fatura em aberto e tente de novo." });
    const expiresAt = Date.now() + 2 * 36e5;
    const files = [];
    for (const [file, apk] of Object.entries(APKS)) {
      const code = dlCode();
      await db.downloads.put(code, file, email, expiresAt);
      files.push({ file, label: apk.label, name: apk.name, code, url: `${cfg.publicUrl}/d/${code}` });
    }
    return json(200, { ok: true, expiresAt, files });
  }
  if (p === "/api/v1/account/wallet" && req.method === "POST") {
    const email = normEmail(b.email);
    if (!email || !b.doc) return fail(400, "bad_request");
    if (await db.limited("acc:" + ip, 20, 15 * 6e4)) return fail(429, "rate_limited");
    const c0 = await db.get(email);
    if (!c0 || !await matchLogin(c0, b.doc)) return fail(404, "not_found");
    const wallet = String(b.walletId || "").trim().toLowerCase();
    if (wallet && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(wallet))
      return json(400, { ok: false, error: "invalid", message: 'ID da carteira inv\xE1lido. Copie o "Wallet ID" no app do Asaas: Minha conta \u2192 Integra\xE7\xF5es.' });
    const c = await db.update(email, (x) => (x.walletId = wallet || null, x.refCode = x.refCode || newRefCode(), x));
    return json(200, { ok: true, account: await accountView(c, cfg, db) });
  }
  if (p.startsWith("/api/v1/account") && req.method === "POST") {
    const email = normEmail(b.email);
    if (!email || !b.doc) return fail(400, "bad_request");
    if (await db.limited("acc:" + ip, 20, 15 * 6e4) || await db.limited("acc:" + email, 12, 15 * 6e4)) return fail(429, "rate_limited");
    let c = await subs.fresh(email);
    if (!c || !await matchLogin(c, b.doc)) return fail(404, "not_found");
    if (p === "/api/v1/account/device" && b.deviceId) c = await db.update(email, (x) => (delete x.devices?.[String(b.deviceId)], x));
    if (p === "/api/v1/account/cancel" && !c.cancelledAt) {
      for (const id of Object.keys(c.gateway?.subscriptions || {})) await asaas.cancelSubscription(id).catch((e) => console.warn("[cancelar]", e.message));
      c = await db.update(email, (x) => (x.cancelledAt = Date.now(), x));
    }
    if (!c.refCode) c = await db.update(email, (x) => (x.refCode = newRefCode(), x));
    return json(200, { ok: true, account: await accountView(c, cfg, db) });
  }
  if (p === "/webhooks/asaas" && req.method === "POST") {
    if (!asaas.verifyWebhook(req)) return fail(401, "invalid_token");
    const id = b.id ? "asaas-" + b.id : `asaas-${b.event}-${b.payment?.id}-${b.payment?.status}`;
    if (await db.seenWebhook(id)) return json(200, { ok: true, duplicate: true });
    try {
      const custId = b.payment?.customer || b.subscription?.customer;
      if (custId) {
        const local = await db.byGatewayCustomer(custId);
        const email = local?.email || (await asaas.fetchCustomer(custId))?.email;
        if (email) {
          const c = await subs.sync(email);
          if (b.event === "PAYMENT_CREATED" && b.payment?.id && c?.referredBy) await applyReferralSplit(db, asaas, cfg, c, b.payment.id);
          if (["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(b.event) && c?.referredBy) await recordCommission(db, cfg, c, b.payment);
        }
      }
      return json(200, { ok: true });
    } catch (err) {
      console.error("[webhook asaas]", b.event, err.message);
      return json(500, { ok: false });
    }
  }
  if (p.startsWith("/admin/api/")) return admin(req, url, b, { db, asaas, subs, cfg, fail });
  return fail(404, "Rota inexistente.");
}
__name(route, "route");
async function referralView(c, cfg, db) {
  const referees = await db.referredBy(c.email);
  const commissions = Object.values(c.commissions || {});
  return {
    percent: cfg.referralPercent,
    code: c.refCode || null,
    link: c.refCode ? `${cfg.publicUrl}/assinar?ref=${c.refCode}` : null,
    walletId: c.walletId ? c.walletId.slice(0, 8) + "\u2026" + c.walletId.slice(-4) : null,
    indicated: referees.length,
    paying: referees.filter((r) => evaluate(r, cfg).status === "active").length,
    total: Math.round(commissions.reduce((s2, x) => s2 + x.value, 0) * 100) / 100,
    last: commissions.sort((a, b) => b.at - a.at).slice(0, 10),
    eligible: evaluate(c, cfg).status === "active"
  };
}
__name(referralView, "referralView");
async function accountView(c, cfg, db) {
  const st = evaluate(c, cfg);
  const plan = cfg.plans.find((x) => x.id === c.plan);
  return {
    referral: await referralView(c, cfg, db),
    name: c.name || "",
    email: c.email,
    accessCode: c.accessCode || null,
    plan: plan ? { name: plan.name, price: plan.price } : null,
    status: st.status,
    reason: st.reason,
    paidUntil: st.paidUntil,
    suspendAt: st.suspendAt,
    payUrl: st.status !== "active" ? c.lastInvoiceUrl || null : null,
    renewUrl: `/assinar?email=${encodeURIComponent(c.email)}`,
    cancelled: !!c.cancelledAt,
    canCancel: !!Object.keys(c.gateway?.subscriptions || {}).length && !c.cancelledAt,
    devices: Object.entries(c.devices || {}).map(([id, d]) => ({ id, name: d.name, platform: d.platform, lastSeen: d.lastSeen })),
    maxDevices: cfg.maxDevices
  };
}
__name(accountView, "accountView");
async function admin(req, url, b, { db, asaas, subs, cfg, fail }) {
  const given = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!cfg.adminToken || given.length !== cfg.adminToken.length || [...given].reduce((d, ch, i) => d | ch.charCodeAt(0) ^ cfg.adminToken.charCodeAt(i), 0))
    return json(401, { ok: false, error: "unauthorized", message: "Senha do painel inv\xE1lida." });
  const view = /* @__PURE__ */ __name((c) => {
    if (!c) return null;
    const paid = Object.values(c.orders || {}).filter((o) => !o.cancelled && o.financial === "PAID");
    const lastPaymentAt = paid.reduce((m, o) => Math.max(m, o.paidAt || 0), 0);
    return {
      ...c,
      cpfHash: void 0,
      orders: void 0,
      state: evaluate(c, cfg),
      lastPaymentAt,
      renewalAt: c.paidUntil ? c.paidUntil - cfg.toleranceHours * 36e5 : 0,
      payments: paid.length,
      referredBy: c.referredBy || null,
      walletId: c.walletId || null,
      commissionsTotal: Math.round(Object.values(c.commissions || {}).reduce((s2, x) => s2 + x.value, 0) * 100) / 100
    };
  }, "view");
  const parts = url.pathname.split("/").filter(Boolean).slice(2);
  if (parts[0] === "summary") {
    const all = (await db.list()).map(view);
    const count = /* @__PURE__ */ __name((st) => all.filter((c) => c.state.status === st).length, "count");
    return json(200, { ok: true, total: all.length, active: count("active"), grace: count("grace"), suspended: count("suspended"), store: "Checkout pr\xF3prio (Asaas)", connected: asaas.configured(), plans: cfg.plans });
  }
  if (parts[0] === "content" && parts[1] === "obrigado") {
    if (req.method === "POST") {
      const content = b.reset ? {} : {
        titulo: clean(b.titulo, 80) || PAID_DEFAULT.titulo,
        texto: clean(b.texto, 400),
        passos: (Array.isArray(b.passos) ? b.passos : []).map((x) => clean(x, 400)).filter(Boolean).slice(0, 6),
        botao: clean(b.botao, 60) || PAID_DEFAULT.botao,
        whatsapp: clean(b.whatsapp, 120)
      };
      await db.settings.put("obrigado", content);
      return json(200, { ok: true, content: { ...PAID_DEFAULT, ...content } });
    }
    return json(200, { ok: true, content: { ...PAID_DEFAULT, ...await db.settings.get("obrigado") || {} } });
  }
  if (parts[0] === "content" && parts[1] === "confirmacao") {
    if (req.method === "POST") {
      const content = b.reset ? null : cleanConfirmation(b);
      await db.settings.put("confirmacao", content || {});
      return json(200, { ok: true, content: { ...CONFIRMATION_DEFAULT, ...content || {} } });
    }
    return json(200, { ok: true, content: { ...CONFIRMATION_DEFAULT, ...await db.settings.get("confirmacao") || {} }, defaults: CONFIRMATION_DEFAULT });
  }
  if (parts[0] !== "customers") return fail(404, "Rota inexistente.");
  const email = parts[1] ? normEmail(decodeURIComponent(parts[1])) : "";
  if (!email && req.method === "POST") {
    if (!b.email) return fail(400, "bad_request");
    const code = (await db.get(b.email))?.accessCode || "GTV-" + [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    const c = await db.update(b.email, (x) => ({ ...x, name: b.name || x.name || "", accessCode: code, city: b.city || x.city || "", override: "active", overrideSource: "admin", overrideUntil: b.until ? Date.parse(b.until + "T23:59:59-03:00") : 0 }));
    return json(200, { ok: true, customer: view(c) });
  }
  if (!email) {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    return json(200, { ok: true, customers: (await db.list()).filter((c) => !q || c.email.includes(q)).map(view) });
  }
  if (parts[2] === "sync" && req.method === "POST") return json(200, { ok: true, customer: view(await subs.sync(email)) });
  if (parts[2] === "cancel" && req.method === "POST") {
    const c = await db.get(email);
    for (const id of Object.keys(c?.gateway?.subscriptions || {})) await asaas.cancelSubscription(id).catch((e) => console.warn("[cancelar]", e.message));
    return json(200, { ok: true, customer: view(await db.update(email, (x) => (x.cancelledAt = Date.now(), x))) });
  }
  if (parts[2] === "devices" && parts[3] && req.method === "DELETE")
    return json(200, { ok: true, customer: view(await db.update(email, (x) => (delete x.devices?.[decodeURIComponent(parts[3])], x))) });
  if (req.method === "POST") {
    const c = await db.update(email, (x) => {
      if ("override" in b) {
        x.override = b.override || null;
        x.overrideSource = "admin";
      }
      if ("overrideUntil" in b) x.overrideUntil = b.overrideUntil ? Date.parse(b.overrideUntil + "T23:59:59-03:00") : 0;
      if ("note" in b) x.note = String(b.note || "");
      return x;
    });
    return json(200, { ok: true, customer: view(c) });
  }
  if (req.method === "DELETE") {
    await db.remove(email);
    return json(200, { ok: true });
  }
  return json(200, { ok: true, customer: view(await db.get(email)) });
}
__name(admin, "admin");

// [[path]].js
var onRequest = /* @__PURE__ */ __name(({ request, env }) => handle(request, env), "onRequest");

// ../../.wrangler/tmp/pages-YmnPjG/functionsRoutes-0.4626277349227311.mjs
var routes = [
  {
    routePath: "/:path*",
    mountPath: "/",
    method: "",
    middlewares: [],
    modules: [onRequest]
  }
];

// ../../../../../AppData/Local/npm-cache/_npx/3750d4a998b75d79/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys2 = [];
  var re = pathToRegexp(str, keys2, options);
  return regexpToFunction(re, keys2, options);
}
__name(match, "match");
function regexpToFunction(re, keys2, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys2[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys2) {
  if (!keys2)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys2.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys2, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys2, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys2, options) {
  return tokensToRegexp(parse(path, options), keys2, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys2, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route2 = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route2 += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys2)
          keys2.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route2 += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route2 += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route2 += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route2 += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route2 += "".concat(delimiterRe, "?");
    route2 += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route2 += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route2 += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route2, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys2, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys2);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys2, options);
  return stringToRegexp(path, keys2, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../../AppData/Local/npm-cache/_npx/3750d4a998b75d79/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route2 of [...routes].reverse()) {
    if (route2.method && route2.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route2.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route2.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route2.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route2 of routes) {
    if (route2.method && route2.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route2.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route2.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route2.modules.length) {
      for (const handler of route2.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../../../../../AppData/Local/npm-cache/_npx/3750d4a998b75d79/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../AppData/Local/npm-cache/_npx/3750d4a998b75d79/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../../.wrangler/tmp/bundle-u28R65/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../../../../../AppData/Local/npm-cache/_npx/3750d4a998b75d79/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../../.wrangler/tmp/bundle-u28R65/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.7049958467759608.mjs.map
