// Instalador de TESTE do Windows (edição de assinantes ligada ao servidor de teste deste PC).
// Instala ao lado do GATES! TV normal, com nome, pasta e dados próprios.
//   npm run build:teste
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeb } from './web-builds.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
buildWeb('test');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync('npx', ['electron-builder', '--win', 'nsis', '--config', 'electron-builder.teste.json'], { cwd: root, stdio: 'inherit', shell: true, env });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const exe = `GatesTV-TESTE-Setup-${pkg.version}.exe`;
fs.copyFileSync(path.join(root, 'release', 'teste-win', exe), path.join(root, 'release', exe));
console.log('\nInstalador de teste:', path.join(root, 'release', exe));
