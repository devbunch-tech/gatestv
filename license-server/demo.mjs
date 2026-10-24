// Servidor de TESTE: checkout próprio + Asaas simulado + servidor de licenças na rede local, num comando só.
//   npm run teste:servidor   (ou clique duas vezes em license-server/iniciar-teste.bat)
// Usa dados e chave próprios (license-server/data-demo), separados da produção.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanIp } from './lib/lan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ip = lanIp();
const PORT = Number(process.env.PORT) || 8787;
const MOCK_PORT = 8796;

Object.assign(process.env, {
  GATES_ENV_FILE: path.join(here, '.env.demo'), // opcional: ajustes extras do teste
  DATA_DIR: path.join(here, 'data-demo'),
  PORT: String(PORT),
  HOST: '0.0.0.0',
  PUBLIC_URL: `http://${ip}:${PORT}`,
  STORE_PROVIDER: 'checkout',
  ASAAS_API_BASE: process.env.ASAAS_API_BASE || `http://127.0.0.1:${MOCK_PORT}/v3`,
  ASAAS_API_KEY: process.env.ASAAS_API_KEY || 'teste',
  ASAAS_WEBHOOK_TOKEN: process.env.ASAAS_WEBHOOK_TOKEN || 'teste',
  SUBSCRIPTION_SKU_PREFIXES: 'GATES',
  SUBSCRIPTION_PLANS: 'GATES-MENSAL:30,GATES-ANUAL:365',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'teste',
  // Chaves do TMDB/OMDb entregues aos apps de teste (para ver capas, elenco e notas).
  APP_TMDB_KEY: process.env.APP_TMDB_KEY || '27aa2f314716725de1e05120d5947fbc',
  APP_OMDB_KEY: process.env.APP_OMDB_KEY || 'f6e80753',
});

const { startMock } = await import('./test/mock-asaas.mjs');
// Fatura de teste acessível pelo celular também (botão "Simular pagamento").
startMock(MOCK_PORT, { host: '0.0.0.0', invoiceBase: `http://${ip}:${MOCK_PORT}/fatura`, webhookUrl: `http://127.0.0.1:${PORT}/webhooks/asaas`, webhookToken: 'teste' });
const { createServer } = await import('./server.mjs');
const server = createServer();

// O app de assinantes (versão de teste) também abre no navegador, em /app.
const fs = await import('node:fs');
const appDir = path.join(here, '..', 'dist-test');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const api = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/app') return res.writeHead(302, { Location: '/app/' }).end();
  // Arquivos do app pedidos pela raiz (ex.: /logo.png, /channel-logos/...).
  if (!u.pathname.startsWith('/app/')) {
    const asset = path.join(appDir, path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (req.method === 'GET' && u.pathname !== '/' && asset.startsWith(appDir) && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(asset).toLowerCase()] || 'application/octet-stream' });
      return fs.createReadStream(asset).pipe(res);
    }
    return api(req, res);
  }
  const rel = decodeURIComponent(u.pathname.slice(5)) || 'index.html';
  const file = path.join(appDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(appDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!fs.existsSync(path.join(appDir, 'index.html'))) return res.writeHead(404).end('Gere a versão de teste antes: npm run build:teste');
    return res.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(fs.readFileSync(path.join(appDir, 'index.html')));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
==============================================================
 GATES! TV — SERVIDOR DE TESTE LIGADO
==============================================================
 Endereço para os apps de teste:  http://${ip}:${PORT}
 Página de ativação (celular):    http://${ip}:${PORT}/ativar

 Site (landing page):              http://${ip}:${PORT}/
 Página de assinatura (checkout):  http://${ip}:${PORT}/assinar
 Área do assinante:               http://${ip}:${PORT}/conta
 App de assinante no navegador:   http://localhost:${PORT}/app   (neste computador)
 Painel de controle:              http://${ip}:${PORT}/admin  (senha: teste)
 (a fatura é de teste: tem um botão "Simular pagamento", sem cobrança real)

 Clientes de teste (Asaas simulado) — e-mail / CPF:
   em-dia@teste.com    529.982.247-25  -> em dia
   atrasado@teste.com  111.444.777-35  -> aviso de suspensão (1x)
   suspenso@teste.com  123.456.789-09  -> suspenso

 Deixe esta janela aberta enquanto testa. Se o Windows pedir,
 permita o acesso em "Redes privadas".
==============================================================`);
});
