// "Shopify falso" para testar sem loja: node license-server/test/mock-shopify.mjs [porta]
// Depois rode o servidor com SHOPIFY_API_BASE=http://127.0.0.1:<porta>.
// Clientes de exemplo (e-mail / pedido):
//   em-dia@teste.com    #1001  pago há 5 dias          -> em dia
//   atrasado@teste.com  #1002  pago há 32 dias         -> aviso (suspende em até 4 dias)
//   suspenso@teste.com  #1003  pago há 40 dias         -> suspenso
import http from 'node:http';

const DAY = 864e5;
const port = Number(process.argv[2]) || 8799;
const customers = {
  'em-dia@teste.com': { id: 1, tags: [], orders: [{ id: 5001, name: '#1001', ago: 5 }] },
  'atrasado@teste.com': { id: 2, tags: [], orders: [{ id: 5002, name: '#1002', ago: 32 }] },
  'suspenso@teste.com': { id: 3, tags: [], orders: [{ id: 5003, name: '#1003', ago: 40 }] },
};
const order = (o) => {
  const at = new Date(Date.now() - o.ago * DAY).toISOString();
  return {
    id: `gid://shopify/Order/${o.id}`, name: o.name, processedAt: at, createdAt: at, cancelledAt: null, displayFinancialStatus: 'PAID',
    lineItems: { nodes: [{ sku: 'GATES-MENSAL', quantity: 1, product: { id: 'gid://shopify/Product/777' }, variant: { id: 'gid://shopify/ProductVariant/1' } }] },
  };
};

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { query, variables } = JSON.parse(body || '{}');
      let data = {};
      if (query?.includes('customers(')) {
        const email = /email:"([^"]+)"/.exec(variables.q)?.[1]?.toLowerCase();
        const c = customers[email];
        data = { customers: { nodes: c ? [{ id: `gid://shopify/Customer/${c.id}`, email, tags: c.tags, orders: { nodes: c.orders.map(order) } }] : [] } };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`Shopify falso em http://127.0.0.1:${port}`));
