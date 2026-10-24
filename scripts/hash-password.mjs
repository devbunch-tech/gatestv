// Gera sal + hash para src/config/accounts.js:  node scripts/hash-password.mjs "MinhaSenha"
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/lib/sha256.js';

const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/hash-password.mjs "MinhaSenha"');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
console.log(JSON.stringify({ salt, hash: hashPassword(password, salt) }, null, 2));
