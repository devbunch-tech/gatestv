// Ferramenta de linha de comando do servidor de licenças.
//   node license-server/cli.mjs chave                      -> mostra (ou cria) a chave pública para o app
//   node license-server/cli.mjs listar [busca]
//   node license-server/cli.mjs ver <email>
//   node license-server/cli.mjs sincronizar <email>        -> relê os pedidos na loja
//   node license-server/cli.mjs liberar <email> [AAAA-MM-DD]  -> libera manualmente (até a data)
//   node license-server/cli.mjs bloquear <email>
//   node license-server/cli.mjs normal <email>             -> volta a seguir só os pagamentos
//   node license-server/cli.mjs remover-aparelho <email> <id>
//   node license-server/cli.mjs nuvemshop-token <code> <client_id> <client_secret>  -> troca o código da instalação pelo token
//   node license-server/cli.mjs testar-loja                -> confere a conexão com a loja (Nuvemshop ou Shopify)
//   node license-server/cli.mjs registrar-webhooks         -> cadastra os webhooks apontando para PUBLIC_URL
import { flush, getCustomer, listCustomers, upsertCustomer } from './lib/db.mjs';
import { evaluate, loadKeys, syncCustomer } from './lib/license.mjs';
import { provider } from './lib/providers/index.mjs';
import { config } from './lib/config.mjs';

const [cmd, a, b] = process.argv.slice(2);
const fmt = (t) => (t ? new Date(t).toLocaleString('pt-BR') : '—');
const show = (c) => {
  if (!c) return console.log('Cliente não encontrado.');
  const st = evaluate(c);
  console.log(`${c.email}\n  situação: ${st.status} (${st.reason})\n  pago até: ${fmt(st.paidUntil)}\n  suspende em: ${fmt(st.suspendAt)}`);
  if (c.override) console.log(`  manual: ${c.override}${c.overrideUntil ? ' até ' + fmt(c.overrideUntil) : ''}`);
  const orders = Object.values(c.orders || {}).sort((x, y) => y.paidAt - x.paidAt);
  console.log(`  pedidos: ${orders.map((o) => `${o.name} ${o.financial}${o.cancelled ? ' cancelado' : ''} ${fmt(o.paidAt)}`).join(' | ') || '—'}`);
  for (const [id, d] of Object.entries(c.devices || {})) console.log(`  aparelho ${id}: ${d.name} (${d.platform}) visto em ${fmt(d.lastSeen)}`);
};

switch (cmd) {
  case 'chave':
    console.log(JSON.stringify(loadKeys()));
    break;
  case 'listar':
    for (const c of listCustomers().filter((c) => !a || c.email.includes(a.toLowerCase()))) {
      const st = evaluate(c);
      console.log(`${st.status.padEnd(10)} ${fmt(st.paidUntil).padEnd(22)} ${c.email}`);
    }
    break;
  case 'ver':
    show(getCustomer(a));
    break;
  case 'sincronizar':
    show(await syncCustomer(a));
    break;
  case 'liberar':
    show(upsertCustomer(a, { override: 'active', overrideSource: 'admin', overrideUntil: b ? Date.parse(b + 'T23:59:59') : 0 }));
    break;
  case 'bloquear':
    show(upsertCustomer(a, { override: 'blocked', overrideSource: 'admin' }));
    break;
  case 'normal':
    show(upsertCustomer(a, { override: null, overrideSource: null, overrideUntil: 0 }));
    break;
  case 'remover-aparelho':
    show(upsertCustomer(a, (c) => (delete c.devices?.[b], c)));
    break;
  case 'nuvemshop-token': {
    const { exchangeInstallCode } = await import('./lib/providers/nuvemshop.mjs');
    const r = await exchangeInstallCode(a, b, process.argv[5]);
    console.log(`Pronto! Coloque no license-server/.env:
  NS_STORE_ID=${r.storeId}
  NS_ACCESS_TOKEN=${r.accessToken}
Escopos: ${r.scope}`);
    break;
  }
  case 'testar-loja':
  case 'testar-shopify': {
    const r = await provider.checkConnection();
    if (provider.name === 'checkout') {
      console.log(`Conectado ao Asaas: ${r.shop} (${r.domain})`);
      break;
    }
    if (provider.name === 'nuvemshop') {
      console.log(`Conectado à Nuvemshop: ${r.shop} ${r.domain}`);
      break;
    }
    console.log(`Conectado a ${r.shop} (${r.domain})
Escopos: ${r.scopes.join(', ')}`);
    const missing = ['read_customers', 'read_orders'].filter((s) => !r.scopes.includes(s));
    if (missing.length) console.log('Faltam escopos:', missing.join(', '));
    break;
  }
  case 'registrar-webhooks': {
    const url = `${config.publicUrl}/webhooks/${provider.name}`;
    console.log('Endereço:', url);
    for (const r of await provider.registerWebhooks(url)) console.log(`  ${r.topic}: ${r.status}`);
    break;
  }
  default:
    console.log('Comandos: nuvemshop-token | chave | listar | ver | sincronizar | liberar | bloquear | normal | remover-aparelho | testar-loja | registrar-webhooks');
}
flush();
