// Publica o GATES! TV na Cloudflare Pages: https://gatesapptv.pages.dev
//   node cloud/deploy.mjs              -> copia as páginas e publica
//   node cloud/deploy.mjs --segredos   -> também (re)grava os segredos (chave do Asaas, senha do painel…)
//   node cloud/deploy.mjs --apks       -> também envia os APKs de assinantes (release/GatesTV-Assinante-*.apk)
//   node cloud/deploy.mjs --apks --sem-windows -> envia só os APKs, sem reenviar o instalador do Windows
//   node cloud/deploy.mjs --rapido     -> não gera a degustação de novo (usa dist-demo)
//   node cloud/deploy.mjs --local      -> só prepara a pasta public (para testar com "wrangler pages dev")
// Segredos gerados aqui ficam em cloud/.segredos.json (NÃO compartilhe; fica fora do site).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeb } from '../scripts/web-builds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PROJECT = 'gatesapptv';
const WRANGLER = ['--yes', 'wrangler@4.42.0'];
const args = new Set(process.argv.slice(2));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Falhas de rede da Cloudflare são intermitentes: cada passo tenta até 3 vezes.
const wr = (a, opts = {}) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync('npx', [...WRANGLER, ...a], { cwd: here, stdio: opts.input ? ['pipe', 'inherit', 'inherit'] : 'inherit', shell: true, env, input: opts.input });
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`⚠ falhou (tentativa ${attempt}/3), tentando de novo…`);
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)']);
    }
  }
};

// 1) Páginas do site (mesmas do license-server) + regras da Cloudflare.
const pub = path.join(here, 'public');
fs.rmSync(pub, { recursive: true, force: true });
fs.mkdirSync(pub, { recursive: true });
for (const f of ['index.html', 'assinar.html', 'conta.html', 'admin.html', 'ativar.html', 'instalar.html', 'termos.html', 'privacidade.html', 'obrigado.html', 'testar.html', 'legal.js', 'tel.js', 'logo.png', 'icon.png'])
  fs.copyFileSync(path.join(root, 'license-server', 'public', f), path.join(pub, f));
