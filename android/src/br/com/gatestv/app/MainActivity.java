package br.com.gatestv.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.HashMap;
import java.util.Map;

/**
 * GATES! TV para Android: sobe o servidor local (app + proxy + verificação de canais)
 * e exibe o app num WebView. A mesma base gera três APKs (TV, celular e tablet); o tipo vem
 * do AndroidManifest (meta-data "gates.device") e muda a tela inicial, a orientação e as barras.
 */
public class MainActivity extends Activity {
    // Porta fixa por versão: login, perfis e listas ficam salvos no endereço do app.
    private int port = 47123;
    private String device = "tv";
    private String edition = "";
    private boolean lite = false;
    private boolean playerMode = false;
    private boolean landscapeLocked = true;
    private String installToken; // chave de ativação gravada no APK pelo link de download

    private WebView web;

    // Teclas que o WebView não repassa (ou repassa sem nome) para a página.
    private static final Map<Integer, String> KEYS = new HashMap<>();
    static {
        KEYS.put(KeyEvent.KEYCODE_CHANNEL_UP, "ChannelUp");
        KEYS.put(KeyEvent.KEYCODE_CHANNEL_DOWN, "ChannelDown");
        KEYS.put(KeyEvent.KEYCODE_PAGE_UP, "ChannelUp");
        KEYS.put(KeyEvent.KEYCODE_PAGE_DOWN, "ChannelDown");
        KEYS.put(KeyEvent.KEYCODE_INFO, "Info");
        KEYS.put(KeyEvent.KEYCODE_GUIDE, "Info");
        KEYS.put(KeyEvent.KEYCODE_MENU, "ContextMenu");
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, "MediaPlayPause");
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PLAY, "MediaPlay");
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PAUSE, "MediaPause");
        KEYS.put(KeyEvent.KEYCODE_MEDIA_STOP, "MediaStop");
        KEYS.put(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, "MediaFastForward");
        KEYS.put(KeyEvent.KEYCODE_MEDIA_REWIND, "MediaRewind");
        KEYS.put(KeyEvent.KEYCODE_MEDIA_NEXT, "MediaTrackNext");
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PREVIOUS, "MediaTrackPrevious");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        readFlavor();
        if (isTv()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else if (Build.VERSION.SDK_INT >= 21) {
            getWindow().setStatusBarColor(Color.parseColor("#121214"));
            getWindow().setNavigationBarColor(Color.parseColor("#121214"));
        }

        try {
            LocalServer.start(getAssets(), port);
        } catch (Exception e) {
            // Porta em uso: outra instância do servidor já está atendendo.
        }

        if (Build.VERSION.SDK_INT >= 19) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#121214"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " GatesTV-Android");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternal(request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternal(url);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // Sem o "botão de play" cinza que o WebView mostra antes do vídeo carregar.
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        web.addJavascriptInterface(new Bridge(), "GatesAndroid");

        setContentView(web);
        if (isTv()) hideSystemUi();
        web.requestFocus();
        web.loadUrl("http://127.0.0.1:" + port + (isTv() ? "/?tv=1" : "/?device=" + device)
                + (edition.isEmpty() ? "" : "&edition=" + edition) + (lite ? "&lite=1" : ""));
    }

    private void readFlavor() {
        try {
            ApplicationInfo ai = getPackageManager().getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA);
            if (ai.metaData != null) {
                device = ai.metaData.getString("gates.device", "tv");
                port = ai.metaData.getInt("gates.port", 47123);
                edition = ai.metaData.getString("gates.edition", "");
                lite = ai.metaData.getBoolean("gates.lite", false);
            }
        } catch (Exception ignored) {
        }
    }

    private boolean isTv() {
        return "tv".equals(device);
    }

    // Player aberto (celular/tablet): esconde as barras, mantém a tela acesa e gira para a horizontal.
    private void applyPlayerMode(boolean on) {
        playerMode = on;
        if (isTv()) return;
        if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            hideSystemUi();
            landscapeLocked = true;
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            setRequestedOrientation("phone".equals(device)
                    ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                    : ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
        }
    }

    private boolean openExternal(String url) {
        if (url.startsWith("http://127.0.0.1:" + port)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
        return true;
    }

    private void hideSystemUi() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private void sendKey(String type, String key, boolean repeat) {
        String js = "window.dispatchEvent(new KeyboardEvent('" + type + "',{key:'" + key + "',repeat:" + repeat + ",bubbles:true}));";
        web.evaluateJavascript(js, null);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String key = KEYS.get(event.getKeyCode());
        if (key != null && web != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) sendKey("keydown", key, event.getRepeatCount() > 0);
            else if (event.getAction() == KeyEvent.ACTION_UP) sendKey("keyup", key, false);
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    // "Voltar" vai para o app web (fecha painéis, sai do player, volta de tela).
    // Na tela inicial, o app chama GatesAndroid.exit().
    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        sendKey("keydown", "GoBack", false);
        sendKey("keyup", "GoBack", false);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && web != null && (isTv() || playerMode)) hideSystemUi();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    private CastClient castClient;

    private synchronized CastClient cast() {
        if (castClient == null) castClient = new CastClient(getApplicationContext());
        return castClient;
    }

    @Override
    protected void onDestroy() {
        if (castClient != null) castClient.stopDiscovery();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Ponte JavaScript -> Android. */
    public class Bridge {
        @JavascriptInterface
        public String device() {
            return device;
        }

        // Identificação estável do aparelho: continua a mesma depois de desinstalar e instalar de novo
        // (Android 8+: ANDROID_ID é próprio deste app neste aparelho). Vai só o resumo SHA-256.
        @JavascriptInterface
        public String stableId() {
            try {
                String a = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
                if (a == null || a.isEmpty() || "9774d56d682e549c".equals(a)) return "";
                byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(("gates:" + a).getBytes("UTF-8"));
                StringBuilder sb = new StringBuilder("a");
                for (int i = 0; i < 16; i++) sb.append(String.format("%02x", h[i]));
                return sb.toString();
            } catch (Exception e) {
                return "";
            }
        }

        // Chave de ativação do download (vazia se o APK veio de outro lugar).
        @JavascriptInterface
        public String installToken() {
            if (installToken == null) installToken = InstallTag.read(getApplicationInfo().sourceDir);
            return installToken;
        }

        @JavascriptInterface
        public void setPlayerMode(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyPlayerMode(on);
                }
            });
        }

        // Links externos (loja para renovar a assinatura, IMDb…) abrem no navegador.
        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openExternal(url);
                }
            });
        }

        // Botão "girar" do player: alterna entre horizontal e vertical.
        @JavascriptInterface
        public void toggleOrientation() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    landscapeLocked = !landscapeLocked;
                    setRequestedOrientation(landscapeLocked
                            ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                            : ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                }
            });
        }

        // ---------- Transmitir para Chromecast / Google TV (CastClient) ----------
        @JavascriptInterface
        public void castDiscover() {
            cast().startDiscovery();
        }

        @JavascriptInterface
        public String castDevices() {
            return cast().devicesJson();
        }

        /** media (JSON): {url, contentType, title, image, live, start} */
        @JavascriptInterface
        public void castStart(String deviceId, String media) {
            try {
                cast().cast(deviceId, new org.json.JSONObject(media));
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String castStatus() {
            return cast().statusJson();
        }

        @JavascriptInterface
        public void castPause() {
            cast().togglePause();
        }

        @JavascriptInterface
        public void castSeek(double to) {
            cast().seek(to);
        }

        @JavascriptInterface
        public void castStop() {
            cast().stop();
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    moveTaskToBack(true);
                }
            });
        }
    }
}
