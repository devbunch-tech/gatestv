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
  // Smart TVs Samsung/LG (VITE_PLATFORM=tizen|webos): script clássico e CSS para navegadores antigos.
  plugins: [react(), proxyPlugin(), ...(process.env.VITE_PLATFORM ? [smartTvPlugin()] : [])],
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
