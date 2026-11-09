package br.com.gatestv.app;

import android.content.Context;
import android.net.wifi.WifiManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Transmissão para Smart TVs por DLNA/UPnP (Samsung, LG, TCL, Philips, Sony, Hisense…), sem bibliotecas:
 * procura TVs na rede (SSDP), lê a descrição de cada uma e manda o endereço do vídeo pelo serviço
 * AVTransport. A TV busca o vídeo direto do servidor — o celular fica livre.
 * Mesmo formato de estado do CastClient (idle | connecting | loading | playing | paused | buffering | error).
 */
public class DlnaClient {
    public static final String PREFIX = "dlna:";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String AVT = "urn:schemas-upnp-org:service:AVTransport:1";
    private static final Pattern HEADER = Pattern.compile("(?im)^location:\\s*(\\S+)");

    private final Context ctx;
    private final Map<String, JSONObject> devices = new LinkedHashMap<String, JSONObject>();
    private final Set<String> seenLocations = new HashSet<String>();
    private volatile boolean searching = false;

    // Sessão atual
    private volatile String control; // controlURL do AVTransport da TV
    private volatile String state = "idle";
    private volatile String deviceName = "";
    private volatile String error = "";
    private volatile double currentTime = 0;
    private volatile double duration = 0;
    private volatile int session = 0;

