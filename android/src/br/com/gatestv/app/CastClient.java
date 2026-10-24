package br.com.gatestv.app;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.Charset;
import java.security.cert.X509Certificate;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Transmissão para Chromecast / Google TV sem o SDK do Google (protocolo Cast v2 direto):
 * encontra os aparelhos na rede (mDNS "_googlecast._tcp"), conecta por TLS na porta 8009, abre o
 * player padrão do Chromecast (Default Media Receiver) e manda o endereço do vídeo. O Chromecast
 * busca o vídeo direto do servidor — o celular fica livre.
 */
public class CastClient {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String DEFAULT_RECEIVER = "CC1AD845";
    private static final String NS_CONN = "urn:x-cast:com.google.cast.tp.connection";
    private static final String NS_HEART = "urn:x-cast:com.google.cast.tp.heartbeat";
    private static final String NS_RECV = "urn:x-cast:com.google.cast.receiver";
    private static final String NS_MEDIA = "urn:x-cast:com.google.cast.media";
    private static final String SENDER = "sender-gates";

    private final NsdManager nsd;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, JSONObject> devices = new LinkedHashMap<String, JSONObject>();
    private NsdManager.DiscoveryListener discovery;

    // Sessão atual
    private SSLSocket socket;
    private OutputStream out;
    private volatile String state = "idle"; // idle | connecting | loading | playing | paused | buffering | error
    private volatile String deviceName = "";
    private volatile String error = "";
    private volatile String transportId;
    private volatile String sessionId;
    private volatile int mediaSessionId = -1;
    private volatile double currentTime = 0;
    private volatile double duration = 0;
    private volatile JSONObject pendingLoad;
    private int requestId = 1;

    public CastClient(Context ctx) {
        nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
    }

