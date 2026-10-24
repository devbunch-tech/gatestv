// Servidor de licenças do GATES! TV na Cloudflare (Pages Functions + D1).
// As páginas (site, /assinar, /conta, /admin, /ativar) são arquivos estáticos em cloud/public;
// aqui ficam só as rotas /api, /admin/api, /webhooks e /health.
import { makeConfig } from './config.js';
import { makeDb, normEmail } from './db.js';
import { makeAsaas } from './asaas.js';
import { evaluate, issueLicense, matchLogin, publicJwk, readToken, registerDevice, trialStarted } from './license.js';
import { sportsResponse } from './sports.js';
import { applyReferralSplit, ensureTvCode, makeSubscribers, newRefCode, recordCommission, normPhone, PHONE_ERROR, startCheckout, startTrial } from './subscribers.js';

const json = (code, obj, headers = {}) =>
  new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

const MESSAGES = (cfg) => ({
  bad_request: 'Dados incompletos.',
  not_found: 'Não encontramos uma assinatura com este e-mail e CPF (ou código de acesso).',
  device_limit: `Limite de ${cfg.maxDevices} aparelhos atingido. Remova um aparelho antigo em "Minha conta" para usar neste.`,
  invalid_token: 'Licença inválida. Entre novamente.',
  device_mismatch: 'Esta licença pertence a outro aparelho.',
  rate_limited: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  pair_expired: 'O código expirou. Gere um novo código no aparelho.',
  trial_used: 'O teste grátis já foi usado com estes dados. Assine um dos planos para continuar.',
  trial_device: 'Este aparelho já foi usado em um teste grátis. Assine um dos planos para continuar.',
  trial_off: 'O teste grátis não está disponível no momento.',
  install_expired: 'A ativação automática deste download expirou. Ative pelo código na tela ou baixe o app de novo pelo seu endereço da TV.',
  trial_device_limit: 'No teste grátis dá para usar até 2 aparelhos. Remova um em "Minha conta" ou assine para usar até ' + cfg.maxDevices + '.',
  unavailable: 'Não foi possível concluir agora. Tente novamente em instantes.',
});

// O app roda em http://127.0.0.1:<porta> (TV/celular/Windows) e precisa chamar esta API.
function corsHeaders(req, cfg) {
  const origin = req.headers.get('Origin');
  if (!origin) return {};
  // Apps de Smart TV Samsung/LG rodam do arquivo local: origem "null" ou file://. Só a API pública
  // (sem cookies); o painel continua exigindo a senha no cabeçalho.
  const tvApp = origin === 'null' || /^(file|app):\/\//.test(origin);
  const ok = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) || cfg.corsOrigins.includes(origin) || origin === cfg.publicUrl || tvApp;
  return ok
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' }
    : {};
}

// APKs guardados no armazenamento protegido (KV "FILES"), enviados por: node cloud/deploy.mjs --apks
export const APKS = {
  tv: { key: 'apk:tv', name: 'GatesTV-TV.apk', label: 'Android TV / TV Box' },
  tvLite: { key: 'apk:tvLite', name: 'GatesTV-TV-LITE.apk', label: 'Android TV / TV Box (LITE)' },
  phone: { key: 'apk:phone', name: 'GatesTV-Celular.apk', label: 'Celular Android' },
  phoneLite: { key: 'apk:phoneLite', name: 'GatesTV-Celular-LITE.apk', label: 'Celular Android (LITE)' },
  tablet: { key: 'apk:tablet', name: 'GatesTV-Tablet.apk', label: 'Tablet Android' },
  tabletLite: { key: 'apk:tabletLite', name: 'GatesTV-Tablet-LITE.apk', label: 'Tablet Android (LITE)' },
  // Instalador do Windows (~86 MB): guardado em partes (limite de 25 MB por arquivo no plano grátis).
  windows: { key: 'apk:windows', name: 'GatesTV-Windows-Setup.exe', label: 'Computador Windows', chunked: true, type: 'application/octet-stream' },
};
const DL_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const dlCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => DL_CHARS[x % DL_CHARS.length]).join('');

// Textos padrão da página de confirmação de compra (editáveis em /admin → Página de confirmação).
export const CONFIRMATION_DEFAULT = {
  titulo: 'Quase lá!',
  subtitulo: 'Guarde seu código de acesso (ele também funciona junto com o seu e-mail):',
  botaoPagar: 'Pagar agora (PIX, boleto ou cartão)',
  passos: [
    'Pague a primeira mensalidade no botão acima. Com PIX ou cartão, a liberação é na hora.',
    'Na TV: abra o app **Downloader** e digite o endereço da TV mostrado acima. Ele baixa o app assim que o pagamento é confirmado.',
    'Abra o GATES! TV na TV, escolha a opção de código e digite esse código em Minha conta → Ativar TV. No celular ou computador, baixe em Minha conta e entre com e-mail e CPF.',
  ],
  rodape: 'As próximas mensalidades chegam por e-mail. Se atrasar, você tem 4 dias antes da suspensão.',
  whatsapp: 'Dúvidas? Fale com a gente no WhatsApp.',
};
export const PAID_DEFAULT = {
  titulo: 'Pagamento confirmado! 🎉',
  texto: 'Bem-vindo ao GATES! TV. Sua assinatura já está liberada.',
  passos: [
    'Na TV: abra o app **Downloader** e digite o endereço da TV (ele também fica em Minha conta).',
    'Abra o GATES! TV na TV, escolha a opção de código e digite esse código em Minha conta → Ativar TV.',
    'Celular, tablet ou computador: baixe em Minha conta e entre com o seu e-mail e o CPF. Dúvidas? Veja o passo a passo de instalação.',
  ],
  botao: 'Ir para Minha conta',
  whatsapp: 'Precisa de ajuda? Fale com a gente no WhatsApp.',
};
const clean = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const cleanConfirmation = (b) => ({
  titulo: clean(b.titulo, 80) || CONFIRMATION_DEFAULT.titulo,
  subtitulo: clean(b.subtitulo, 300),
  botaoPagar: clean(b.botaoPagar, 60) || CONFIRMATION_DEFAULT.botaoPagar,
  passos: (Array.isArray(b.passos) ? b.passos : []).map((x) => clean(x, 400)).filter(Boolean).slice(0, 6),
  rodape: clean(b.rodape, 400),
  whatsapp: clean(b.whatsapp, 120),
});

