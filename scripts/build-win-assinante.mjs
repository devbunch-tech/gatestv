// Instalador Windows para ASSINANTES (mesma trava de licença dos APKs: sem assinatura em dia, o app
// não abre). Usa o servidor de licenças de produção e não leva nenhum dado pessoal.
//   node scripts/build-win-assinante.mjs   (gera release/GatesTV-Windows-Setup-<versão>.exe)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VITE_LICENSE_API ||= 'https://gatesapptv.pages.dev';
const { buildWeb } = await import('./web-builds.mjs');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
buildWeb('sub');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync('npx', ['electron-builder', '--win', 'nsis', '--config', 'electron-builder.assinante.json'], { cwd: root, stdio: 'inherit', shell: true, env });
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const exe = `GatesTV-Windows-Setup-${version}.exe`;
fs.copyFileSync(path.join(root, 'release', 'assinante-win', exe), path.join(root, 'release', exe));
console.log('\nInstalador Windows (assinantes):', path.join(root, 'release', exe));