    // ---------- Descoberta ----------
    public synchronized void startDiscovery() {
        if (discovery != null || nsd == null) return;
        discovery = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String t, int e) { discovery = null; }
            @Override public void onStopDiscoveryFailed(String t, int e) { }
            @Override public void onDiscoveryStarted(String t) { }
            @Override public void onDiscoveryStopped(String t) { }
            @Override public void onServiceLost(NsdServiceInfo s) {
                synchronized (CastClient.this) { devices.remove(s.getServiceName()); }
            }
            @Override public void onServiceFound(NsdServiceInfo s) { resolve(s, 0); }
        };
        try {
            nsd.discoverServices("_googlecast._tcp", NsdManager.PROTOCOL_DNS_SD, discovery);
        } catch (Exception e) {
            discovery = null;
        }
    }

    public synchronized void stopDiscovery() {
        if (discovery == null) return;
        try { nsd.stopServiceDiscovery(discovery); } catch (Exception ignored) { }
        discovery = null;
    }

    // O Android só resolve um serviço por vez: tenta de novo se estiver ocupado.
    private void resolve(final NsdServiceInfo s, final int tries) {
        try {
            nsd.resolveService(s, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo info, int code) {
                    if (tries < 5) main.postDelayed(new Runnable() { public void run() { resolve(s, tries + 1); } }, 400 + tries * 300);
                }
                @Override public void onServiceResolved(NsdServiceInfo info) {
                    try {
                        String name = info.getServiceName();
                        byte[] fn = info.getAttributes() != null ? info.getAttributes().get("fn") : null;
                        byte[] md = info.getAttributes() != null ? info.getAttributes().get("md") : null;
                        JSONObject d = new JSONObject();
                        d.put("id", name);
                        d.put("name", fn != null ? new String(fn, UTF8) : name);
                        d.put("model", md != null ? new String(md, UTF8) : "");
                        d.put("host", info.getHost().getHostAddress());
                        d.put("port", info.getPort());
                        synchronized (CastClient.this) { devices.put(name, d); }
                    } catch (Exception ignored) { }
                }
            });
        } catch (Exception ignored) { }
    }

    public synchronized String devicesJson() {
        JSONArray a = new JSONArray();
        for (JSONObject d : devices.values()) {
            JSONObject x = new JSONObject();
            try {
                x.put("id", d.optString("id"));
                x.put("name", d.optString("name"));
                x.put("model", d.optString("model"));
            } catch (Exception ignored) { }
            a.put(x);
        }
        return a.toString();
    }

    // ---------- Sessão ----------
    /** media: {url, contentType, title, image, live, start} */
    public void cast(final String deviceId, final JSONObject media) {
        final JSONObject d;
        synchronized (this) { d = devices.get(deviceId); }
        if (d == null) { fail("Aparelho não encontrado na rede."); return; }
        closeSocket();
        state = "connecting";
        error = "";
        deviceName = d.optString("name");
        pendingLoad = media;
        mediaSessionId = -1;
        transportId = null;
        sessionId = null;
        currentTime = 0;
        duration = 0;
        new Thread(new Runnable() {
            public void run() {
                SSLSocket s = null;
                try {
                    SSLContext ctx = SSLContext.getInstance("TLS");
                    // O Chromecast usa certificado próprio (não de uma autoridade pública).
                    ctx.init(null, new TrustManager[] { new X509TrustManager() {
                        public void checkClientTrusted(X509Certificate[] c, String a) { }
                        public void checkServerTrusted(X509Certificate[] c, String a) { }
                        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    } }, null);
                    s = (SSLSocket) ctx.getSocketFactory().createSocket();
                    s.connect(new InetSocketAddress(d.getString("host"), d.optInt("port", 8009)), 6000);
                    s.setSoTimeout(0);
                    s.startHandshake();
                    socket = s;
                    out = s.getOutputStream();
                    send("receiver-0", NS_CONN, new JSONObject().put("type", "CONNECT"));
                    send("receiver-0", NS_RECV, new JSONObject().put("type", "LAUNCH").put("appId", DEFAULT_RECEIVER).put("requestId", nextId()));
                    startHeartbeat(s);
                    readLoop(s);
                } catch (Exception e) {
                    // Fechado por nós (parar / nova transmissão): não é erro.
                    if ("connecting".equals(state)) fail("Não foi possível conectar ao " + deviceName + ".");
                    else if (s != null && socket == s) fail("A conexão com o " + deviceName + " caiu.");
                }
            }
        }).start();
    }

    public void togglePause() {
        if (mediaSessionId < 0 || transportId == null) return;
        final String type = "playing".equals(state) || "buffering".equals(state) ? "PAUSE" : "PLAY";
        sendAsync(transportId, NS_MEDIA, type, null);
    }

    public void seek(final double to) {
        if (mediaSessionId < 0 || transportId == null) return;
        sendAsync(transportId, NS_MEDIA, "SEEK", to);
    }

    public void stop() {
        final String sid = sessionId;
        new Thread(new Runnable() {
            public void run() {
                try {
                    if (sid != null && out != null) send("receiver-0", NS_RECV, new JSONObject().put("type", "STOP").put("sessionId", sid).put("requestId", nextId()));
                } catch (Exception ignored) { }
                closeSocket();
                state = "idle";
            }
        }).start();
    }

    public String statusJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            o.put("device", deviceName);
            o.put("error", error);
            o.put("time", currentTime);
            o.put("duration", duration);
        } catch (Exception ignored) { }
        return o.toString();
    }

    // ---------- Protocolo ----------
    private synchronized int nextId() { return requestId++; }

    private void sendAsync(final String dest, final String ns, final String type, final Double seekTo) {
        new Thread(new Runnable() {
            public void run() {
                try {
                    JSONObject m = new JSONObject().put("type", type).put("mediaSessionId", mediaSessionId).put("requestId", nextId());
                    if (seekTo != null) m.put("currentTime", seekTo.doubleValue());
                    send(dest, ns, m);
                } catch (Exception ignored) { }
            }
        }).start();
    }

    private void startHeartbeat(final SSLSocket s) {
        new Thread(new Runnable() {
            public void run() {
                while (socket == s && !s.isClosed()) {
                    try {
                        send("receiver-0", NS_HEART, new JSONObject().put("type", "PING"));
                        Thread.sleep(5000);
                    } catch (Exception e) {
                        return;
                    }
                }
            }
        }).start();
    }

    private void readLoop(SSLSocket s) throws Exception {
        DataInputStream in = new DataInputStream(s.getInputStream());
        while (socket == s) {
            int len = in.readInt();
            if (len <= 0 || len > 4 * 1024 * 1024) throw new Exception("tamanho inválido");
            byte[] buf = new byte[len];
            in.readFully(buf);
            String[] msg = decode(buf); // [source, namespace, payload]
            if (msg[2] == null) continue;
            onMessage(msg[0], msg[1], new JSONObject(msg[2]));
        }
    }

    private void onMessage(String source, String ns, JSONObject m) throws Exception {
        String type = m.optString("type");
        if (NS_HEART.equals(ns) && "PING".equals(type)) {
            send(source, NS_HEART, new JSONObject().put("type", "PONG"));
        } else if (NS_RECV.equals(ns) && "RECEIVER_STATUS".equals(type)) {
            JSONArray apps = m.optJSONObject("status") != null ? m.getJSONObject("status").optJSONArray("applications") : null;
            JSONObject app = null;
            for (int i = 0; apps != null && i < apps.length(); i++)
                if (DEFAULT_RECEIVER.equals(apps.getJSONObject(i).optString("appId"))) app = apps.getJSONObject(i);
            if (app != null && transportId == null) {
                transportId = app.optString("transportId");
                sessionId = app.optString("sessionId");
                send(transportId, NS_CONN, new JSONObject().put("type", "CONNECT"));
                JSONObject p = pendingLoad;
                if (p != null) load(p);
            } else if (app == null && transportId != null) {
                // Alguém fechou o app no Chromecast (ou abriu outro).
                closeSocket();
                state = "idle";
            }
        } else if (NS_RECV.equals(ns) && "LAUNCH_ERROR".equals(type)) {
            fail("O " + deviceName + " não abriu o player.");
        } else if (NS_MEDIA.equals(ns) && "MEDIA_STATUS".equals(type)) {
            JSONArray st = m.optJSONArray("status");
            if (st == null || st.length() == 0) return;
            JSONObject x = st.getJSONObject(0);
            mediaSessionId = x.optInt("mediaSessionId", mediaSessionId);
            currentTime = x.optDouble("currentTime", currentTime);
            if (x.optJSONObject("media") != null) duration = x.getJSONObject("media").optDouble("duration", duration);
            String ps = x.optString("playerState");
            if ("PLAYING".equals(ps)) state = "playing";
            else if ("PAUSED".equals(ps)) state = "paused";
            else if ("BUFFERING".equals(ps)) state = "buffering";
            else if ("IDLE".equals(ps)) {
                String why = x.optString("idleReason");
                if ("ERROR".equals(why)) fail("O " + deviceName + " não conseguiu tocar este conteúdo.");
                else if ("FINISHED".equals(why) || "CANCELLED".equals(why)) state = "idle";
            }
        } else if (NS_MEDIA.equals(ns) && ("LOAD_FAILED".equals(type) || "LOAD_CANCELLED".equals(type) || "INVALID_REQUEST".equals(type))) {
            fail("O " + deviceName + " não conseguiu tocar este conteúdo.");
        }
    }

    private void load(JSONObject p) throws Exception {
        pendingLoad = null;
        state = "loading";
        JSONObject meta = new JSONObject().put("metadataType", 0).put("title", p.optString("title"));
        if (!p.optString("image").isEmpty()) meta.put("images", new JSONArray().put(new JSONObject().put("url", p.optString("image"))));
        JSONObject media = new JSONObject()
                .put("contentId", p.getString("url"))
                .put("contentUrl", p.getString("url"))
                .put("contentType", p.optString("contentType", "video/mp4"))
                .put("streamType", p.optBoolean("live") ? "LIVE" : "BUFFERED")
                .put("metadata", meta);
        JSONObject m = new JSONObject().put("type", "LOAD").put("requestId", nextId()).put("sessionId", sessionId)
                .put("media", media).put("autoplay", true);
        if (p.optDouble("start", 0) > 0) m.put("currentTime", p.optDouble("start", 0));
        send(transportId, NS_MEDIA, m);
    }

    private void fail(String msg) {
        error = msg;
        state = "error";
        closeSocket();
    }

    private void closeSocket() {
        SSLSocket s = socket;
        socket = null;
        out = null;
        if (s != null) try { s.close(); } catch (Exception ignored) { }
    }

    // CastMessage (protobuf): 1 versão, 2 origem, 3 destino, 4 namespace, 5 tipo (0 = texto), 6 texto.
    private synchronized void send(String dest, String ns, JSONObject payload) throws Exception {
        OutputStream o = out;
        if (o == null) throw new Exception("desconectado");
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        varintField(b, 1, 0);
        stringField(b, 2, SENDER);
        stringField(b, 3, dest);
        stringField(b, 4, ns);
        varintField(b, 5, 0);
        stringField(b, 6, payload.toString());
        byte[] body = b.toByteArray();
        byte[] len = { (byte) (body.length >>> 24), (byte) (body.length >>> 16), (byte) (body.length >>> 8), (byte) body.length };
        o.write(len);
        o.write(body);
        o.flush();
    }

    private static void varint(ByteArrayOutputStream b, long v) {
        while ((v & ~0x7FL) != 0) {
            b.write((int) ((v & 0x7F) | 0x80));
            v >>>= 7;
        }
        b.write((int) v);
    }

    private static void varintField(ByteArrayOutputStream b, int field, long v) {
        varint(b, (field << 3));
        varint(b, v);
    }

    private static void stringField(ByteArrayOutputStream b, int field, String s) {
        byte[] d = s.getBytes(UTF8);
        varint(b, (field << 3) | 2);
        varint(b, d.length);
        b.write(d, 0, d.length);
    }

    private static String[] decode(byte[] buf) {
        String[] r = new String[3];
        int i = 0;
        while (i < buf.length) {
            long key = 0;
            int shift = 0;
            int c;
            do { c = buf[i++] & 0xFF; key |= (long) (c & 0x7F) << shift; shift += 7; } while ((c & 0x80) != 0 && i < buf.length);
            int field = (int) (key >>> 3), wire = (int) (key & 7);
            if (wire == 0) {
                do { c = buf[i++] & 0xFF; } while ((c & 0x80) != 0 && i < buf.length);
            } else if (wire == 2) {
                long len = 0;
                shift = 0;
                do { c = buf[i++] & 0xFF; len |= (long) (c & 0x7F) << shift; shift += 7; } while ((c & 0x80) != 0 && i < buf.length);
                String s = new String(buf, i, (int) len, UTF8);
                i += (int) len;
                if (field == 2) r[0] = s;
                else if (field == 4) r[1] = s;
                else if (field == 6) r[2] = s;
            } else {
                break; // binário: não usamos
            }
        }
        return r;
    }
}
