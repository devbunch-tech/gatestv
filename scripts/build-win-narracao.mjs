// Instalador Windows do GATES Narração (narração da live numa janelinha sempre por cima +
// volume dos outros apps). Usa o mesmo build web dos assinantes (dist-sub, página narracao.html).
//   node scripts/build-win-narracao.mjs   (gera release/GatesNarracao-Windows-Setup-<versão>.exe)
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
execFileSync('npx', ['electron-builder', '--win', 'nsis', '--config', 'electron-builder.narracao.json'], { cwd: root, stdio: 'inherit', shell: true, env });
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const exe = `GatesNarracao-Windows-Setup-${version}.exe`;
fs.copyFileSync(path.join(root, 'release', 'narracao-win', exe), path.join(root, 'release', exe));
console.log('\nInstalador Windows (GATES Narração):', path.join(root, 'release', exe));
