// "Asaas falso" para testar sem conta: node license-server/test/mock-asaas.mjs [porta]
// Rode o servidor com ASAAS_API_BASE=http://127.0.0.1:<porta>/v3. Clientes de exemplo (e-mail / CPF):
//   em-dia@teste.com   529.982.247-25  pago há 5 dias  -> em dia
//   atrasado@teste.com 111.444.777-35  pago há 32 dias -> aviso de suspensão
//   suspenso@teste.com 123.456.789-09  pago há 40 dias -> suspenso
import http from 'node:http';

const DAY = 864e5;
const iso = (agoDays) => new Date(Date.now() - agoDays * DAY).toISOString().slice(0, 10);
export const db = { customers: [], subscriptions: [], payments: [], seq: 100 };
const id = (p) => `${p}_${++db.seq}`;

function seed(email, name, cpf, ago) {
  const c = { id: id('cus'), name, email, cpfCnpj: cpf };
  const s = { id: id('sub'), customer: c.id, value: 29.9, cycle: 'MONTHLY', status: 'ACTIVE' };
  db.customers.push(c);
  db.subscriptions.push(s);
  db.payments.push({ id: id('pay'), customer: c.id, subscription: s.id, value: 29.9, status: 'RECEIVED', dueDate: iso(ago), paymentDate: iso(ago), invoiceUrl: 'https://sandbox.asaas.com/i/exemplo' });
}
seed('em-dia@teste.com', 'Cliente Em Dia', '52998224725', 5);
seed('atrasado@teste.com', 'Cliente Atrasado', '11144477735', 32);
seed('suspenso@teste.com', 'Cliente Suspenso', '12345678909', 40);

// Simula o cliente pagando a cobrança pendente (PIX).
export function payPending(customerId) {
  const p = db.payments.find((x) => x.customer === customerId && x.status === 'PENDING');
  if (p) Object.assign(p, { status: 'RECEIVED', paymentDate: iso(0) });
  return p;
}

// Fatura de teste (no lugar da página do Asaas): mostra o valor e um botão "Simular pagamento",
// que marca a cobrança como paga e avisa o servidor de licenças como o Asaas faria.
function invoicePage(p, c) {
  const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const paid = p.status === 'RECEIVED';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fatura de teste</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;font:16px system-ui,sans-serif;color:#1d1d1f}
.c{background:#fff;max-width:380px;width:92vw;border-radius:14px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center}
.t{display:inline-block;background:#fde68a;color:#7c5800;font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px;letter-spacing:.06em}
.v{font-size:34px;font-weight:800;margin:10px 0 4px}.q{width:150px;height:150px;margin:16px auto;border-radius:8px;background:repeating-conic-gradient(#222 0 25%,#fff 0 50%) 0 0/18px 18px;opacity:.85}
button{width:100%;height:50px;border:0;border-radius:10px;background:#0a7d4f;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
.ok{color:#0a7d4f;font-weight:800;font-size:18px;margin-top:10px}small{color:#666;display:block;margin-top:12px}</style></head><body><div class="c">
<span class="t">FATURA DE TESTE — SEM COBRANÇA REAL</span><div class="v">${brl(p.value)}</div><div>${c?.name || ''}</div>
${paid ? '<p class="ok">✔ Pagamento confirmado</p><small>Pode voltar para o app: o acesso já está liberado.</small>'
 : '<div class="q"></div><form method="post" action="/fatura/' + p.id + '/pagar"><button>Simular pagamento via PIX</button></form><small>Na versão real, aqui aparece o PIX (QR Code), o boleto e o cartão do Asaas.</small>'}
</div></body></html>`;
}

export function startMock(port = 8796, { host = '127.0.0.1', invoiceBase = '', webhookUrl = '', webhookToken = '' } = {}) {
  return http
    .createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        const u = new URL(req.url, 'http://x');
        const send = (code, obj) => (res.writeHead(code, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(obj)));
        const fat = u.pathname.match(/^\/fatura\/(\w+)(\/pagar)?$/);
        if (fat) {
          const pay = db.payments.find((x) => x.id === fat[1]);
          if (!pay) return (res.writeHead(404), res.end('Fatura não encontrada'));
          if (fat[2] && req.method === 'POST') {
            Object.assign(pay, { status: 'RECEIVED', paymentDate: iso(0) });
            if (webhookUrl)
              await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'asaas-access-token': webhookToken },
                body: JSON.stringify({ id: 'evt_' + pay.id, event: 'PAYMENT_RECEIVED', payment: pay }),
              }).catch((e) => console.warn('[fatura de teste] aviso não entregue:', e.message));
            res.writeHead(303, { Location: '/fatura/' + pay.id });
            return res.end();
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(invoicePage(pay, db.customers.find((c) => c.id === pay.customer)));
        }
        if (!req.headers.access_token) return send(401, { errors: [{ description: 'sem chave' }] });
        const body = raw ? JSON.parse(raw) : {};
        const p = u.pathname.replace(/^\/v3/, '');
        const q = (k) => u.searchParams.get(k);
        let m;
        if (p === '/customers' && req.method === 'GET') {
          const list = db.customers.filter((c) => (!q('cpfCnpj') || c.cpfCnpj === q('cpfCnpj')) && (!q('email') || c.email === q('email')));
          return send(200, { data: list });
        }
        if (p === '/customers' && req.method === 'POST') {
          const c = { id: id('cus'), ...body };
          db.customers.push(c);
          return send(200, c);
        }
        if ((m = p.match(/^\/customers\/([\w]+)$/))) {
          const c = db.customers.find((x) => x.id === m[1]);
          if (!c) return send(404, {});
          if (req.method === 'PUT') Object.assign(c, body);
          return send(200, c);
        }
        if (p === '/subscriptions' && req.method === 'POST') {
          const s = { id: id('sub'), status: 'ACTIVE', ...body };
          db.subscriptions.push(s);
          db.payments.push({ id: id('pay'), customer: s.customer, subscription: s.id, value: s.value, status: 'PENDING', dueDate: s.nextDueDate, invoiceUrl: '' });
          const last = db.payments[db.payments.length - 1];
          last.invoiceUrl = invoiceBase ? `${invoiceBase}/${last.id}` : `https://sandbox.asaas.com/i/${s.id}`;
          return send(200, s);
        }
        if ((m = p.match(/^\/subscriptions\/([\w]+)\/payments$/))) return send(200, { data: db.payments.filter((x) => x.subscription === m[1]) });
        if ((m = p.match(/^\/subscriptions\/([\w]+)$/)) && req.method === 'DELETE') {
          const s = db.subscriptions.find((x) => x.id === m[1]);
          if (s) s.status = 'INACTIVE';
          return send(200, { deleted: true, id: m[1] });
        }
        if (p === '/payments') return send(200, { data: db.payments.filter((x) => x.customer === q('customer')) });
        if (p === '/myAccount/commercialInfo') return send(200, { name: 'Conta de teste (Asaas simulado)' });
        send(404, {});
      });
    })
    .listen(port, host, () => console.log(`Asaas falso em http://${host}:${port}`));
}

if (process.argv[1]?.endsWith('mock-asaas.mjs')) startMock(Number(process.argv[2]) || 8796);
