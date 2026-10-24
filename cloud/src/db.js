// Acesso ao banco D1 (Cloudflare). Cada assinante é guardado como um documento JSON.
export const normEmail = (e) => String(e || '').trim().toLowerCase();

export function makeDb(D1) {
  const now = () => Date.now();
  return {
    async get(email) {
      const r = await D1.prepare('SELECT data FROM customers WHERE email = ?').bind(normEmail(email)).first();
      return r ? JSON.parse(r.data) : null;
    },
    // Atualiza com uma função (lê, altera, grava). Cria o cadastro se não existir.
    async update(email, fn) {
      const key = normEmail(email);
      const cur = (await this.get(key)) || { email: key, orders: {}, devices: {}, createdAt: now() };
      const next = (await fn(structuredClone(cur))) || cur;
      next.updatedAt = now();
      await D1.prepare('INSERT INTO customers (email, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
        .bind(key, JSON.stringify(next), next.updatedAt)
        .run();
      return next;
    },
    async remove(email) {
      await D1.prepare('DELETE FROM customers WHERE email = ?').bind(normEmail(email)).run();
    },
    async list() {
      const r = await D1.prepare('SELECT data FROM customers ORDER BY updated_at DESC LIMIT 5000').all();
      return (r.results || []).map((x) => JSON.parse(x.data));
    },
    async byRefCode(code) {
      const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!c) return null;
      const r = await D1.prepare('SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 1').bind(`"refCode":"${c}"`).first();
      return r ? JSON.parse(r.data) : null;
    },
    // Algum cadastro com este valor exato no campo? (ex.: cpfHash, phone)
    async findBy(field, value) {
      const v = String(value || '').replace(/"/g, '');
      if (!v) return null;
      const r = await D1.prepare('SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 1').bind(`"${field}":"${v}"`).first();
      return r ? JSON.parse(r.data) : null;
    },
    // Todos os cadastros com este valor exato no campo (até 50).
    async findAllBy(field, value) {
      const v = String(value || '').replace(/"/g, '');
      if (!v) return [];
      const r = await D1.prepare('SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 50').bind(`"${field}":"${v}"`).all();
      return (r.results || []).map((x) => JSON.parse(x.data));
    },
    // Cadastros de teste que já usaram este aparelho.
    async trialsWithDevice(deviceId) {
      const id = String(deviceId || '').replace(/"/g, '');
      if (!id) return [];
      const r = await D1.prepare('SELECT data FROM customers WHERE instr(data, ?) > 0 AND instr(data, ?) > 0 LIMIT 20').bind(`"${id}":{`, '"trialAt":').all();
      return (r.results || []).map((x) => JSON.parse(x.data));
    },
    async byTvCode(code) {
      const c = String(code || '').replace(/\D/g, '');
      if (c.length !== 6) return null;
      const r = await D1.prepare('SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 1').bind(`"tvCode":"${c}"`).first();
      return r ? JSON.parse(r.data) : null;
    },
    async referredBy(email) {
      const r = await D1.prepare('SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 500').bind(`"referredBy":"${String(email).replace(/"/g, '')}"`).all();
      return (r.results || []).map((x) => JSON.parse(x.data));
    },
    async byGatewayCustomer(id) {
      const r = await D1.prepare('SELECT data FROM customers WHERE instr(data, ?) > 0 LIMIT 1').bind(`"${String(id).replace(/"/g, '')}"`).first();
      return r ? JSON.parse(r.data) : null;
    },
    // Webhooks já processados (o Asaas pode reenviar o mesmo evento).
    async seenWebhook(id) {
      if (!id) return false;
      const r = await D1.prepare('INSERT OR IGNORE INTO webhooks (id, at) VALUES (?, ?)').bind(String(id), now()).run();
      if (Math.random() < 0.02) await D1.prepare('DELETE FROM webhooks WHERE at < ?').bind(now() - 7 * 864e5).run();
      return !r.meta?.changes;
    },
    // Limite de tentativas (protege contra adivinhar CPF/código).
    async limited(k, max, windowMs) {
      const since = now() - windowMs;
      const r = await D1.prepare('SELECT COUNT(*) AS c FROM hits WHERE k = ? AND at > ?').bind(k, since).first();
      await D1.prepare('INSERT INTO hits (k, at) VALUES (?, ?)').bind(k, now()).run();
      if (Math.random() < 0.02) await D1.prepare('DELETE FROM hits WHERE at < ?').bind(now() - 25 * 3600e3).run(); // o teste grátis usa uma janela de 24h
      return (r?.c || 0) >= max;
    },
    // Textos editáveis pelo painel (ex.: página de confirmação de compra).
    settings: {
      async get(k) {
        const r = await D1.prepare('SELECT v FROM settings WHERE k = ?').bind(k).first();
        return r ? JSON.parse(r.v) : null;
      },
      async put(k, v) {
        await D1.prepare('INSERT INTO settings (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at')
          .bind(k, JSON.stringify(v), now())
          .run();
      },
    },
    // Links de download temporários (código curto, ex.: /d/AB12CD, para digitar na TV).
    downloads: {
      async put(code, file, email, expiresAt) {
        await D1.prepare('INSERT INTO downloads (code, file, email, expires_at) VALUES (?, ?, ?, ?)').bind(code, file, email, expiresAt).run();
        if (Math.random() < 0.05) await D1.prepare('DELETE FROM downloads WHERE expires_at < ?').bind(now()).run();
      },
      async get(code) {
        return D1.prepare('SELECT * FROM downloads WHERE code = ? AND expires_at > ?').bind(code, now()).first();
      },
    },
    pairs: {
      async put(p) {
        await D1.prepare('INSERT INTO pairs (id, code, data, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
          .bind(p.id, p.code, JSON.stringify(p), p.expiresAt)
          .run();
      },
      async get(id) {
        const r = await D1.prepare('SELECT data FROM pairs WHERE id = ?').bind(id).first();
        return r ? JSON.parse(r.data) : null;
      },
      async byCode(code) {
        const r = await D1.prepare('SELECT data FROM pairs WHERE code = ? AND expires_at > ?').bind(code, now()).first();
        return r ? JSON.parse(r.data) : null;
      },
      async del(id) {
        await D1.prepare('DELETE FROM pairs WHERE id = ?').bind(id).run();
        if (Math.random() < 0.05) await D1.prepare('DELETE FROM pairs WHERE expires_at < ?').bind(now() - 25 * 3600e3).run(); // o teste grátis usa uma janela de 24h
      },
    },
  };
}
