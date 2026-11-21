// Instalador Windows "Gates-TV-Admin-Criancas": o app admin só com os perfis Leticia (até 16) e
// Melissa (até 12, abre nela). Usa o build normal (dist) aberto com ?edition=kids, em outra porta e
// com dados separados, então pode ficar instalado junto com o GATES! TV admin.
//   node scripts/build-win-criancas.mjs   (gera release/Gates-TV-Admin-Criancas-<versão>.exe)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env });
run('npx', ['vite', 'build']);
run('npx', ['electron-builder', '--win', 'nsis', '--config', 'electron-builder.criancas.json']);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const exe = `Gates-TV-Admin-Criancas-${version}.exe`;
fs.copyFileSync(path.join(root, 'release', 'criancas-win', exe), path.join(root, 'release', exe));
console.log('\nInstalador Windows (crianças):', path.join(root, 'release', exe));
