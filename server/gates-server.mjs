// Servidor local do GATES! TV: proxy de listas/streams (contorna CORS e conteúdo misto) e
// verificação de canais ao vivo. Usado pelo Vite (desenvolvimento) e pelo app de Windows (Electron).
// O app de Android tem uma versão equivalente em Java (android/src/.../LocalServer.java).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const proxify = (abs) => '/proxy?url=' + encodeURIComponent(abs);

// Reescreve as URLs de uma playlist HLS (.m3u8) para que segmentos,
// sub-playlists e chaves também passem pelo proxy.
function rewriteHls(text, baseUrl) {
  const resolve = (u) => {
    try {
      return proxify(new URL(u, baseUrl).href);
    } catch {
      return u;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${resolve(u)}"`);
      return resolve(t);
    })
    .join('\n');
}

export async function proxyHandler(req, res, next) {
  if (!req.url.startsWith('/proxy')) return next();
  const params = new URL(req.url, 'http://local').searchParams;
  const target = params.get('url');
  if (!target || !/^https?:\/\//i.test(target)) {
    res.statusCode = 400;
    return res.end('Parâmetro "url" inválido');
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const headers = { 'user-agent': UA, accept: '*/*' };
    if (req.headers.range) headers.range = req.headers.range;
    const upstream = await fetch(target, { headers, redirect: 'follow', signal: controller.signal });

    res.setHeader('access-control-allow-origin', '*');
    const ct = upstream.headers.get('content-type') || '';
    const path = new URL(upstream.url).pathname;
    const looksHls = /mpegurl/i.test(ct) || /\.m3u8$/i.test(path);

    if (looksHls && params.get('raw') !== '1') {
      const text = await upstream.text();
      res.statusCode = upstream.status;
      if (text.trimStart().startsWith('#EXTM3U')) {
        res.setHeader('content-type', 'application/vnd.apple.mpegurl');
        return res.end(rewriteHls(text, upstream.url));
      }
      if (ct) res.setHeader('content-type', ct);
      return res.end(text);
    }

    res.statusCode = upstream.status;
    // O fetch do Node já descomprime gzip/br: o content-length original não vale mais nesse caso.
    const encoded = upstream.headers.get('content-encoding');
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      if (h === 'content-length' && encoded) continue;
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body)
      .on('error', () => res.destroy())
      .pipe(res);
  } catch (err) {
    if (controller.signal.aborted) return;
    res.statusCode = 502;
    res.end('Falha no proxy: ' + err.message);
  }
}

// Verifica se um canal ao vivo está no ar lendo só o começo do stream (sem baixar o vídeo).
// HLS: a playlist precisa ter variantes ou segmentos. TS: os primeiros bytes precisam ser pacotes MPEG-TS.
export async function probeHandler(req, res, next) {
  if (!req.url.startsWith('/probe')) return next();
  const target = new URL(req.url, 'http://local').searchParams.get('url');
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  if (!target || !/^https?:\/\//i.test(target)) return res.end(JSON.stringify({ ok: false, error: 'url' }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const started = Date.now();
  try {
    const upstream = await fetch(target, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: controller.signal });
    const ct = upstream.headers.get('content-type') || '';
    let bytes = new Uint8Array(0);
    if (upstream.ok && upstream.body) {
      const reader = upstream.body.getReader();
      while (bytes.length < 2048) {
        const { value, done } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(bytes.length + value.length);
        merged.set(bytes);
        merged.set(value, bytes.length);
        bytes = merged;
      }
      reader.cancel().catch(() => {});
    }
    controller.abort(); // encerra a conexão com o servidor (não consome uma conexão de exibição)
    const text = new TextDecoder().decode(bytes.slice(0, 2048));
    let ok = false;
    let kind = '';
    if (upstream.ok && text.includes('#EXTM3U')) {
      kind = 'hls';
      ok = /#EXT-X-STREAM-INF|#EXTINF/.test(text);
    } else if (upstream.ok && bytes.length >= 188 && bytes[0] === 0x47) {
      kind = 'ts';
      ok = true;
    } else if (upstream.ok && bytes.length > 0 && /video|mpegurl|octet-stream|mp2t/i.test(ct)) {
      kind = 'media';
      ok = true;
    }
    res.end(JSON.stringify({ ok, kind, status: upstream.status, ms: Date.now() - started }));
  } catch (err) {
    res.end(JSON.stringify({ ok: false, error: controller.signal.aborted ? 'timeout' : err.message, ms: Date.now() - started }));
  } finally {
    clearTimeout(timer);
  }
}


const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

// Serve os arquivos do app (pasta dist) + /proxy e /probe. Retorna o servidor já ouvindo.
export function startServer({ root, port = 47123, host = '127.0.0.1' }) {
  const serveStatic = (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(path.normalize(root))) {
      res.statusCode = 403;
      return res.end();
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.setHeader('content-type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    if (urlPath.includes('/assets/')) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    fs.createReadStream(file).pipe(res);
  };
  const server = http.createServer((req, res) => {
    probeHandler(req, res, () => proxyHandler(req, res, () => serveStatic(req, res)));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
