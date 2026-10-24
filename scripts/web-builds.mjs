// Builds do app web para as versões de assinantes, usados pelos APKs (android/build-apk.mjs)
// e pelo instalador de teste do Windows (scripts/build-win-teste.mjs).
//   dist-sub  -> assinantes (servidor de licenças de produção: VITE_LICENSE_API)
//   dist-test -> TESTE (servidor de teste deste PC na rede local, chave de teste, selo "TESTE")
// Nenhum dos dois leva a lista, as chaves, o e-mail ou as fotos da família; o build é
// interrompido se algum desses dados aparecer no resultado.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanIp } from '../license-server/lib/lan.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = ['815624845', '777412455', 'dnsflow', '27aa2f314716725de1e05120d5947fbc', 'f6e80753', 'prsergiokent', '9f7e156bc33e5aa8df6233b1b6e3b9bd', '05cba421d5df1fef6c0c7895e8140b04'];
const done = new Set();

const listFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));

// Chave pública do servidor de teste (cria a chave de teste na primeira vez).
function demoPublicKey() {
  const out = execFileSync(process.execPath, [path.join(root, 'license-server', 'cli.mjs'), 'chave'], {
    env: { ...process.env, DATA_DIR: path.join(root, 'license-server', 'data-demo'), GATES_ENV_FILE: path.join(root, 'license-server', '.env.demo') },
    encoding: 'utf8',
  });
  return out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
}

export function testServerUrl() {
  return process.env.TEST_LICENSE_API || `http://${lanIp()}:8787`;
}

// Degustação: só canais de sinal aberto oficial, com os links publicados pelas próprias emissoras
// (TV Câmara: camara.leg.br/tv · TV Brasil: player oficial da EBC em aovivo.ebc.com.br).
const DEMO_M3U = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="TVCamara" group-title="Canais abertos",TV Câmara',
  'https://stream3.camara.gov.br/tv1/manifest.m3u8',
  '#EXTINF:-1 tvg-id="TVBrasil" group-title="Canais abertos",TV Brasil',
  'https://tvbrasil-stream.ebc.com.br/index.m3u8',
  '',
].join('\n');

const OUT = { test: 'dist-test', sub: 'dist-sub', demo: 'dist-demo', tizen: 'dist-tizen', webos: 'dist-webos', web: 'dist-web' };

export function buildWeb(kind) {
  if (done.has(kind)) return path.join(root, OUT[kind]);
  const outName = OUT[kind];
  const env = { ...process.env, VITE_SUBSCRIBER: kind === 'demo' ? '' : '1', VITE_DEMO: kind === 'demo' ? '1' : '' };
  // Smart TVs: app de assinantes com o build próprio (scripts/vite-smarttv.mjs).
  env.VITE_PLATFORM = kind === 'tizen' || kind === 'webos' ? kind : '';
  // Versão web (navegador): app de assinantes sem proxy local.
  env.VITE_WEB = kind === 'web' ? '1' : '';
  delete env.ELECTRON_RUN_AS_NODE;
  if (kind === 'test') {
    Object.assign(env, { VITE_TEST: '1', VITE_LICENSE_API: testServerUrl(), VITE_LICENSE_PUBKEY: demoPublicKey() });
    console.log(`\nVersão de TESTE → servidor ${env.VITE_LICENSE_API}`);
  } else {
    // Servidor de licenças de produção (sem isso o app aponta para o endereço de exemplo e não ativa).
    env.VITE_LICENSE_API ||= 'https://gatesapptv.pages.dev';
  }
  execFileSync('npx', ['vite', 'build', '--outDir', outName, '--emptyOutDir'], { cwd: root, stdio: 'inherit', shell: true, env });
  const outDir = path.join(root, outName);
  fs.rmSync(path.join(outDir, 'avatars'), { recursive: true, force: true });
  if (kind === 'demo') {
    fs.rmSync(path.join(outDir, 'channel-logos'), { recursive: true, force: true });
    fs.writeFileSync(path.join(outDir, 'demo-canais.m3u'), DEMO_M3U);
  }
  const leaks = listFiles(outDir)
    .filter((f) => /\.(js|html|json|css)$/.test(f))
    .flatMap((f) => {
      const txt = fs.readFileSync(f, 'utf8');
      return SECRETS.filter((s) => txt.includes(s)).map((s) => `${path.relative(root, f)}: ${s.slice(0, 4)}…`);
    });
  if (leaks.length) {
    console.error('Dados pessoais encontrados no app de assinantes:', leaks);
    process.exit(1);
  }
  console.log(`✓ ${outName}: sem dados pessoais`);
  done.add(kind);
  return outDir;
}