const device = (b) => ({ id: String(b.deviceId || '').slice(0, 80), name: String(b.deviceName || '').slice(0, 80), platform: String(b.platform || '').slice(0, 20) });
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pairCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
const randomId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);

export async function handle(req, env) {
  const cfg = makeConfig(env);
  const cors = corsHeaders(req, cfg);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const res = await route(req, env, cfg).catch((err) => {
    console.error('[erro]', err?.stack || err);
    // Detalhe técnico só para o administrador (cabeçalho X-Debug com a senha do painel).
    const dbg = cfg.adminToken && req.headers.get('X-Debug') === cfg.adminToken ? { detail: String(err?.stack || err).slice(0, 800) } : {};
    return json(503, { ok: false, error: 'unavailable', message: MESSAGES(cfg).unavailable, ...dbg });
  });
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

async function route(req, env, cfg) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/$/, '') || '/';
  const msg = MESSAGES(cfg);
  const fail = (code, error) => json(code, { ok: false, error, message: msg[error] || error });
  const db = makeDb(env.DB);
  const asaas = makeAsaas(cfg);
  const subs = makeSubscribers(db, asaas, cfg);
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  // Localização aproximada da conexão (informada pela Cloudflare), ex.: "Criciúma/SC".
  const city = [req.cf?.city, req.cf?.regionCode].filter(Boolean).join('/');
  const raw = req.method === 'POST' || req.method === 'DELETE' ? await req.text() : '';
  let b = {};
  if (raw) {
    try {
      b = JSON.parse(raw);
    } catch {
      if (!p.startsWith('/webhooks')) return fail(400, 'bad_request');
    }
  }

  if (p === '/health') return json(200, { ok: true, store: 'checkout', connected: asaas.configured(), time: Date.now() });
  // Agenda esportiva (NFL, NBA, UFC, Premier League, Brasileirão) para todos os aparelhos.
  if (p === '/api/v1/sports') return json(200, await sportsResponse(env), { 'Cache-Control': 'public, max-age=300' });
  if (p === '/api/v1/public-key') return json(200, { ok: true, jwk: await publicJwk(cfg) });
  if (p === '/api/v1/plans')
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
      referralPercent: cfg.referralPercent,
      trialHours: cfg.trialHours,
    });

  // Página "Pagamento confirmado" (o Asaas redireciona para cá depois do pagamento).
  if (p === '/api/v1/content/obrigado')
    return json(200, { ok: true, content: { ...PAID_DEFAULT, ...((await db.settings.get('obrigado')) || {}) }, support: cfg.support });

  // Textos da página de confirmação de compra.
  if (p === '/api/v1/content/confirmacao')
    return json(200, { ok: true, content: { ...CONFIRMATION_DEFAULT, ...((await db.settings.get('confirmacao')) || {}) }, support: cfg.support });

  // ---------- Checkout ----------
  if (p === '/api/v1/checkout' && req.method === 'POST') {
    if (await db.limited('chk:' + ip, 8, 15 * 60e3)) return fail(429, 'rate_limited');
    if (!asaas.configured()) return json(503, { ok: false, error: 'unavailable', message: 'Pagamentos ainda não configurados.' });
    try {
      const r = await startCheckout(db, asaas, cfg, { ...b, city, ref: b.ref });
      if (r.errors) return json(400, { ok: false, error: 'invalid', errors: r.errors, message: Object.values(r.errors)[0] });
      return json(200, { ok: true, code: r.code, tvCode: r.tvCode, tvLink: tvLink(cfg, r.tvCode), invoiceUrl: r.invoiceUrl, plan: r.plan.name, downloads: cfg.downloads });
    } catch (err) {
      console.error('[checkout]', err.message);
      return json(502, { ok: false, error: 'gateway', message: String(err.message).replace(/^Asaas: /, '') });
    }
  }

  // ---------- Teste grátis ----------
  if (p === '/api/v1/trial' && req.method === 'POST') {
    if (!cfg.trialHours) return fail(403, 'trial_off');
    if ((await db.limited('trial:' + ip, 3, 24 * 3600e3)) || (await db.limited('chk:' + ip, 8, 15 * 60e3))) return fail(429, 'rate_limited');
    const r = await startTrial(db, cfg, { ...b, city });
    if (r.errors) return json(400, { ok: false, error: 'invalid', errors: r.errors, message: Object.values(r.errors)[0] });
    if (r.used) return fail(409, 'trial_used');
    return json(200, { ok: true, until: r.customer.trialUntil, hours: cfg.trialHours, accessCode: r.customer.accessCode, tvLink: tvLink(cfg, r.customer.tvCode) });
  }

  // ---------- App: ativação, renovação e saída ----------
  const activate = async (email, typed, dev, trusted = false) => {
    let c = await subs.fresh(email, { force: true });
    if (!c || (!trusted && !(await matchLogin(c, typed)))) return { error: 'not_found' };
    // Em teste: no máximo 2 aparelhos, e um aparelho só pode fazer 1 teste.
    const ready = evaluate(c, cfg).reason === 'trial_ready';
    const inTrial = ready || evaluate(c, cfg).reason === 'trial';
    if (inTrial && !c.devices?.[dev.id] && (await db.trialsWithDevice(dev.id)).some((x) => x.email !== c.email && trialStarted(x))) return { error: 'trial_device' };
    // Primeiro aparelho ativado: é agora que as horas do teste começam a contar.
    if (ready) {
      const now = Date.now();
      c = await db.update(email, (x) => ((x.trialStartedAt = now), (x.trialUntil = now + cfg.trialHours * 3600e3), x));
    }
    const reg = await registerDevice(db, email, { ...dev, city }, inTrial ? { ...cfg, maxDevices: Math.min(2, cfg.maxDevices) } : cfg);
    if (reg.error) return { error: inTrial && reg.error === 'device_limit' ? 'trial_device_limit' : reg.error };
    return { license: await issueLicense(reg.customer, dev.id, cfg) };
  };
  if (p === '/api/v1/activate' && req.method === 'POST') {
    const email = normEmail(b.email);
    const dev = device(b);
    if (!email || !b.order || !dev.id) return fail(400, 'bad_request');
    if ((await db.limited('act:' + ip, 10, 15 * 60e3)) || (await db.limited('act:' + email, 8, 15 * 60e3))) return fail(429, 'rate_limited');
    const r = await activate(email, b.order, dev);
    if (r.error) return fail(r.error === 'not_found' ? 404 : 409, r.error);
    return json(200, { ok: true, ...r.license });
  }
  if (p === '/api/v1/refresh' && req.method === 'POST') {
    const t = await readToken(b.token, cfg);
    if (!t) return fail(401, 'invalid_token');
    if (b.deviceId && b.deviceId !== t.did) return fail(401, 'device_mismatch');
    if (await db.limited('ref:' + t.did, 30, 3600e3)) return fail(429, 'rate_limited');
    const c = await subs.fresh(t.email);
    if (!c?.devices?.[t.did]) return fail(401, 'invalid_token');
    const upd = await db.update(t.email, (x) => ((x.devices[t.did].lastSeen = Date.now()), x));
    return json(200, { ok: true, ...(await issueLicense(upd, t.did, cfg)) });
  }
  if (p === '/api/v1/logout' && req.method === 'POST') {
    const t = await readToken(b.token, cfg);
    if (t) await db.update(t.email, (x) => (delete x.devices?.[t.did], x));
    return json(200, { ok: true });
  }

  // ---------- Ativação automática (chave gravada no APK no download) ----------
  if (p === '/api/v1/install/activate' && req.method === 'POST') {
    const dev = device(b);
    const token = String(b.token || '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(token) || !dev.id) return fail(400, 'bad_request');
    if (await db.limited('act:' + ip, 10, 15 * 60e3)) return fail(429, 'rate_limited');
    const row = await db.downloads.get(token);
    if (!row || row.file !== 'install') return fail(410, 'install_expired');
    const r = await activate(row.email, null, dev, true);
    if (r.error) return fail(r.error === 'not_found' ? 404 : 409, r.error);
    return json(200, { ok: true, ...r.license });
  }

  // ---------- Página fixa da TV: /tv (QR code + confirmação no celular) ----------
  if ((p === '/tv' || p === '/tv/') && req.method === 'GET') return new Response(TV_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (p === '/api/v1/handoff/start' && req.method === 'POST') {
    if (await db.limited('hand:' + ip, 30, 15 * 60e3)) return fail(429, 'rate_limited');
    let code;
    do code = pairCode();
    while (await db.pairs.byCode(code));
    const pr = { id: randomId(), code, kind: 'handoff', lite: !!b.lite, expiresAt: Date.now() + 15 * 60e3, link: null };
    await db.pairs.put(pr);
    return json(200, { ok: true, id: pr.id, code, expiresAt: pr.expiresAt, qr: `${cfg.publicUrl}/conta?tv=${code}` });
  }
  if (p === '/api/v1/handoff/poll') {
    const pr = await db.pairs.get(url.searchParams.get('id') || '');
    if (!pr || pr.kind !== 'handoff' || pr.expiresAt < Date.now()) return fail(410, 'pair_expired');
    return json(200, { ok: true, url: pr.link || null });
  }
  if (p === '/api/v1/handoff/confirm' && req.method === 'POST') {
    const email = normEmail(b.email);
    const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!email || !b.doc || !code) return fail(400, 'bad_request');
    if (await db.limited('act:' + ip, 10, 15 * 60e3)) return fail(429, 'rate_limited');
    const pr = await db.pairs.byCode(code);
    if (!pr || pr.kind !== 'handoff') return fail(410, 'pair_expired');
    let c = await subs.fresh(email);
    if (!c || !(await matchLogin(c, b.doc))) return fail(404, 'not_found');
    const st = evaluate(c, cfg);
    if (st.status !== 'active' && st.status !== 'grace')
      return json(403, { ok: false, error: 'not_active', message: 'O download fica disponível com a assinatura em dia. Pague a fatura em aberto e tente de novo.' });
    c = await ensureTvCode(db, c);
    await db.pairs.put({ ...pr, link: `/tv/${c.tvCode}${pr.lite ? '/lite' : ''}` });
    return json(200, { ok: true });
  }

  // ---------- Pareamento (TV) ----------
  if (p === '/api/v1/pair/start' && req.method === 'POST') {
    const dev = device(b);
    if (!dev.id) return fail(400, 'bad_request');
    if (await db.limited('pair:' + ip, 20, 15 * 60e3)) return fail(429, 'rate_limited');
    let code;
    do code = pairCode();
    while (await db.pairs.byCode(code));
    const pr = { id: randomId(), code, device: dev, expiresAt: Date.now() + 30 * 60e3, license: null };
    await db.pairs.put(pr);
    return json(200, { ok: true, pairId: pr.id, code, expiresAt: pr.expiresAt, url: `${cfg.publicUrl}/ativar`, qr: `${cfg.publicUrl}/ativar?c=${code}` });
  }
  if (p === '/api/v1/pair/poll') {
    const pr = await db.pairs.get(url.searchParams.get('id') || '');
    if (!pr || pr.expiresAt < Date.now()) return fail(410, 'pair_expired');
    if (!pr.license) return json(200, { ok: true, pair: 'pending' });
    await db.pairs.del(pr.id);
    return json(200, { ok: true, ...pr.license, pair: 'done' });
  }
  if (p === '/api/v1/pair/confirm' && req.method === 'POST') {
    const email = normEmail(b.email);
    const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!email || !b.order || !code) return fail(400, 'bad_request');
    if (await db.limited('act:' + ip, 10, 15 * 60e3)) return fail(429, 'rate_limited');
    const pr = await db.pairs.byCode(code);
    if (!pr || pr.kind === 'handoff') return fail(410, 'pair_expired');
    const r = await activate(email, b.order, pr.device);
    if (r.error) return fail(r.error === 'not_found' ? 404 : 409, r.error);
    await db.pairs.put({ ...pr, license: r.license });
    return json(200, { ok: true, status: r.license.status, device: pr.device.name });
  }

  // ---------- Download dos apps (só assinante em dia ou no prazo de aviso) ----------
  const dl = p.match(/^\/d\/([A-Za-z0-9]{6})$/);
  if (dl && req.method === 'GET') {
    if (await db.limited('dl:' + ip, 40, 15 * 60e3)) return fail(429, 'rate_limited');
    const row = await db.downloads.get(dl[1].toUpperCase());
    const apk = row && APKS[row.file];
    if (!apk) return new Response('Link de download expirado. Gere um novo em ' + cfg.publicUrl + '/conta', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return serveFile(env, apk, apk.chunked ? null : await newInstallTag(db, row.email));
  }
  // Link fixo da TV (digitado no app Downloader): /tv/123456 = Android TV, /tv/123456/lite = LITE.
  const tv = p.match(/^\/tv\/(\d{6})(\/lite)?\/?$/i);
  if (tv && req.method === 'GET') {
    if (await db.limited('dl:' + ip, 40, 15 * 60e3)) return fail(429, 'rate_limited');
    let c = await db.byTvCode(tv[1]);
    if (!c) return tvPage('Código não encontrado', `Confira os 6 números do seu link da TV em <b>${tvHost(cfg)}/conta</b>.`);
    let st = evaluate(c, cfg);
    // O webhook pode atrasar alguns segundos: confere direto no Asaas antes de recusar.
    if (st.status !== 'active' && st.status !== 'grace') {
      c = (await subs.fresh(c.email, { force: true }).catch(() => null)) || c;
      st = evaluate(c, cfg);
    }
    if (st.status !== 'active' && st.status !== 'grace')
      return st.reason === 'awaiting_payment'
        ? tvPage('Aguardando o pagamento', 'Assim que o pagamento for confirmado, este mesmo endereço baixa o app. Com PIX ou cartão leva poucos minutos — depois é só tentar de novo.')
        : st.reason === 'trial_ended'
        ? tvPage('Seu teste terminou', `Gostou? Assine em <b>${tvHost(cfg)}/assinar</b> e este mesmo endereço volta a baixar o app.`)
        : tvPage('Assinatura suspensa', `Regularize o pagamento em <b>${tvHost(cfg)}/conta</b> e tente de novo.`);
    return serveFile(env, APKS[tv[2] ? 'tvLite' : 'tv'], await newInstallTag(db, c.email));
  }
  if (p === '/api/v1/account/downloads' && req.method === 'POST') {
    const email = normEmail(b.email);
    if (!email || !b.doc) return fail(400, 'bad_request');
    if ((await db.limited('acc:' + ip, 20, 15 * 60e3)) || (await db.limited('acc:' + email, 12, 15 * 60e3))) return fail(429, 'rate_limited');
    const c = await subs.fresh(email);
    if (!c || !(await matchLogin(c, b.doc))) return fail(404, 'not_found');
    const st = evaluate(c, cfg);
    if (st.status !== 'active' && st.status !== 'grace')
      return json(403, { ok: false, error: 'not_active', message: 'O download fica disponível com a assinatura em dia. Pague a fatura em aberto e tente de novo.' });
    const expiresAt = Date.now() + 2 * 3600e3;
    const files = [];
    for (const [file, apk] of Object.entries(APKS)) {
      const code = dlCode();
      await db.downloads.put(code, file, email, expiresAt);
      files.push({ file, label: apk.label, name: apk.name, code, url: `${cfg.publicUrl}/d/${code}` });
    }
    return json(200, { ok: true, expiresAt, files });
  }

  // ---------- Área do assinante ----------
  if (p === '/api/v1/account/wallet' && req.method === 'POST') {
    const email = normEmail(b.email);
    if (!email || !b.doc) return fail(400, 'bad_request');
    if (await db.limited('acc:' + ip, 20, 15 * 60e3)) return fail(429, 'rate_limited');
    const c0 = await db.get(email);
    if (!c0 || !(await matchLogin(c0, b.doc))) return fail(404, 'not_found');
    const wallet = String(b.walletId || '').trim().toLowerCase();
    if (wallet && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(wallet))
      return json(400, { ok: false, error: 'invalid', message: 'ID da carteira inválido. Copie o "Wallet ID" no app do Asaas: Minha conta → Integrações.' });
    const c = await db.update(email, (x) => ((x.walletId = wallet || null), (x.refCode = x.refCode || newRefCode()), x));
    return json(200, { ok: true, account: await accountView(c, cfg, db) });
  }
  if (p.startsWith('/api/v1/account') && req.method === 'POST') {
    const email = normEmail(b.email);
    if (!email || !b.doc) return fail(400, 'bad_request');
    if ((await db.limited('acc:' + ip, 20, 15 * 60e3)) || (await db.limited('acc:' + email, 12, 15 * 60e3))) return fail(429, 'rate_limited');
    let c = await subs.fresh(email);
    if (!c || !(await matchLogin(c, b.doc))) return fail(404, 'not_found');
    if (p === '/api/v1/account/phone') {
      const tel = normPhone(b.phone);
      if (!tel) return json(400, { ok: false, error: 'invalid', message: PHONE_ERROR });
      c = await db.update(email, (x) => ((x.phone = tel), x));
    }
    if (p === '/api/v1/account/device' && b.deviceId) c = await db.update(email, (x) => (delete x.devices?.[String(b.deviceId)], x));
    if (p === '/api/v1/account/cancel' && !c.cancelledAt) {
      for (const id of Object.keys(c.gateway?.subscriptions || {})) await asaas.cancelSubscription(id).catch((e) => console.warn('[cancelar]', e.message));
      c = await db.update(email, (x) => ((x.cancelledAt = Date.now()), x));
    }
    if (!c.refCode) c = await db.update(email, (x) => ((x.refCode = newRefCode()), x));
    c = await ensureTvCode(db, c);
    return json(200, { ok: true, account: await accountView(c, cfg, db) });
  }

  // ---------- Webhook do Asaas ----------
  if (p === '/webhooks/asaas' && req.method === 'POST') {
    if (!asaas.verifyWebhook(req)) return fail(401, 'invalid_token');
    const id = b.id ? 'asaas-' + b.id : `asaas-${b.event}-${b.payment?.id}-${b.payment?.status}`;
    if (await db.seenWebhook(id)) return json(200, { ok: true, duplicate: true });
    try {
      const custId = b.payment?.customer || b.subscription?.customer;
      if (custId) {
        const local = await db.byGatewayCustomer(custId);
        const email = local?.email || (await asaas.fetchCustomer(custId))?.email;
        if (email) {
          const c = await subs.sync(email);
          // Indicação: cada cobrança nova do indicado é dividida (se o indicador estiver em dia).
          if (b.event === 'PAYMENT_CREATED' && b.payment?.id && c?.referredBy) await applyReferralSplit(db, asaas, cfg, c, b.payment.id);
          if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(b.event) && c?.referredBy) await recordCommission(db, cfg, c, b.payment);
        }
      }
      return json(200, { ok: true });
    } catch (err) {
      console.error('[webhook asaas]', b.event, err.message);
      return json(500, { ok: false });
    }
  }

  // ---------- Painel (Authorization: Bearer ADMIN_TOKEN) ----------
  if (p.startsWith('/admin/api/')) return admin(req, url, b, { db, asaas, subs, cfg, fail });

  return fail(404, 'Rota inexistente.');
}

