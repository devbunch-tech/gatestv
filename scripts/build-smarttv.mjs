// Apps de Smart TV do GATES! TV (edição de assinantes):
//   LG (webOS)      -> release/GatesTV-LG-<versão>.ipk          (pronto para a LG Seller Lounge)
//   Samsung (Tizen) -> release/GatesTV-Samsung-<versão>.wgt     (assinado, se o Tizen Studio estiver instalado)
//                      release/smarttv/tizen/GatesTV/            (pasta do app, para assinar no Tizen Studio)
//
//   node scripts/build-smarttv.mjs                    -> as duas
//   node scripts/build-smarttv.mjs lg | samsung       -> só uma
//   node scripts/build-smarttv.mjs samsung --perfil NOME   -> assina com o perfil de certificado do Tizen Studio
//
// O app das TVs é o mesmo dos assinantes, com o build de scripts/vite-smarttv.mjs (TVs 2020+).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import { buildWeb } from './web-builds.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const args = process.argv.slice(2);
const only = args.find((a) => a === 'lg' || a === 'samsung');
const perfil = args.includes('--perfil') ? args[args.indexOf('--perfil') + 1] : '';
const out = path.join(root, 'release', 'smarttv');

// Identificação nas lojas (não mude depois de publicar: vira outro app).
const LG_ID = 'br.com.gatestv.app';
const TIZEN_PKG = 'GatesTvBr1'; // 10 letras/números (exigência do Tizen)
const TIZEN_APP = `${TIZEN_PKG}.GatesTV`;
const VENDOR = 'PALMER TECH LTDA';
const SITE = 'https://gatesapptv.pages.dev';
const BG = 0x121214ff;

const ICON = path.join(root, 'license-server', 'public', 'icon.png'); // 512×512
const LOGO = path.join(root, 'public', 'logo.png'); // 350×100

