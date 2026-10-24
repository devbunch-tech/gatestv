// "Nuvemshop falsa" para testar sem loja: node license-server/test/mock-nuvemshop.mjs [porta]
// Rode o servidor com NS_API_BASE=http://127.0.0.1:<porta>/v1/1. Clientes de exemplo:
//   em-dia@teste.com #1001 (pago há 5 dias) · atrasado@teste.com #1002 (32 dias) · suspenso@teste.com #1003 (40 dias)
import http from 'node:http';

const DAY = 864e5;
export const customers = {
  'em-dia@teste.com': { id: 1, orders: [{ id: 9001, number: 1001, ago: 5, pay: 'paid' }] },
  'atrasado@teste.com': { id: 2, orders: [{ id: 9002, number: 1002, ago: 32, pay: 'paid' }] },
  'suspenso@teste.com': { id: 3, orders: [{ id: 9003, number: 1003, ago: 40, pay: 'paid' }] },
};
const order = (email, c, o) => {
  const at = new Date(Date.now() - o.ago * DAY).toISOString();
  return {
    id: o.id,
    number: o.number,
    status: o.status || 'open',
    payment_status: o.pay,
    created_at: at,
    paid_at: o.pay === 'paid' ? at : null,
    customer: { id: c.id, email },
    contact_email: email,
    products: [{ product_id: 777, variant_id: 1, sku: o.sku || 'GATES-MENSAL', quantity: 1 }],
  };
};

export function startMock(port = 8797) {
  return http
    .createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const send = (code, obj) => (res.writeHead(code, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(obj)));
      if (!/^bearer /i.test(req.headers.authentication || '')) return send(401, {});
      const p = u.pathname.replace(/^\/v1\/\d+/, '');
      const all = Object.entries(customers);
      if (p === '/customers') {
        const q = (u.searchParams.get('q') || '').toLowerCase();
        return send(200, all.filter(([e]) => e.includes(q)).map(([email, c]) => ({ id: c.id, email, note: c.note || '' })));
      }
      if (p === '/orders') {
        const ids = (u.searchParams.get('customer_ids') || '').split(',').map(Number);
        return send(200, all.filter(([, c]) => ids.includes(c.id)).flatMap(([email, c]) => c.orders.map((o) => order(email, c, o))));
      }
      const m = p.match(/^\/orders\/(\d+)$/);
      if (m) {
        for (const [email, c] of all) {
          const o = c.orders.find((x) => String(x.id) === m[1]);
          if (o) return send(200, order(email, c, o));
        }
        return send(404, {});
      }
      if (p === '/store') return send(200, { name: { pt: 'Loja de teste' }, original_domain: 'loja-teste.lojavirtualnuvem.com.br' });
      send(404, {});
    })
    .listen(port, '127.0.0.1', () => console.log(`Nuvemshop falsa em http://127.0.0.1:${port}`));
}

if (process.argv[1]?.endsWith('mock-nuvemshop.mjs')) startMock(Number(process.argv[2]) || 8797);
