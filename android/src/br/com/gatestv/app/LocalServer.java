package br.com.gatestv.app;

import android.content.res.AssetManager;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Servidor HTTP local do GATES! TV (equivalente a server/gates-server.mjs):
 *  - serve o app web (assets/web)
 *  - /proxy?url=  repassa listas, EPG e streams (contorna CORS); reescreve playlists HLS
 *  - /probe?url=  verifica se um canal ao vivo está no ar lendo só o começo do stream
 */
final class LocalServer implements Runnable {
    private static LocalServer instance;
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 11; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final Pattern URI_ATTR = Pattern.compile("URI=\"([^\"]+)\"");

    private final AssetManager assets;
    private final ServerSocket server;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    private LocalServer(AssetManager assets, ServerSocket server) {
        this.assets = assets;
        this.server = server;
    }

    static synchronized void start(AssetManager assets, int port) throws IOException {
        if (instance != null) return;
        ServerSocket ss = new ServerSocket(port, 64, InetAddress.getByName("127.0.0.1"));
        ss.setReuseAddress(true);
        instance = new LocalServer(assets, ss);
        Thread t = new Thread(instance, "gates-server");
        t.setDaemon(true);
        t.start();
    }

    @Override
    public void run() {
        while (!server.isClosed()) {
            try {
                final Socket s = server.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        handle(s);
                    }
                });
            } catch (IOException ignored) {
            }
        }
    }

    // ---------------------------------------------------------------- requisição

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 16384) break;
        }
        return c == -1 && sb.length() == 0 ? null : sb.toString();
    }

    private void handle(Socket s) {
        try {
            s.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            String line = readLine(in);
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String target = parts[1];
            Map<String, String> headers = new HashMap<>();
            String h;
            while ((h = readLine(in)) != null && h.length() > 0) {
                int i = h.indexOf(':');
                if (i > 0) headers.put(h.substring(0, i).trim().toLowerCase(Locale.ROOT), h.substring(i + 1).trim());
            }
            if ("OPTIONS".equals(method)) {
                writeHead(out, 204, "No Content", null, -1, "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\n");
                return;
            }
            int q = target.indexOf('?');
            String path = q >= 0 ? target.substring(0, q) : target;
            Map<String, String> query = parseQuery(q >= 0 ? target.substring(q + 1) : "");
            boolean head = "HEAD".equals(method);

            if ("/proxy".equals(path)) proxy(query, headers, out);
            else if ("/probe".equals(path)) probe(query, out);
            else serveAsset(URLDecoder.decode(path, "UTF-8"), out, head);
        } catch (Exception ignored) {
        } finally {
            try {
                s.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static Map<String, String> parseQuery(String qs) {
        Map<String, String> m = new HashMap<>();
        for (String kv : qs.split("&")) {
            if (kv.isEmpty()) continue;
            int i = kv.indexOf('=');
            try {
                String k = URLDecoder.decode(i >= 0 ? kv.substring(0, i) : kv, "UTF-8");
                String v = i >= 0 ? URLDecoder.decode(kv.substring(i + 1), "UTF-8") : "";
                m.put(k, v);
            } catch (Exception ignored) {
            }
        }
        return m;
    }

    private static void writeHead(OutputStream out, int code, String reason, String type, long length, String extra) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        if (type != null) sb.append("Content-Type: ").append(type).append("\r\n");
        if (length >= 0) sb.append("Content-Length: ").append(length).append("\r\n");
        if (extra != null) sb.append(extra);
        sb.append("Connection: close\r\n\r\n");
        out.write(sb.toString().getBytes(UTF8));
    }

    private static void writeText(OutputStream out, int code, String type, String body, String extra) throws IOException {
        byte[] b = body.getBytes(UTF8);
        writeHead(out, code, code == 200 ? "OK" : "Error", type, b.length, extra);
        out.write(b);
        out.flush();
    }

    // ---------------------------------------------------------------- arquivos do app

    private static String mime(String p) {
        String l = p.toLowerCase(Locale.ROOT);
        if (l.endsWith(".html")) return "text/html; charset=utf-8";
        if (l.endsWith(".js") || l.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (l.endsWith(".css")) return "text/css; charset=utf-8";
        if (l.endsWith(".json") || l.endsWith(".map")) return "application/json";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".ico")) return "image/x-icon";
        if (l.endsWith(".webp")) return "image/webp";
        if (l.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private void serveAsset(String path, OutputStream out, boolean head) throws IOException {
        if (path.contains("..")) {
            writeText(out, 403, "text/plain", "forbidden", null);
            return;
        }
        String rel = path.equals("/") || path.isEmpty() ? "index.html" : path.substring(1);
        InputStream in;
        try {
            in = assets.open("web/" + rel);
        } catch (FileNotFoundException e) {
            rel = "index.html"; // rotas do app
            in = assets.open("web/index.html");
        }
        String cache = rel.startsWith("assets/") ? "Cache-Control: public, max-age=31536000, immutable\r\n" : "Cache-Control: no-cache\r\n";
        writeHead(out, 200, "OK", mime(rel), -1, cache);
        if (!head) pipe(in, out);
        in.close();
    }

    private static void pipe(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        out.flush();
    }

    // ---------------------------------------------------------------- proxy

    /** Abre a conexão seguindo redirecionamentos (inclusive http <-> https). */
    private static HttpURLConnection open(String url, String range, int connectMs, int readMs) throws IOException {
        for (int i = 0; i < 6; i++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(connectMs);
            c.setReadTimeout(readMs);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "*/*");
            if (range != null) c.setRequestProperty("Range", range);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                url = new URL(new URL(url), c.getHeaderField("Location")).toString();
                c.disconnect();
                continue;
            }
            return c;
        }
        throw new IOException("Muitos redirecionamentos");
    }

    private static String proxied(String base, String rel) {
        try {
            return "/proxy?url=" + URLEncoder.encode(new URL(new URL(base), rel).toString(), "UTF-8");
        } catch (Exception e) {
            return rel;
        }
    }

    /** Reescreve as URLs de uma playlist HLS para que segmentos e chaves também passem pelo proxy. */
    private static String rewriteHls(String text, String base) {
        StringBuilder sb = new StringBuilder();
        for (String line : text.split("\r?\n", -1)) {
            String t = line.trim();
            if (t.isEmpty()) sb.append(line);
            else if (t.startsWith("#")) {
                Matcher m = URI_ATTR.matcher(line);
                StringBuffer r = new StringBuffer();
                while (m.find()) m.appendReplacement(r, Matcher.quoteReplacement("URI=\"" + proxied(base, m.group(1)) + "\""));
                m.appendTail(r);
                sb.append(r);
            } else sb.append(proxied(base, t));
            sb.append('\n');
        }
        return sb.toString();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[32 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    private void proxy(Map<String, String> query, Map<String, String> headers, OutputStream out) throws IOException {
        String target = query.get("url");
        if (target == null || !target.matches("(?i)^https?://.*")) {
            writeText(out, 400, "text/plain", "url invalida", null);
            return;
        }
        HttpURLConnection c;
        try {
            c = open(target, headers.get("range"), 10000, 30000);
        } catch (IOException e) {
            writeText(out, 502, "text/plain", "Falha no proxy: " + e.getMessage(), "Access-Control-Allow-Origin: *\r\n");
            return;
        }
        try {
            int code = c.getResponseCode();
            String ct = c.getContentType();
            String finalUrl = c.getURL().toString();
            String finalPath = c.getURL().getPath().toLowerCase(Locale.ROOT);
            InputStream body = code >= 400 ? c.getErrorStream() : c.getInputStream();
            boolean looksHls = (ct != null && ct.toLowerCase(Locale.ROOT).contains("mpegurl")) || finalPath.endsWith(".m3u8");

            if (looksHls && !"1".equals(query.get("raw")) && body != null) {
                String text = new String(readAll(body), UTF8);
                if (text.trim().startsWith("#EXTM3U")) {
                    writeText(out, code, "application/vnd.apple.mpegurl", rewriteHls(text, finalUrl), "Access-Control-Allow-Origin: *\r\n");
                } else {
                    writeText(out, code, ct != null ? ct : "text/plain", text, "Access-Control-Allow-Origin: *\r\n");
                }
                return;
            }

            StringBuilder extra = new StringBuilder("Access-Control-Allow-Origin: *\r\n");
            String cr = c.getHeaderField("Content-Range");
            if (cr != null) extra.append("Content-Range: ").append(cr).append("\r\n");
            String ar = c.getHeaderField("Accept-Ranges");
            if (ar != null) extra.append("Accept-Ranges: ").append(ar).append("\r\n");
            long len = c.getHeaderField("Content-Encoding") == null ? c.getContentLength() : -1;
            writeHead(out, code, code < 300 ? "OK" : "Upstream", ct, len, extra.toString());
            if (body != null) {
                try {
                    pipe(body, out);
                } catch (IOException ignored) {
                    // o player fechou a conexão (troca de canal, fim do vídeo…)
                } finally {
                    body.close();
                }
            }
        } finally {
            c.disconnect();
        }
    }

    // ---------------------------------------------------------------- verificação de canais

    private void probe(Map<String, String> query, OutputStream out) throws IOException {
        String target = query.get("url");
        String extra = "Access-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n";
        if (target == null || !target.matches("(?i)^https?://.*")) {
            writeText(out, 200, "application/json", "{\"ok\":false,\"error\":\"url\"}", extra);
            return;
        }
        long t0 = System.currentTimeMillis();
        HttpURLConnection c = null;
        try {
            c = open(target, null, 8000, 8000);
            int code = c.getResponseCode();
            String ct = c.getContentType() == null ? "" : c.getContentType().toLowerCase(Locale.ROOT);
            byte[] bytes = new byte[0];
            if (code >= 200 && code < 300) {
                InputStream in = c.getInputStream();
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[2048];
                int n;
                while (bo.size() < 2048 && (n = in.read(buf, 0, 2048 - bo.size())) != -1) bo.write(buf, 0, n);
                bytes = bo.toByteArray();
                in.close();
            }
            String text = new String(bytes, UTF8);
            boolean ok = false;
            String kind = "";
            boolean success = code >= 200 && code < 300;
            if (success && text.contains("#EXTM3U")) {
                kind = "hls";
                ok = text.contains("#EXT-X-STREAM-INF") || text.contains("#EXTINF");
            } else if (success && bytes.length >= 188 && bytes[0] == 0x47) {
                kind = "ts";
                ok = true;
            } else if (success && bytes.length > 0 && (ct.contains("video") || ct.contains("mpegurl") || ct.contains("octet-stream") || ct.contains("mp2t"))) {
                kind = "media";
                ok = true;
            }
            writeText(out, 200, "application/json",
                    "{\"ok\":" + ok + ",\"kind\":\"" + kind + "\",\"status\":" + code + ",\"ms\":" + (System.currentTimeMillis() - t0) + "}", extra);
        } catch (Exception e) {
            writeText(out, 200, "application/json", "{\"ok\":false,\"error\":\"timeout\",\"ms\":" + (System.currentTimeMillis() - t0) + "}", extra);
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