async function referralView(c, cfg, db) {
  const referees = await db.referredBy(c.email);
  const commissions = Object.values(c.commissions || {});
  return {
    percent: cfg.referralPercent,
    code: c.refCode || null,
    link: c.refCode ? `${cfg.publicUrl}/assinar?ref=${c.refCode}` : null,
    walletId: c.walletId ? c.walletId.slice(0, 8) + '…' + c.walletId.slice(-4) : null,
    indicated: referees.length,
    paying: referees.filter((r) => evaluate(r, cfg).status === 'active').length,
    total: Math.round(commissions.reduce((s, x) => s + x.value, 0) * 100) / 100,
    last: commissions.sort((a, b) => b.at - a.at).slice(0, 10),
    eligible: evaluate(c, cfg).status === 'active',
  };
}

async function accountView(c, cfg, db) {
  const st = evaluate(c, cfg);
  const plan = cfg.plans.find((x) => x.id === c.plan);
  return {
    referral: await referralView(c, cfg, db),
    name: c.name || '',
    email: c.email,
    accessCode: c.accessCode || null,
    tvCode: c.tvCode || null,
    tvLink: tvLink(cfg, c.tvCode),
    trialUntil: c.trialUntil || null,
    plan: plan ? { name: plan.name, price: plan.price } : null,
    status: st.status,
    reason: st.reason,
    paidUntil: st.paidUntil,
    suspendAt: st.suspendAt,
    payUrl: st.status !== 'active' ? c.lastInvoiceUrl || null : null,
    renewUrl: `/assinar?email=${encodeURIComponent(c.email)}`,
    cancelled: !!c.cancelledAt,
    canCancel: !!Object.keys(c.gateway?.subscriptions || {}).length && !c.cancelledAt,
    phone: c.phone || null,
    phoneBad: !!c.phone && !normPhone(c.phone),
    devices: Object.entries(c.devices || {}).map(([id, d]) => ({ id, name: d.name, platform: d.platform, lastSeen: d.lastSeen })),
    maxDevices: cfg.maxDevices,
  };
}

