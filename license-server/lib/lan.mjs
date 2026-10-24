// IP deste computador na rede local (para a TV e o celular acharem o servidor de teste).
import os from 'node:os';

export function lanIp() {
  const all = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal);
  const rank = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3);
  return all.map((i) => i.address).sort((a, b) => rank(a) - rank(b))[0] || '127.0.0.1';
}
