import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { probeHandler, proxyHandler } from './server/gates-server.mjs';
import { smartTvPlugin } from './scripts/vite-smarttv.mjs';

const proxyPlugin = () => ({
  name: 'gates-proxy',
  configureServer(server) {
    server.middlewares.use(probeHandler);
    server.middlewares.use(proxyHandler);
  },
  configurePreviewServer(server) {
    server.middlewares.use(probeHandler);
    server.middlewares.use(proxyHandler);
  },
});

export default defineConfig({
  // Caminhos relativos: o mesmo build funciona no navegador, no Windows (Electron) e no Android.
  base: './',
  // Versão do app (package.json), mostrada em "Procurar atualizações".
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
  // Smart TVs Samsung/LG (VITE_PLATFORM=tizen|webos): script clássico e CSS para navegadores antigos.
  plugins: [react(), proxyPlugin(), ...(process.env.VITE_PLATFORM ? [smartTvPlugin()] : [])],
  // Duas páginas: o app (index.html) e o GATES Narração (narracao.html). As Smart TVs saem num
  // script só (iife), que não aceita mais de uma entrada: lá vai só o app.
  build: {
    rollupOptions: {
      input: process.env.VITE_PLATFORM
        ? { index: fileURLToPath(new URL('./index.html', import.meta.url)) }
        : { index: fileURLToPath(new URL('./index.html', import.meta.url)), narracao: fileURLToPath(new URL('./narracao.html', import.meta.url)) },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
