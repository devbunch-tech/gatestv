package br.com.gatestv.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Iterator;

/**
 * Atualização automática da interface (app web) sem reinstalar o APK.
 *
 * O site publica em <base>/manifest.json a lista de arquivos da versão nova (com SHA-256) e em
 * <base>/manifest.sig a assinatura ECDSA dessa lista. O app confere a assinatura com a chave
 * pública gravada no APK, baixa só os arquivos que mudaram para "ota/pending" e, na próxima
 * abertura (ou ao voltar para o app), troca para a versão nova ("ota/current").
 * Se algo falhar, continua usando a versão que já estava funcionando.
 */
final class OtaUpdater {
    /** Recursos nativos que esta versão do APK oferece. A interface publicada pede um mínimo (minNative). */
    static final int NATIVE_API = 1;

    private static volatile boolean running = false;

    private OtaUpdater() {
    }

    private static File root(Context c) {
        return new File(c.getFilesDir(), "ota");
    }

    static File currentDir(Context c) {
        return new File(root(c), "current");
    }

    private static File pendingDir(Context c) {
        return new File(root(c), "pending");
    }

    /** Número da versão de uma pasta (ota.json), ou -1. */
    private static long buildOf(File dir) {
        try {
            return new JSONObject(readAll(new FileInputStream(new File(dir, "ota.json")))).getLong("build");
        } catch (Exception e) {
            return -1;
        }
    }

    private static long embeddedBuild(AssetManager assets) {
        try {
            return new JSONObject(readAll(assets.open("web/ota.json"))).getLong("build");
        } catch (Exception e) {
            return 0;
        }
    }

    /** Pasta de onde o servidor local deve servir o app, ou null para usar o que veio no APK. */
    static File activeDir(Context c, AssetManager assets) {
        File cur = currentDir(c);
        long b = buildOf(cur);
        if (b < 0) return null;
        // APK novo instalado por cima, com uma interface mais nova que a baixada: usa a do APK.
        if (b <= embeddedBuild(assets)) {
            deleteTree(cur);
            deleteTree(pendingDir(c));
            return null;
        }
        return new File(cur, "index.html").isFile() ? cur : null;
    }

    /** Se uma versão nova já terminou de baixar, passa a usá-la. Retorna true se trocou. */
    static synchronized boolean applyPending(Context c) {
        File pend = pendingDir(c);
        if (buildOf(pend) < 0) return false; // ota.json é gravado por último: sem ele, download incompleto
        File cur = currentDir(c);
        File old = new File(root(c), "old");
        deleteTree(old);
        if (cur.exists() && !cur.renameTo(old)) return false;
        if (!pend.renameTo(cur)) {
            old.renameTo(cur);
            return false;
        }
        deleteTree(old);
        return true;
    }

    /** Procura uma versão nova em segundo plano (uma verificação por vez). */
    static void checkAsync(final Context c, final AssetManager assets, final String manifestUrl, final String publicKey) {
        if (manifestUrl == null || manifestUrl.isEmpty() || publicKey == null || publicKey.isEmpty() || running) return;
        running = true;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    check(c, assets, manifestUrl, publicKey);
                } catch (Exception ignored) {
                    // sem internet, site fora do ar ou arquivo corrompido: tenta de novo na próxima abertura
                } finally {
                    running = false;
                }
            }
        }, "gates-ota");
        t.setDaemon(true);
        t.start();
    }

    private static void check(Context c, AssetManager assets, String manifestUrl, String publicKey) throws Exception {
        byte[] manifestBytes = download(manifestUrl + "?t=" + System.currentTimeMillis());
        byte[] sig = Base64.decode(new String(download(manifestUrl.replaceAll("\\.json$", ".sig") + "?t=" + System.currentTimeMillis()), "UTF-8").trim(), Base64.DEFAULT);
        PublicKey key = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(Base64.decode(publicKey, Base64.DEFAULT)));
        Signature v = Signature.getInstance("SHA256withECDSA");
        v.initVerify(key);
        v.update(manifestBytes);
        if (!v.verify(sig)) throw new SecurityException("assinatura inválida");

        JSONObject m = new JSONObject(new String(manifestBytes, "UTF-8"));
        long build = m.getLong("build");
        if (m.optInt("minNative", 1) > NATIVE_API) return; // precisa de um APK mais novo
        File active = activeDir(c, assets);
        long have = active != null ? buildOf(active) : embeddedBuild(assets);
        if (build <= have || buildOf(pendingDir(c)) >= build) return;

        String base = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1) + build + "/";
        File stage = new File(root(c), "stage");
        deleteTree(stage);
        JSONObject files = m.getJSONObject("files");
        Iterator<String> it = files.keys();
        while (it.hasNext()) {
            String rel = it.next();
            if (rel.contains("..") || rel.startsWith("/") || rel.contains("\\")) throw new SecurityException("caminho inválido");
            String sha = files.getJSONObject(rel).getString("sha256");
            File dest = new File(stage, rel);
            dest.getParentFile().mkdirs();
            // Arquivo igual ao que já existe (a maioria, pois os nomes têm hash): copia em vez de baixar.
            if (!(active != null && copyIfSame(new File(active, rel), null, rel, sha, dest)) && !copyIfSame(null, assets, rel, sha, dest)) {
                byte[] data = download(base + encodePath(rel));
                if (!sha.equals(sha256(data))) throw new SecurityException("arquivo diferente do publicado: " + rel);
                writeFile(dest, data);
            }
        }
        JSONObject info = new JSONObject();
        info.put("version", m.optString("version"));
        info.put("build", build);
        writeFile(new File(stage, "ota.json"), info.toString().getBytes("UTF-8"));
        synchronized (OtaUpdater.class) {
            File pend = pendingDir(c);
            deleteTree(pend);
            if (!stage.renameTo(pend)) deleteTree(stage);
        }
    }

    private static boolean copyIfSame(File file, AssetManager assets, String rel, String sha, File dest) {
        try {
            byte[] data;
            if (file != null) {
                if (!file.isFile()) return false;
                data = readBytes(new FileInputStream(file));
            } else {
                data = readBytes(assets.open("web/" + rel));
            }
            if (!sha.equals(sha256(data))) return false;
            writeFile(dest, data);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String encodePath(String rel) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (String part : rel.split("/")) {
            if (sb.length() > 0) sb.append('/');
            sb.append(java.net.URLEncoder.encode(part, "UTF-8").replace("+", "%20"));
        }
        return sb.toString();
    }

    private static byte[] download(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("Cache-Control", "no-cache");
        try {
            if (conn.getResponseCode() != 200) throw new IOException("HTTP " + conn.getResponseCode() + " " + url);
            return readBytes(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static byte[] readBytes(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) bo.write(buf, 0, n);
            return bo.toByteArray();
        } finally {
            in.close();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        return new String(readBytes(in), "UTF-8");
    }

    private static void writeFile(File f, byte[] data) throws IOException {
        OutputStream out = new FileOutputStream(f);
        try {
            out.write(data);
        } finally {
            out.close();
        }
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