async function admin(req, url, b, { db, asaas, subs, cfg, fail }) {
  const given = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!cfg.adminToken || given.length !== cfg.adminToken.length || [...given].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ cfg.adminToken.charCodeAt(i)), 0))
    return json(401, { ok: false, error: 'unauthorized', message: 'Senha do painel inválida.' });
  // Datas para o painel: último pagamento confirmado e próxima renovação.
  const view = (c) => {
    if (!c) return null;
    const paid = Object.values(c.orders || {}).filter((o) => !o.cancelled && o.financial === 'PAID');
    const lastPaymentAt = paid.reduce((m, o) => Math.max(m, o.paidAt || 0), 0);
    return {
      ...c,
      cpfHash: undefined,
      orders: undefined,
      state: evaluate(c, cfg),
      lastPaymentAt,
      renewalAt: c.paidUntil ? c.paidUntil - cfg.toleranceHours * 3600e3 : 0,
      payments: paid.length,
      phone: c.phone || null,
      // Número fora do padrão (ex.: DDD trocado pelo 55): o painel pede para conferir.
      phoneBad: !!c.phone && !normPhone(c.phone),
      tvLink: tvLink(cfg, c.tvCode),
      optMessages: c.optMessages !== false,
      referredBy: c.referredBy || null,
      walletId: c.walletId || null,
      commissionsTotal: Math.round(Object.values(c.commissions || {}).reduce((s, x) => s + x.value, 0) * 100) / 100,
    };
  };
  const parts = url.pathname.split('/').filter(Boolean).slice(2);
  // Faturamento: valor mensal equivalente de cada plano (semestral ÷ 6, anual ÷ 12).
  if (parts[0] === 'billing') {
    const monthly = (p) => p.price / Math.max(1, Math.round(p.days / 30));
    const entry = [...cfg.plans].sort((a, b) => monthly(b) - monthly(a))[0] || cfg.plans[0]; // plano de entrada (maior valor mensal)
    const now = new Date();
    // Início do mês no horário de Brasília (UTC-3).
    const brt = new Date(now.getTime() - 3 * 3600e3);
    const monthStart = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), 1) + 3 * 3600e3;
    const byPlan = Object.fromEntries(cfg.plans.map((p) => [p.id, { id: p.id, name: p.name, price: p.price, monthly: monthly(p), paid: 0, trial: 0 }]));
    const people = [];
    let received = 0;
    let receivedCount = 0;
    let manual = 0;
    let late = 0;
    for (const c of await db.list()) {
      const st = evaluate(c, cfg);
      for (const o of Object.values(c.orders || {}))
        if (!o.cancelled && o.financial === 'PAID' && o.paidAt >= monthStart) {
          received += Number(o.value || 0);
          receivedCount++;
        }
      const plan = cfg.plans.find((p) => p.id === c.plan);
      // Pagante = tem pagamento válido agora (mesmo que também tenha liberação manual no painel).
      const paying = plan && c.override !== 'blocked' && c.paidUntil && Date.now() <= c.paidUntil;
      let kind = null;
      if (paying) kind = 'paid';
      else if (st.reason === 'trial') kind = 'trial';
      else if (st.reason === 'manual') manual++;
      else if (st.status === 'grace') late++;
      if (!kind) continue;
      const p = kind === 'paid' ? plan : entry;
      // Valor que o cliente realmente paga (última fatura paga); sem fatura, o preço atual do plano.
      const lastPaid = Object.values(c.orders || {}).filter((o) => !o.cancelled && o.financial === 'PAID' && o.value).sort((x, y) => y.paidAt - x.paidAt)[0];
      const price = kind === 'paid' && lastPaid ? Number(lastPaid.value) : p.price;
      const perMonth = price / Math.max(1, Math.round(p.days / 30));
      byPlan[p.id][kind]++;
      byPlan[p.id][kind + 'Sum'] = (byPlan[p.id][kind + 'Sum'] || 0) + perMonth;
      byPlan[p.id][kind + 'Cycle'] = (byPlan[p.id][kind + 'Cycle'] || 0) + price;
      people.push({ name: c.name || '', email: c.email, kind, plan: p.name, price, monthly: Math.round(perMonth * 100) / 100, until: kind === 'trial' ? c.trialUntil : c.paidUntil, manual: c.override === 'active' });
    }
    const r2 = (v) => Math.round(v * 100) / 100;
    const sum = (k) => r2(Object.values(byPlan).reduce((s, x) => s + (x[k + 'Sum'] || 0), 0));
    const sumCycle = (k) => r2(Object.values(byPlan).reduce((s, x) => s + (x[k + 'Cycle'] || 0), 0));
    for (const x of Object.values(byPlan)) {
      x.realMonthly = r2(x.paidSum || 0);
      x.forecastMonthly = r2((x.paidSum || 0) + (x.trialSum || 0));
    }
    const real = sum('paid');
    const trial = sum('trial');
    return json(200, {
      ok: true,
      real: { monthly: real, cycle: sumCycle('paid'), count: people.filter((x) => x.kind === 'paid').length },
      forecast: { monthly: Math.round((real + trial) * 100) / 100, cycle: Math.round((sumCycle('paid') + sumCycle('trial')) * 100) / 100, count: people.length, trialCount: people.filter((x) => x.kind === 'trial').length },
      received: { value: Math.round(received * 100) / 100, count: receivedCount, since: monthStart },
      trialPlan: entry.name,
      plans: Object.values(byPlan),
      manual,
      late,
      people: people.sort((a, b) => (a.kind === b.kind ? (a.name || a.email).localeCompare(b.name || b.email, 'pt-BR') : a.kind === 'paid' ? -1 : 1)),
    });
  }
  if (parts[0] === 'summary') {
    const all = (await db.list()).map(view);
    const count = (st) => all.filter((c) => c.state.status === st && c.state.reason !== 'trial_ready').length;
    return json(200, { ok: true, total: all.length, active: count('active'), grace: count('grace'), suspended: count('suspended'), store: 'Checkout próprio (Asaas)', connected: asaas.configured(), plans: cfg.plans });
  }
  if (parts[0] === 'content' && parts[1] === 'obrigado') {
    if (req.method === 'POST') {
      const content = b.reset
        ? {}
        : {
            titulo: clean(b.titulo, 80) || PAID_DEFAULT.titulo,
            texto: clean(b.texto, 400),
            passos: (Array.isArray(b.passos) ? b.passos : []).map((x) => clean(x, 400)).filter(Boolean).slice(0, 6),
            botao: clean(b.botao, 60) || PAID_DEFAULT.botao,
            whatsapp: clean(b.whatsapp, 120),
          };
      await db.settings.put('obrigado', content);
      return json(200, { ok: true, content: { ...PAID_DEFAULT, ...content } });
    }
    return json(200, { ok: true, content: { ...PAID_DEFAULT, ...((await db.settings.get('obrigado')) || {}) } });
  }
  if (parts[0] === 'content' && parts[1] === 'confirmacao') {
    if (req.method === 'POST') {
      const content = b.reset ? null : cleanConfirmation(b);
      await db.settings.put('confirmacao', content || {});
      return json(200, { ok: true, content: { ...CONFIRMATION_DEFAULT, ...(content || {}) } });
    }
    return json(200, { ok: true, content: { ...CONFIRMATION_DEFAULT, ...((await db.settings.get('confirmacao')) || {}) }, defaults: CONFIRMATION_DEFAULT });
  }
  if (parts[0] !== 'customers') return fail(404, 'Rota inexistente.');
  const email = parts[1] ? normEmail(decodeURIComponent(parts[1])) : '';
  if (!email && req.method === 'POST') {
    if (!b.email) return fail(400, 'bad_request');
    const code = (await db.get(b.email))?.accessCode || 'GTV-' + [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    const c = await db.update(b.email, (x) => ({ ...x, name: b.name || x.name || '', accessCode: code, city: b.city || x.city || '', override: 'active', overrideSource: 'admin', overrideUntil: b.until ? Date.parse(b.until + 'T23:59:59-03:00') : 0 }));
    return json(200, { ok: true, customer: view(await ensureTvCode(db, c)) });
  }
  if (!email) {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const list = await db.list();
    // Clientes antigos ganham o link fixo da TV na primeira vez que a lista abre.
    for (let i = 0; i < list.length; i++) if (!list[i].tvCode) list[i] = await ensureTvCode(db, list[i]);
    return json(200, { ok: true, customers: list.filter((c) => !q || c.email.includes(q)).map(view) });
  }
  if (parts[2] === 'sync' && req.method === 'POST') return json(200, { ok: true, customer: view(await subs.sync(email)) });
  if (parts[2] === 'cancel' && req.method === 'POST') {
    const c = await db.get(email);
    for (const id of Object.keys(c?.gateway?.subscriptions || {})) await asaas.cancelSubscription(id).catch((e) => console.warn('[cancelar]', e.message));
    return json(200, { ok: true, customer: view(await db.update(email, (x) => ((x.cancelledAt = Date.now()), x))) });
  }
  if (parts[2] === 'devices' && parts[3] && req.method === 'DELETE')
    return json(200, { ok: true, customer: view(await db.update(email, (x) => (delete x.devices?.[decodeURIComponent(parts[3])], x))) });
  if (req.method === 'POST') {
    if (b.phone && !normPhone(b.phone)) return json(400, { ok: false, error: 'invalid', message: PHONE_ERROR });
    const c = await db.update(email, (x) => {
      if ('override' in b) {
        x.override = b.override || null;
        x.overrideSource = 'admin';
      }
      if ('overrideUntil' in b) x.overrideUntil = b.overrideUntil ? Date.parse(b.overrideUntil + 'T23:59:59-03:00') : 0;
      if ('note' in b) x.note = String(b.note || '');
      if ('phone' in b) {
        x.phone = normPhone(b.phone) || null;
      }
      return x;
    });
    return json(200, { ok: true, customer: view(c) });
  }
  if (req.method === 'DELETE') {
    // Excluir: antes cancela as cobranças futuras no Asaas (senão o cliente continuaria sendo cobrado).
    const c = await db.get(email);
    let cancelled = 0;
    if (c && !c.cancelledAt)
      for (const id of Object.keys(c.gateway?.subscriptions || {})) {
        try {
          await asaas.cancelSubscription(id);
          cancelled++;
        } catch (e) {
          console.warn('[excluir] não cancelou', id, e.message);
          if (e.http !== 404) return json(502, { ok: false, error: 'gateway', message: 'Não foi possível cancelar a assinatura no Asaas. Tente de novo antes de excluir.' });
        }
      }
    await db.remove(email);
    return json(200, { ok: true, cancelled });
  }
  return json(200, { ok: true, customer: view(await db.get(email)) });
}