async function icon(file, w, h = w) {
  const img = await Jimp.read(ICON);
  const side = Math.min(w, h);
  img.resize(side, side);
  const canvas = new Jimp(w, h, 0x00000000);
  canvas.composite(img, Math.round((w - side) / 2), Math.round((h - side) / 2));
  await canvas.writeAsync(file);
}
async function splash(file, w, h) {
  const canvas = new Jimp(w, h, BG);
  const logo = await Jimp.read(LOGO);
  logo.resize(Math.round(w * 0.36), Jimp.AUTO);
  canvas.composite(logo, Math.round((w - logo.bitmap.width) / 2), Math.round((h - logo.bitmap.height) / 2));
  await canvas.writeAsync(file);
}
const fresh = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// ---------------------------------------------------------------- LG webOS
async function buildLg() {
  const web = buildWeb('webos');
  const dir = fresh(path.join(out, 'webos', LG_ID));
  fs.cpSync(web, dir, { recursive: true });
  await icon(path.join(dir, 'icon.png'), 80);
  await icon(path.join(dir, 'largeIcon.png'), 130);
  await splash(path.join(dir, 'splash.png'), 1920, 1080);
  // Dois pacotes: TVs 4K (interface 1920x1080) e TVs Full HD (interface 1280x720). O app se ajusta
  // sozinho; muda só a resolução declarada, que a loja usa para escolher o pacote de cada TV.
  for (const [res, suffix] of [['1920x1080', ''], ['1280x720', '-1280x720']]) {
    fs.writeFileSync(
      path.join(dir, 'appinfo.json'),
      JSON.stringify(
        {
          id: LG_ID,
          version,
          vendor: VENDOR,
          type: 'web',
          main: 'index.html',
          title: 'GATES! TV',
          icon: 'icon.png',
          largeIcon: 'largeIcon.png',
          splashBackground: 'splash.png',
          bgColor: '#121214',
          iconColor: '#ec0b43',
          resolution: res,
          // O botão Voltar chega ao app como tecla (461) em vez de voltar o histórico da página.
          disableBackHistoryAPI: true,
        },
        null,
        2
      )
    );
    // Empacota com a ferramenta oficial da LG (@webos-tools/cli).
    const pkgDir = fresh(path.join(out, 'webos-ipk' + suffix));
    execFileSync('npx', ['--yes', '-p', '@webos-tools/cli@3', 'ares-package', JSON.stringify(dir), '-o', JSON.stringify(pkgDir), '--no-minify'], {
      cwd: root,
      stdio: 'inherit',
      shell: true,
    });
    const ipk = fs.readdirSync(pkgDir).find((f) => f.endsWith('.ipk'));
    if (!ipk) throw new Error('o .ipk da LG não foi gerado');
    const dest = path.join(root, 'release', `GatesTV-LG-${version}${suffix}.ipk`);
    fs.copyFileSync(path.join(pkgDir, ipk), dest);
    console.log(`✓ LG (${res}): ${path.relative(root, dest)} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
  }
}

// ---------------------------------------------------------------- Samsung Tizen
const TIZEN_CSP =
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
  "worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; connect-src *";

function tizenCli() {
  const candidates = [process.env.TIZEN_CLI, 'C:\\tizen-studio\\tools\\ide\\bin\\tizen.bat', path.join(process.env.USERPROFILE || '', 'tizen-studio', 'tools', 'ide', 'bin', 'tizen.bat')];
  return candidates.find((c) => c && fs.existsSync(c)) || '';
}

async function buildSamsung() {
  const web = buildWeb('tizen');
  const dir = fresh(path.join(out, 'tizen', 'GatesTV'));
  fs.cpSync(web, dir, { recursive: true });
  await icon(path.join(dir, 'icon.png'), 512, 423); // ícone de app da Samsung TV
  fs.writeFileSync(
    path.join(dir, 'config.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="${SITE}/samsung" version="${version}" viewmodes="maximized">
    <tizen:application id="${TIZEN_APP}" package="${TIZEN_PKG}" required_version="2.3"/>
    <content src="index.html"/>
    <feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/>
    <icon src="icon.png"/>
    <name>GATES! TV</name>
    <author href="${SITE}">${VENDOR}</author>
    <description>Player de listas IPTV para TV, com guia de programação, perfis e controle parental.</description>
    <tizen:profile name="tv-samsung"/>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
    <access origin="*" subdomains="true"/>
    <tizen:content-security-policy>${TIZEN_CSP}</tizen:content-security-policy>
    <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`
  );
  const cli = tizenCli();
  const dest = path.join(root, 'release', `GatesTV-Samsung-${version}.wgt`);
  fs.rmSync(dest, { force: true });
  if (cli && perfil) {
    // Assina com o certificado Samsung (perfil criado no Certificate Manager do Tizen Studio).
    const pkgDir = fresh(path.join(out, 'tizen-wgt'));
    execFileSync(`"${cli}"`, ['package', '-t', 'wgt', '-s', JSON.stringify(perfil), '-o', JSON.stringify(pkgDir), '--', JSON.stringify(dir)], { stdio: 'inherit', shell: true });
    const wgt = fs.readdirSync(pkgDir).find((f) => f.endsWith('.wgt'));
    if (!wgt) throw new Error('o .wgt da Samsung não foi gerado');
    fs.copyFileSync(path.join(pkgDir, wgt), dest);
    console.log(`✓ Samsung: ${path.relative(root, dest)} (assinado com o perfil "${perfil}")`);
  } else {
    // Sem certificado: .wgt sem assinatura (serve para conferir o conteúdo; a TV e a loja exigem assinatura).
    const unsigned = path.join(root, 'release', `GatesTV-Samsung-${version}-SEM-ASSINATURA.wgt`);
    fs.rmSync(unsigned, { force: true });
    // tar do Windows (bsdtar) gera .zip com -a; o .wgt é um .zip.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-c', '--format', 'zip', '-f', unsigned, '-C', dir, ...fs.readdirSync(dir)], { stdio: 'inherit' });
    console.log(`✓ Samsung: pasta do app em ${path.relative(root, dir)}`);
    console.log(`  ${path.relative(root, unsigned)} (sem assinatura)`);
    console.log(cli ? '  Para assinar: node scripts/build-smarttv.mjs samsung --perfil NOME_DO_PERFIL' : '  Para assinar: instale o Tizen Studio (com a extensão Samsung TV) e rode com --perfil NOME_DO_PERFIL');
  }
}

if (!only || only === 'lg') await buildLg();
if (!only || only === 'samsung') await buildSamsung();