    public DlnaClient(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    // ---------- Descoberta (SSDP) ----------
    public void startDiscovery() {
        if (searching) return;
        searching = true;
        new Thread(new Runnable() {
            public void run() {
                WifiManager.MulticastLock lock = null;
                DatagramSocket sock = null;
                try {
                    WifiManager wifi = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
                    if (wifi != null) {
                        lock = wifi.createMulticastLock("gates-dlna");
                        lock.setReferenceCounted(false);
                        lock.acquire();
                    }
                    sock = new DatagramSocket();
                    sock.setSoTimeout(1000);
                    InetAddress group = InetAddress.getByName("239.255.255.250");
                    String[] targets = { AVT, "urn:schemas-upnp-org:device:MediaRenderer:1" };
                    long end = System.currentTimeMillis() + 7000;
                    int round = 0;
                    byte[] buf = new byte[4096];
                    while (System.currentTimeMillis() < end) {
                        if (round < 3) {
                            for (String st : targets) {
                                byte[] msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\n\r\n").getBytes(UTF8);
                                sock.send(new DatagramPacket(msg, msg.length, group, 1900));
                            }
                            round++;
                        }
                        try {
                            DatagramPacket p = new DatagramPacket(buf, buf.length);
                            sock.receive(p);
                            Matcher m = HEADER.matcher(new String(p.getData(), 0, p.getLength(), UTF8));
                            if (m.find()) describe(m.group(1).trim());
                        } catch (SocketTimeoutException ignored) {
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    if (sock != null) sock.close();
                    if (lock != null) try { lock.release(); } catch (Exception ignored) { }
                    searching = false;
                }
            }
        }).start();
    }

    // Lê a descrição da TV (nome, modelo e o endereço de controle do AVTransport).
    private void describe(final String location) {
        synchronized (this) {
            if (!seenLocations.add(location)) return;
        }
        new Thread(new Runnable() {
            public void run() {
                try {
                    String xml = http("GET", location, null, null);
                    String block = null;
                    Matcher sm = Pattern.compile("(?is)<service>(.*?)</service>").matcher(xml);
                    while (sm.find()) if (sm.group(1).contains("AVTransport")) { block = sm.group(1); break; }
                    if (block == null) return;
                    String ctl = tag(block, "controlURL");
                    if (ctl.isEmpty()) return;
                    String base = tag(xml, "URLBase");
                    URL abs = new URL(new URL(base.isEmpty() ? location : base), ctl);
                    String name = unescape(tag(xml, "friendlyName"));
                    String model = unescape(tag(xml, "modelName"));
                    String udn = tag(xml, "UDN");
                    String id = PREFIX + (udn.isEmpty() ? location : udn);
                    JSONObject d = new JSONObject();
                    d.put("id", id);
                    d.put("name", name.isEmpty() ? "Smart TV" : name);
                    d.put("model", model);
                    d.put("kind", "dlna");
                    d.put("control", abs.toString());
                    synchronized (DlnaClient.this) { devices.put(id, d); }
                } catch (Exception e) {
                    synchronized (DlnaClient.this) { seenLocations.remove(location); }
                }
            }
        }).start();
    }

    public synchronized JSONArray devices() {
        JSONArray a = new JSONArray();
        for (JSONObject d : devices.values()) {
            JSONObject x = new JSONObject();
            try {
                x.put("id", d.optString("id"));
                x.put("name", d.optString("name"));
                x.put("model", d.optString("model"));
                x.put("kind", "dlna");
            } catch (Exception ignored) { }
            a.put(x);
        }
        return a;
    }

    // ---------- Sessão ----------
    /** media: {url, contentType, title, live, start} */
    public void cast(String deviceId, final JSONObject media) {
        final JSONObject d;
        synchronized (this) { d = devices.get(deviceId); }
        if (d == null) { fail("TV não encontrada na rede."); return; }
        final int my = ++session;
        control = d.optString("control");
        deviceName = d.optString("name");
        state = "connecting";
        error = "";
        currentTime = 0;
        duration = 0;
        new Thread(new Runnable() {
            public void run() {
                try {
                    try { soap("Stop", ""); } catch (Exception ignored) { } // algumas TVs só aceitam outro vídeo paradas
                    String url = media.getString("url");
                    String type = media.optString("contentType", "video/mp4");
                    soap("SetAVTransportURI", "<CurrentURI>" + esc(url) + "</CurrentURI><CurrentURIMetaData>" + esc(didl(media.optString("title"), url, type)) + "</CurrentURIMetaData>");
                    if (my != session) return;
                    state = "loading";
                    soap("Play", "<Speed>1</Speed>");
                    double start = media.optDouble("start", 0);
                    if (start > 0) {
                        Thread.sleep(2500);
                        try { soap("Seek", "<Unit>REL_TIME</Unit><Target>" + hms(start) + "</Target>"); } catch (Exception ignored) { }
                    }
                    poll(my);
                } catch (Exception e) {
                    if (my == session) fail("A " + deviceName + " não aceitou o vídeo.");
                }
            }
        }).start();
    }

    // Acompanha o estado da TV enquanto esta transmissão for a atual.
    private void poll(int my) throws Exception {
        long since = System.currentTimeMillis();
        boolean played = false;
        int errors = 0;
        while (my == session && !"error".equals(state) && !"idle".equals(state)) {
            Thread.sleep(1500);
            if (my != session) return;
            String ts;
            try {
                ts = tag(soap("GetTransportInfo", ""), "CurrentTransportState");
                errors = 0;
            } catch (Exception e) {
                if (++errors >= 4) { fail("A conexão com a " + deviceName + " caiu."); return; }
                continue;
            }
            if ("PLAYING".equals(ts)) { state = "playing"; played = true; }
            else if ("PAUSED_PLAYBACK".equals(ts)) state = "paused";
            else if ("TRANSITIONING".equals(ts)) state = played ? "buffering" : "loading";
            else if ("STOPPED".equals(ts) || "NO_MEDIA_PRESENT".equals(ts)) {
                if (played) { state = "idle"; return; }
                // Ainda não começou: algumas TVs ficam paradas um tempo antes de tocar.
                if (System.currentTimeMillis() - since > 25000) { fail("A " + deviceName + " não conseguiu tocar este conteúdo."); return; }
            }
            try {
                String pos = soap("GetPositionInfo", "");
                currentTime = secs(tag(pos, "RelTime"));
                double dur = secs(tag(pos, "TrackDuration"));
                if (dur > 0) duration = dur;
            } catch (Exception ignored) { }
        }
    }

    public void togglePause() {
        final String action = "playing".equals(state) || "buffering".equals(state) ? "Pause" : "Play";
        async(action, "Play".equals(action) ? "<Speed>1</Speed>" : "");
    }

    public void seek(double to) {
        async("Seek", "<Unit>REL_TIME</Unit><Target>" + hms(to) + "</Target>");
    }

    public void stop() {
        session++;
        state = "idle";
        async("Stop", "");
    }

    public boolean active() {
        return !"idle".equals(state) && !"error".equals(state);
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

    // ---------- UPnP ----------
    private void async(final String action, final String args) {
        if (control == null) return;
        new Thread(new Runnable() {
            public void run() {
                try { soap(action, args); } catch (Exception ignored) { }
            }
        }).start();
    }

    private String soap(String action, String args) throws Exception {
        String body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
                + "<u:" + action + " xmlns:u=\"" + AVT + "\"><InstanceID>0</InstanceID>" + args + "</u:" + action + ">"
                + "</s:Body></s:Envelope>";
        return http("POST", control, body, "\"" + AVT + "#" + action + "\"");
    }

    private static String http(String method, String url, String body, String soapAction) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(4000);
        c.setReadTimeout(6000);
        c.setRequestMethod(method);
        c.setRequestProperty("User-Agent", "GATES-TV/1.0 UPnP/1.0 DLNADOC/1.50");
        if (body != null) {
            byte[] b = body.getBytes(UTF8);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
            if (soapAction != null) c.setRequestProperty("SOAPAction", soapAction);
            c.setFixedLengthStreamingMode(b.length);
            OutputStream o = c.getOutputStream();
            o.write(b);
            o.close();
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (in != null) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < 512 * 1024) out.write(buf, 0, n);
            in.close();
        }
        c.disconnect();
        if (code >= 400) throw new Exception("HTTP " + code);
        return new String(out.toByteArray(), UTF8);
    }

    // Metadados DIDL-Lite: muitas TVs (Samsung/LG) recusam o vídeo sem eles.
    private static String didl(String title, String url, String type) {
        String mime = type.toLowerCase(Locale.ROOT).contains("mpegurl") ? "application/vnd.apple.mpegurl" : type;
        return "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
                + "<item id=\"0\" parentID=\"-1\" restricted=\"1\"><dc:title>" + esc(title.isEmpty() ? "GATES! TV" : title) + "</dc:title>"
                + "<upnp:class>object.item.videoItem</upnp:class>"
                + "<res protocolInfo=\"http-get:*:" + mime + ":*\">" + esc(url) + "</res></item></DIDL-Lite>";
    }

    private static String tag(String xml, String name) {
        Matcher m = Pattern.compile("(?is)<(?:\\w+:)?" + name + "(?:\\s[^>]*)?>(.*?)</(?:\\w+:)?" + name + ">").matcher(xml);
        return m.find() ? m.group(1).trim() : "";
    }

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String unescape(String s) {
        return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&");
    }

    private static String hms(double t) {
        long s = (long) Math.max(0, t);
        return String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60);
    }

    private static double secs(String hms) {
        try {
            String[] p = hms.split(":");
            if (p.length != 3) return 0;
            return Integer.parseInt(p[0]) * 3600 + Integer.parseInt(p[1]) * 60 + Double.parseDouble(p[2]);
        } catch (Exception e) {
            return 0;
        }
    }

    private void fail(String msg) {
        error = msg;
        state = "error";
    }
}
