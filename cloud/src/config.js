// Configuração a partir das variáveis e segredos da Cloudflare (wrangler.toml + segredos).
const s = (env, k, d = '') => String(env[k] ?? d).trim();
const n = (env, k, d) => (s(env, k) === '' ? d : Number(s(env, k)));

export function makeConfig(env) {
  const plansRaw = s(env, 'PLANS', 'mensal:Mensal:29.90:30:MONTHLY');
  return {
    publicUrl: s(env, 'PUBLIC_URL', 'https://gatesapptv.pages.dev').replace(/\/$/, ''),
    brand: s(env, 'BRAND_NAME', 'GATES! TV'),
    plans: plansRaw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((p) => {
        const [id, name, price, days, cycle] = p.split(':');
        return { id: id.trim(), name: (name || id).trim(), price: Number(price) || 0, days: Number(days) || 30, cycle: (cycle || 'MONTHLY').trim().toUpperCase() };
      }),
    downloads: {
      tv: s(env, 'DOWNLOAD_TV'),
      tvLite: s(env, 'DOWNLOAD_TV_LITE'),
      phone: s(env, 'DOWNLOAD_PHONE'),
      phoneLite: s(env, 'DOWNLOAD_PHONE_LITE'),
      tablet: s(env, 'DOWNLOAD_TABLET'),
      windows: s(env, 'DOWNLOAD_WINDOWS'),
    },
    support: s(env, 'SUPPORT_WHATSAPP'),
    company: s(env, 'COMPANY_NAME'),
    contactEmail: s(env, 'CONTACT_EMAIL'),
    cnpj: s(env, 'COMPANY_CNPJ'),
    address: s(env, 'COMPANY_ADDRESS'),
    graceDays: n(env, 'GRACE_DAYS', 4),
    trialHours: n(env, 'TRIAL_HOURS', 24),
    // Programa de indicação: % de cada mensalidade paga pelo indicado (split do Asaas).
    referralPercent: n(env, 'REFERRAL_PERCENT', 20),
    toleranceHours: n(env, 'PAYMENT_TOLERANCE_HOURS', 36),
    tokenDays: n(env, 'TOKEN_DAYS', 3),
    maxDevices: n(env, 'MAX_DEVICES', 3),
    resyncMinutes: n(env, 'RESYNC_MINUTES', 30),
    adminToken: s(env, 'ADMIN_TOKEN'),
    privateJwk: s(env, 'LICENSE_PRIVATE_JWK'),
    corsOrigins: s(env, 'CORS_ORIGINS').split(',').map((x) => x.trim()).filter(Boolean),
    appConfig: { tmdbKey: s(env, 'APP_TMDB_KEY'), omdbKey: s(env, 'APP_OMDB_KEY'), supportUrl: s(env, 'SUPPORT_URL') },
    asaas: {
      apiKey: s(env, 'ASAAS_API_KEY'),
      environment: s(env, 'ASAAS_ENV', 'sandbox').toLowerCase(),
      webhookToken: s(env, 'ASAAS_WEBHOOK_TOKEN'),
      billingType: s(env, 'ASAAS_BILLING_TYPE', 'UNDEFINED').toUpperCase(),
      apiBase: s(env, 'ASAAS_API_BASE'),
    },
  };
}
