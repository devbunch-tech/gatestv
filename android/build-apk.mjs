// Gera os APKs do GATES! TV sem Gradle, usando as ferramentas do Android SDK
// (aapt2, d8, zipalign, apksigner) e o JDK 17.
// Uso: node android/build-apk.mjs [tv|phone|tablet|phone-admin|all]   (padrão: tv)
//   tv     -> GatesTV-x.y.z.apk          (Android TV, controle remoto)
//   phone  -> GatesTV-Celular-x.y.z.apk  (celular, toque, vertical)
//   tablet -> GatesTV-Tablet-x.y.z.apk   (tablet, toque, gira livremente)
//   phone-admin -> GatesTV-Celular-Admin-x.y.z.apk (celular, só o perfil Admin)
// Ferramentas esperadas em %LOCALAPPDATA%\GatesBuildTools (ou GATES_BUILD_TOOLS).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeb } from '../scripts/web-builds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tools = process.env.GATES_BUILD_TOOLS || path.join(process.env.LOCALAPPDATA || '', 'GatesBuildTools');
const jdk = fs.readdirSync(tools).filter((d) => d.startsWith('jdk-17')).map((d) => path.join(tools, d))[0];
const sdk = path.join(tools, 'sdk');
const bt = path.join(sdk, 'build-tools', '34.0.0');
const androidJar = path.join(sdk, 'platforms', 'android-34', 'android.jar');
const outRoot = path.join(here, 'out');
const keystore = path.join(here, 'gatestv-release.keystore');
const STORE_PASS = 'gatestv-local'; // chave local de assinatura (guarde o arquivo .keystore para futuras atualizações)

const env = { ...process.env, JAVA_HOME: jdk, PATH: `${path.join(jdk, 'bin')};${process.env.PATH}` };
delete env.ELECTRON_RUN_AS_NODE;
const run = (cmd, args) => {
  console.log('›', path.basename(cmd), args.slice(0, 3).join(' '), args.length > 3 ? '…' : '');
  execFileSync(cmd, args, { stdio: 'inherit', env, shell: cmd.endsWith('.bat') });
};
const q = (p) => (p.includes(' ') ? `"${p}"` : p); // .bat via shell precisa de aspas
const listFiles = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []));

if (!jdk || !fs.existsSync(androidJar)) {
  console.error('Ferramentas não encontradas em', tools);
  process.exit(1);
}
const versionName = pkg.version;
const versionCode = String(versionName.split('.').reduce((n, x) => n * 100 + +x, 0));