// A função só roda nas rotas dinâmicas (economiza a cota grátis); o resto é arquivo estático.
fs.writeFileSync(path.join(pub, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*', '/admin/api/*', '/webhooks/*', '/health', '/d/*', '/tv', '/tv/*'], exclude: [] }, null, 2));
fs.writeFileSync(
  path.join(pub, '_headers'),
  ['/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: same-origin', '  X-Frame-Options: DENY', '/admin', '  X-Robots-Tag: noindex', '/conta', '  X-Robots-Tag: noindex', ''].join('\n')
);
// Degustação em /demo (app no navegador só com canais de sinal aberto oficial).
// --rapido: reaproveita a degustação já gerada (dist-demo) em vez de gerar de novo.
const demoDir = args.has('--rapido') && fs.existsSync(path.join(root, 'dist-demo', 'index.html')) ? path.join(root, 'dist-demo') : buildWeb('demo');
fs.cpSync(demoDir, path.join(pub, 'demo'), { recursive: true });
// Versão web (navegador) desativada: o endereço antigo /app leva ao manual de instalação.
fs.writeFileSync(path.join(pub, '_redirects'), ['/app /instalar 302', '/app/* /instalar 302', ''].join('\n'));
console.log('✓ páginas copiadas para cloud/public (com a degustação em /demo)');
if (args.has('--local')) process.exit(0);

// 2) Projeto e tabelas (só cria se ainda não existir).
try {
  wr(['pages', 'project', 'create', PROJECT, '--production-branch', 'main']);
} catch {
  console.log('(projeto já existe)');
}
wr(['d1', 'execute', PROJECT, '--remote', '--file', 'schema.sql', '--yes']);

// 3) Segredos.
if (args.has('--segredos')) {
  const secFile = path.join(here, '.segredos.json');
  const sec = fs.existsSync(secFile) ? JSON.parse(fs.readFileSync(secFile, 'utf8')) : {};
  const dotenv = Object.fromEntries(
    fs
      .readFileSync(path.join(root, 'license-server', '.env'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()])
  );
  // Mesma chave das licenças do servidor (os apps já conferem com a chave pública dela).
  const pem = fs.readFileSync(path.join(root, 'license-server', 'data', 'license-private.pem'), 'utf8');
  const jwk = crypto.createPrivateKey(pem).export({ format: 'jwk' });
  sec.ADMIN_TOKEN ||= crypto.randomBytes(12).toString('base64url');
  sec.ASAAS_WEBHOOK_TOKEN ||= crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(secFile, JSON.stringify(sec, null, 2));
  const defaults = fs.readFileSync(path.join(root, 'src', 'config', 'defaults.js'), 'utf8');
  const put = (name, value) => value && wr(['pages', 'secret', 'put', name, '--project-name', PROJECT], { input: value });
  put('ASAAS_API_KEY', dotenv.ASAAS_API_KEY);
  put('ADMIN_TOKEN', sec.ADMIN_TOKEN);
  put('ASAAS_WEBHOOK_TOKEN', sec.ASAAS_WEBHOOK_TOKEN);
  put('LICENSE_PRIVATE_JWK', JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
  put('APP_TMDB_KEY', dotenv.APP_TMDB_KEY || /tmdbKey: '([^']+)'/.exec(defaults)?.[1]);
  put('APP_OMDB_KEY', dotenv.APP_OMDB_KEY || /omdbKey: '([^']+)'/.exec(defaults)?.[1]);
  console.log('✓ segredos gravados na Cloudflare (cópia local em cloud/.segredos.json)');
}

// 4) APKs de assinantes no armazenamento protegido (só baixa quem está em dia, via /conta).
if (args.has('--apks')) {
  const KV = '3118fa8cfd8a4a6fbeb3038454b1d1fb';
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const files = { tv: 'TV', tvLite: 'TV-LITE', phone: 'Celular', phoneLite: 'Celular-LITE', tablet: 'Tablet', tabletLite: 'Tablet-LITE' };
  for (const [key, suffix] of Object.entries(files)) {
    const file = path.join(root, 'release', `GatesTV-Assinante-${suffix}-${version}.apk`);
    if (!fs.existsSync(file)) {
      console.warn('⚠ não encontrado:', path.relative(root, file));
      continue;
    }
    wr(['kv', 'key', 'put', 'apk:' + key, '--path', JSON.stringify(file), '--namespace-id', KV, '--remote']);
  }
  // Instalador do Windows: em partes de 20 MB (limite de 25 MB por arquivo no plano grátis).
  const exe = path.join(root, 'release', `GatesTV-Windows-Setup-${version}.exe`);
  if (args.has('--sem-windows')) console.log('• instalador Windows mantido (--sem-windows)');
  else if (fs.existsSync(exe)) {
    const data = fs.readFileSync(exe);
    const PART = 20 * 1024 * 1024;
    const parts = Math.ceil(data.length / PART);
    const tmp = path.join(here, '.wrangler', 'partes');
    fs.mkdirSync(tmp, { recursive: true });
    for (let i = 0; i < parts; i++) {
      const f = path.join(tmp, `windows-${i}.bin`);
      fs.writeFileSync(f, data.subarray(i * PART, (i + 1) * PART));
      wr(['kv', 'key', 'put', `apk:windows:${i}`, '--path', JSON.stringify(f), '--namespace-id', KV, '--remote']);
    }
    const metaFile = path.join(tmp, 'windows-meta.json');
    fs.writeFileSync(metaFile, JSON.stringify({ parts, size: data.length }));
    wr(['kv', 'key', 'put', 'apk:windows:meta', '--path', JSON.stringify(metaFile), '--namespace-id', KV, '--remote']);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`✓ instalador Windows enviado (${parts} partes)`);
  } else console.warn('⚠ instalador Windows não encontrado:', path.relative(root, exe));
  console.log('✓ APKs enviados');
}

// 5) Publica.
wr(['pages', 'deploy', 'public', '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true']);
console.log(`\n✓ Publicado: https://${PROJECT}.pages.dev`);