// Envia um app guardado no KV (o instalador do Windows é juntado a partir das partes).
async function serveFile(env, apk, tag = null) {
  const headers = { 'Content-Type': apk.type || 'application/vnd.android.package-archive', 'Content-Disposition': `attachment; filename="${apk.name}"`, 'Cache-Control': 'no-store' };
  const missing = () => new Response('Arquivo ainda não publicado.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (tag && !apk.chunked) {
    const buf = await env.FILES.get(apk.key, { type: 'arrayBuffer' });
    if (!buf) return missing();
    let body = buf;
    try {
      body = tagApk(buf, tag) || buf;
    } catch (err) {
      console.warn('[download] não gravou a chave de ativação:', err.message);
    }
    return new Response(body, { headers: { ...headers, 'Content-Length': String(buf.byteLength) } });
  }
  if (apk.chunked) {
    const meta = await env.FILES.get(apk.key + ':meta', { type: 'json' });
    if (!meta?.parts) return missing();
    // Junta as partes em sequência, sem carregar o arquivo inteiro na memória.
    const out = new FixedLengthStream(meta.size);
    (async () => {
      for (let i = 0; i < meta.parts; i++) {
        const part = await env.FILES.get(`${apk.key}:${i}`, { type: 'stream' });
        if (!part) throw new Error('parte ' + i + ' ausente');
        await part.pipeTo(out.writable, { preventClose: i < meta.parts - 1 });
      }
    })().catch((err) => {
      console.error('[download]', err.message);
      out.writable.abort(err).catch(() => {});
    });
    return new Response(out.readable, { headers: { ...headers, 'Content-Length': String(meta.size) } });
  }
  const obj = await env.FILES.get(apk.key, { type: 'stream' });
  if (!obj) return missing();
  return new Response(obj, { headers });
}