// Cada versão tem o próprio pacote (podem ficar instaladas juntas) e a própria porta local.
const FLAVORS = {
  tv: { pkg: 'br.com.gatestv.app', label: 'GATES! TV', port: 47123, file: 'GatesTV', orientation: 'sensorLandscape', tv: true },
  phone: { pkg: 'br.com.gatestv.phone', label: 'GATES! TV', port: 47124, file: 'GatesTV-Celular', orientation: 'sensorPortrait' },
  tablet: { pkg: 'br.com.gatestv.tablet', label: 'GATES! TV', port: 47125, file: 'GatesTV-Tablet', orientation: 'fullUser' },
  // Celular, edição admin: só o perfil "Admin" (sem foto, avatar "ADM").
  // ---- Assinantes (Shopify): login pela compra, licença validada no servidor; sem dados pessoais. ----
  // Usam um build próprio do app (dist-sub) e têm versões LITE para aparelhos mais simples.
  'sub-tv': { pkg: 'br.com.gatestv.assinante.tv', label: 'GATES! TV', port: 47130, file: 'GatesTV-Assinante-TV', orientation: 'sensorLandscape', tv: true, device: 'tv', edition: 'subscriber', web: 'dist-sub' },
  'sub-tv-lite': { pkg: 'br.com.gatestv.assinante.tv.lite', label: 'GATES! TV Lite', port: 47131, file: 'GatesTV-Assinante-TV-LITE', orientation: 'sensorLandscape', tv: true, device: 'tv', edition: 'subscriber', web: 'dist-sub', lite: true },
  'sub-phone': { pkg: 'br.com.gatestv.assinante.phone', label: 'GATES! TV', port: 47132, file: 'GatesTV-Assinante-Celular', orientation: 'sensorPortrait', device: 'phone', edition: 'subscriber', web: 'dist-sub' },
  'sub-phone-lite': { pkg: 'br.com.gatestv.assinante.phone.lite', label: 'GATES! TV Lite', port: 47133, file: 'GatesTV-Assinante-Celular-LITE', orientation: 'sensorPortrait', device: 'phone', edition: 'subscriber', web: 'dist-sub', lite: true },
  'sub-tablet': { pkg: 'br.com.gatestv.assinante.tablet', label: 'GATES! TV', port: 47134, file: 'GatesTV-Assinante-Tablet', orientation: 'fullUser', device: 'tablet', edition: 'subscriber', web: 'dist-sub' },
  'sub-tablet-lite': { pkg: 'br.com.gatestv.assinante.tablet.lite', label: 'GATES! TV Lite', port: 47135, file: 'GatesTV-Assinante-Tablet-LITE', orientation: 'fullUser', device: 'tablet', edition: 'subscriber', web: 'dist-sub', lite: true },
  // ---- TESTE: edição de assinantes ligada ao servidor de teste deste PC (npm run build:teste) ----
  'test-tv': { pkg: 'br.com.gatestv.teste.tv', label: 'GATES! TESTE', port: 47140, file: 'GatesTV-TESTE-TV', orientation: 'sensorLandscape', tv: true, device: 'tv', edition: 'subscriber', web: 'dist-test' },
  'test-phone': { pkg: 'br.com.gatestv.teste.phone', label: 'GATES! TESTE', port: 47141, file: 'GatesTV-TESTE-Celular', orientation: 'sensorPortrait', device: 'phone', edition: 'subscriber', web: 'dist-test' },
  'phone-admin': { pkg: 'br.com.gatestv.admin', label: 'GATES! ADM', port: 47126, file: 'GatesTV-Celular-Admin', orientation: 'sensorPortrait', device: 'phone', edition: 'admin' },
};

function manifest(name, f) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${f.pkg}">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
${f.tv
    ? `    <uses-feature android:name="android.software.leanback" android:required="false" />
    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />`
    : `    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />
    <supports-screens android:smallScreens="true" android:normalScreens="true" android:largeScreens="true" android:xlargeScreens="true" android:anyDensity="true" />`}
    <application
        android:label="${f.label}"
        android:icon="@mipmap/ic_launcher"${f.tv ? '\n        android:banner="@drawable/banner"' : ''}
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true"
        android:largeHeap="true"
        android:allowBackup="true"
        android:theme="${f.tv ? '@android:style/Theme.Black.NoTitleBar.Fullscreen' : '@android:style/Theme.Material.NoActionBar'}">
        <meta-data android:name="gates.device" android:value="${f.device || name}" />${f.edition ? `
        <meta-data android:name="gates.edition" android:value="${f.edition}" />` : ''}
        <meta-data android:name="gates.port" android:value="${f.port}" />
        <meta-data android:name="gates.lite" android:value="${f.lite ? 'true' : 'false'}" />
        <activity
            android:name="br.com.gatestv.app.MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="${f.orientation}"
            android:windowSoftInputMode="adjustResize"
            android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboard|keyboardHidden|navigation|uiMode|density">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />${f.tv ? '\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />' : ''}
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
}

const arg = process.argv[2] || 'tv';
const GROUPS = {
  all: Object.keys(FLAVORS).filter((n) => !FLAVORS[n].web),
  assinantes: Object.keys(FLAVORS).filter((n) => FLAVORS[n].web === 'dist-sub'),
  teste: ['test-tv', 'test-phone'],
};
const names = GROUPS[arg] || arg.split(',');
for (const n of names) if (!FLAVORS[n]) (console.error('Versão desconhecida:', n), process.exit(1));
// Assinantes e teste usam builds próprios do app (sem dados pessoais).
if (names.some((n) => FLAVORS[n].web === 'dist-sub')) buildWeb('sub');
if (names.some((n) => FLAVORS[n].web === 'dist-test')) buildWeb('test');
for (const n of names) build(n, FLAVORS[n]);

function build(name, flavor) {
const out = path.join(outRoot, name);
console.log(`
=== APK ${name} (${flavor.pkg}) ===`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'classes'), { recursive: true });
fs.mkdirSync(path.join(out, 'dex'), { recursive: true });
fs.writeFileSync(path.join(out, 'AndroidManifest.xml'), manifest(name, flavor));

// 1) app web (dist) dentro do APK em assets/web. Adicionado com o "jar" (e não com o aapt2 -A),
// que no Windows grava os caminhos com barra invertida e o Android não acharia os arquivos.
fs.cpSync(path.join(root, flavor.web || 'dist'), path.join(out, 'apkroot', 'assets', 'web'), { recursive: true });

// 2) recursos (ícones e banner da Android TV)
run(path.join(bt, 'aapt2.exe'), ['compile', '--dir', path.join(here, 'res'), '-o', path.join(out, 'res.zip')]);
run(path.join(bt, 'aapt2.exe'), [
  'link', '-I', androidJar, '--manifest', path.join(out, 'AndroidManifest.xml'),
  '--min-sdk-version', '21', '--target-sdk-version', '34',
  '--version-code', versionCode, '--version-name', versionName,
  '-o', path.join(out, 'base.apk'), path.join(out, 'res.zip'),
]);

// 3) código Java -> classes.dex
run(path.join(jdk, 'bin', 'javac.exe'), [
  '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-nowarn', '-Xlint:-options',
  '-classpath', androidJar, '-d', path.join(out, 'classes'), ...listFiles(path.join(here, 'src'), '.java'),
]);
run(q(path.join(bt, 'd8.bat')), ['--release', '--min-api', '21', '--lib', q(androidJar), '--output', q(path.join(out, 'dex')), ...listFiles(path.join(out, 'classes'), '.class').map(q)]);

// 4) junta o classes.dex ao APK, alinha e assina
run(path.join(jdk, 'bin', 'jar.exe'), ['uf', path.join(out, 'base.apk'), '-C', path.join(out, 'dex'), 'classes.dex']);
run(path.join(jdk, 'bin', 'jar.exe'), ['uf', path.join(out, 'base.apk'), '-C', path.join(out, 'apkroot'), 'assets']);
run(path.join(bt, 'zipalign.exe'), ['-p', '-f', '4', path.join(out, 'base.apk'), path.join(out, 'aligned.apk')]);
if (!fs.existsSync(keystore)) {
  run(path.join(jdk, 'bin', 'keytool.exe'), [
    '-genkeypair', '-keystore', keystore, '-alias', 'gatestv', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', STORE_PASS, '-keypass', STORE_PASS, '-dname', 'CN=GATES! TV, O=GATES! TV, C=BR',
  ]);
}
fs.mkdirSync(path.join(root, 'release'), { recursive: true });
const apk = path.join(root, 'release', `${flavor.file}-${versionName}.apk`);
run(q(path.join(bt, 'apksigner.bat')), ['sign', '--v4-signing-enabled', 'false', '--ks', q(keystore), '--ks-pass', `pass:${STORE_PASS}`, '--key-pass', `pass:${STORE_PASS}`, '--out', q(apk), q(path.join(out, 'aligned.apk'))]);
run(q(path.join(bt, 'apksigner.bat')), ['verify', q(apk)]);
console.log('\nAPK gerado:', apk, `(${(fs.statSync(apk).size / 1048576).toFixed(1)} MB)`);
}