// Página simples para quando o link da TV ainda não pode baixar (o Downloader mostra como site).
const tvHost = (cfg) => cfg.publicUrl.replace(/^https?:\/\//, '');
const tvLink = (cfg, code) => (code ? `${tvHost(cfg)}/tv/${code}` : null);
function tvPage(title, text) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GATES! TV</title></head>` +
    `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f11;color:#f1f1f3;font:26px/1.5 system-ui,sans-serif;text-align:center;padding:40px">` +
    `<div style="max-width:900px"><div style="color:#ec0b43;font-weight:900;font-size:44px;margin-bottom:18px">GATES! TV</div>` +
    `<h1 style="font-size:38px;margin:0 0 14px">${title}</h1><p style="color:#b4b4bc;margin:0">${text}</p></div></body></html>`;
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// Chave de ativação de um download: vale 30 dias e ativa aparelhos na conta de quem baixou.
async function newInstallTag(db, email) {
  const token = 'gi' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
  await db.downloads.put(token, 'install', email, Date.now() + 30 * 864e5);
  return token;
}

// Grava a chave num par "GTV1" dentro do preenchimento do APK Signing Block. O tamanho do arquivo não
// muda e essa região fica fora da assinatura: o APK continua válido (o app lê com InstallTag.java).
function tagApk(buf, value) {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  const min = Math.max(0, b.length - 65557);
  let e = b.length - 22;
  while (e >= min && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < min) return null;
  const cd = dv.getUint32(e + 16, true);
  if (cd < 32 || cd > b.length || new TextDecoder().decode(b.subarray(cd - 16, cd)) !== 'APK Sig Block 42') return null;
  const size = Number(dv.getBigUint64(cd - 24, true));
  const start = cd - size - 8;
  if (start < 0) return null;
  let p = start + 8;
  let pad = -1;
  while (p < cd - 24) {
    const n = Number(dv.getBigUint64(p, true));
    if (n < 4 || p + 8 + n > cd - 24) return null;
    if (dv.getUint32(p + 8, true) === 0x42726577) pad = p; // par de preenchimento
    p += 8 + n;
  }
  if (pad < 0) return null;
  const padLen = Number(dv.getBigUint64(pad, true));
  const val = new TextEncoder().encode(value);
  const ours = 12 + val.length;
  if (padLen - ours < 4) return null;
  const patch = new Uint8Array(8 + padLen);
  const pv = new DataView(patch.buffer);
  pv.setBigUint64(0, BigInt(padLen - ours), true);
  pv.setUint32(8, 0x42726577, true);
  const q = 8 + padLen - ours;
  pv.setBigUint64(q, BigInt(4 + val.length), true);
  pv.setUint32(q + 8, 0x31565447, true); // "GTV1"
  patch.set(val, q + 12);
  return new Blob([b.subarray(0, pad), patch, b.subarray(pad + 8 + padLen)]);
}

// Página fixa da TV (aberta no Downloader). JavaScript antigo (ES5) para funcionar em qualquer TV.
const TV_PAGE = "<!doctype html>\n<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>GATES! TV — Baixar na TV</title>\n<style>\nbody{margin:0;background:#0f0f11;color:#f1f1f3;font-family:Arial,Helvetica,sans-serif;text-align:center}\n.wrap{padding:36px 24px}.logo{color:#ec0b43;font-weight:900;font-size:46px;letter-spacing:1px}\nh1{font-size:40px;margin:14px 0 6px}p{font-size:25px;color:#b4b4bc;margin:8px 0;line-height:1.4}\n#qr{display:inline-block;background:#fff;padding:16px;border-radius:14px;margin:18px 0 10px}\n.code{font-size:66px;font-weight:900;letter-spacing:14px;color:#fff;margin:6px 0}\n.url{color:#ec0b43;font-weight:700}.ok{color:#6be3a0;font-size:32px}.small{font-size:19px}\n</style></head><body><div class=\"wrap\">\n<div class=\"logo\">GATES! TV</div><h1 id=\"t\">Baixar o app nesta TV</h1>\n<div id=\"box\"><p>Aponte a câmera do celular para o código abaixo:</p><div id=\"qr\"></div>\n<p>ou, no celular, abra <span class=\"url\">gatesapptv.pages.dev/conta</span> e digite:</p>\n<div class=\"code\" id=\"code\">······</div><p class=\"small\" id=\"st\">Aguardando a confirmação no celular…</p></div></div>\n<script src=\"https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js\"></script>\n<script>\n(function () {\n  var lite = /[?&]lite=1/.test(location.search), id = null;\n  function $(i) { return document.getElementById(i); }\n  function req(m, u, b, cb) {\n    var x = new XMLHttpRequest();\n    x.open(m, u, true);\n    x.setRequestHeader('Content-Type', 'application/json');\n    x.onreadystatechange = function () {\n      if (x.readyState !== 4) return;\n      var j = {};\n      try { j = JSON.parse(x.responseText); } catch (e) {}\n      cb(x.status, j);\n    };\n    x.send(b ? JSON.stringify(b) : null);\n  }\n  function start() {\n    req('POST', '/api/v1/handoff/start', { lite: lite }, function (s, j) {\n      if (!j.ok) { $('st').textContent = j.message || 'Não foi possível gerar o código. Tentando de novo…'; return setTimeout(start, 5000); }\n      id = j.id;\n      $('code').textContent = j.code;\n      $('st').textContent = 'Aguardando a confirmação no celular…';\n      var q = $('qr'); q.innerHTML = '';\n      try { new QRCode(q, { text: j.qr, width: 280, height: 280 }); } catch (e) { q.style.display = 'none'; }\n      setTimeout(poll, 3000);\n    });\n  }\n  function poll() {\n    req('GET', '/api/v1/handoff/poll?id=' + encodeURIComponent(id), null, function (s, j) {\n      if (s === 410) return start(); // código expirou: gera outro\n      if (j.url) {\n        $('t').textContent = 'Baixando o GATES! TV…';\n        $('box').innerHTML = '<p class=\"ok\">Confirmado! O download vai começar.</p><p>Quando terminar, toque em <b>Instalar</b> e depois em <b>Abrir</b>. O app já entra na sua conta.</p>';\n        location.href = j.url;\n        return;\n      }\n      setTimeout(poll, 3000);\n    });\n  }\n  start();\n})();\n</script></body></html>";
