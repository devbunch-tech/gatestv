package br.com.gatestv.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Rational;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
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
    private String app = ""; // "narracao" no GATES Narração (meta-data "gates.app")
    private boolean lite = false;
    private boolean playerMode = false;
    private boolean landscapeLocked = true;
    private String installToken; // chave de ativação gravada no APK pelo link de download
    private String pendingReminder; // canal do lembrete tocado na notificação (a página abre ele)
    private boolean askedNotify = false;

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
        pendingReminder = getIntent() == null ? null : getIntent().getStringExtra(ReminderReceiver.EXTRA_CHANNEL);
        if (isTv()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else if (Build.VERSION.SDK_INT >= 21) {
            getWindow().setStatusBarColor(Color.parseColor("#121214"));
            getWindow().setNavigationBarColor(Color.parseColor("#121214"));
        }

        // Atualização automática da interface: aplica a versão já baixada antes de abrir o app.
        if (otaEnabled()) {
            OtaUpdater.applyPending(this);
            LocalServer.webDir = OtaUpdater.activeDir(this, getAssets());
        }
        LocalServer.imgDir = new java.io.File(getFilesDir(), "img");
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

            // Chave da captura da tela só na página do app (evaluateJavascript roda no quadro
            // principal): o iframe do YouTube também enxerga a ponte, mas não consegue ler a chave.
            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("http://127.0.0.1:")) view.evaluateJavascript("window.__gatesCapKey='" + capKey + "';", null);
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
        web.loadUrl("http://127.0.0.1:" + port + (isNarr() ? "/narracao.html" : "/") + (isTv() ? "?tv=1" : "?device=" + device)
                + (edition.isEmpty() ? "" : "&edition=" + edition) + (lite ? "&lite=1" : ""));
        if (otaEnabled()) startOtaCheck();
        if (isNarr()) narrSetup();
    }

    private void readFlavor() {
        try {
            ApplicationInfo ai = getPackageManager().getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA);
            if (ai.metaData != null) {
                device = ai.metaData.getString("gates.device", "tv");
                port = ai.metaData.getInt("gates.port", 47123);
                edition = ai.metaData.getString("gates.edition", "");
                app = ai.metaData.getString("gates.app", "");
                lite = ai.metaData.getBoolean("gates.lite", false);
                otaUrl = ai.metaData.getString("gates.ota", "");
                otaKey = ai.metaData.getString("gates.otaKey", "");
            }
        } catch (Exception ignored) {
        }
    }

    private boolean isTv() {
        return "tv".equals(device);
    }

    private boolean isNarr() {
        return "narracao".equals(app);
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
        // Tecla de busca / microfone do controle: busca por voz.
        int code = event.getKeyCode();
        if ((code == KeyEvent.KEYCODE_SEARCH || code == KeyEvent.KEYCODE_VOICE_ASSIST) && web != null && voiceReady()) {
            if (event.getAction() == KeyEvent.ACTION_UP) startVoice();
            return true;
        }
        String key = KEYS.get(event.getKeyCode());
        if (key != null && web != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) sendKey("keydown", key, event.getRepeatCount() > 0);
            else if (event.getAction() == KeyEvent.ACTION_UP) sendKey("keyup", key, false);
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    // ---------------------------------------------------------------- busca por voz

    private static final int VOICE_REQUEST = 72;

    // Há reconhecedor de voz no aparelho (Google, Assistente da TV…)? Não precisa de permissão de microfone.
    private boolean voiceReady() {
        try {
            return !getPackageManager().queryIntentActivities(new Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0).isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    private void startVoice() {
        Intent i = new Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
        i.putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Fale o que você quer assistir");
        i.putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.addFlags(Intent.FLAG_ACTIVITY_NO_USER_ACTION); // não é "sair do app" (Narração: não abre a janela flutuante)
        try {
            startActivityForResult(i, VOICE_REQUEST);
        } catch (Exception e) {
            sendVoice(null, "Não foi possível abrir o reconhecimento de voz deste aparelho.");
        }
    }

    // O texto volta para a página no evento 'gates-voice' (src/lib/voice.js).
    private void sendVoice(String text, String error) {
        if (web == null) return;
        String detail = error != null ? "{error:" + org.json.JSONObject.quote(error) + "}" : "{text:" + org.json.JSONObject.quote(text) + "}";
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('gates-voice',{detail:" + detail + "}));", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CAPTURE_REQUEST) {
            captureResult(resultCode, data);
            return;
        }
        if (requestCode != VOICE_REQUEST) return;
        java.util.ArrayList<String> r = resultCode == RESULT_OK && data != null ? data.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS) : null;
        if (r != null && !r.isEmpty()) sendVoice(r.get(0), null);
        else if (resultCode == android.speech.RecognizerIntent.RESULT_NO_MATCH) sendVoice(null, "Não entendi. Fale de novo, perto do controle.");
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
        // GATES Narração: na janela flutuante (ou tocando só o áudio) a narração continua.
        if (web != null && !narrKeepPlaying()) web.onPause();
    }

    // App já aberto e o usuário tocou no aviso de um programa: a página abre o canal.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String ch = intent == null ? null : intent.getStringExtra(ReminderReceiver.EXTRA_CHANNEL);
        if (ch != null) pendingReminder = ch;
    }

    @Override
    protected void onResume() {
        super.onResume();
        stopped = false;
        narrBackground = false;
        if (web != null) web.onResume();
        // Voltou para o app: se uma atualização da interface terminou de baixar, já passa a usá-la.
        if (wentBackground && otaEnabled() && web != null) {
            if (OtaUpdater.applyPending(this)) {
                LocalServer.webDir = OtaUpdater.activeDir(this, getAssets());
                web.reload();
            }
            if (System.currentTimeMillis() - lastOtaCheck > 6 * 3600e3) startOtaCheck();
        }
        wentBackground = false;
    }

    @Override
    protected void onStop() {
        super.onStop();
        stopped = true;
        wentBackground = true;
        // GATES Narração: saiu do app sem janela flutuante (e sem o modo só áudio) = narração encerrada.
        // Fechar a janelinha chega em onPictureInPictureModeChanged (depois deste onStop).
        if (isNarr() && !inPip() && !narrBackground) narrClosed();
    }

    // ---------------------------------------------------------------- GATES Narração (janela flutuante)
    // A live do YouTube toca na janela flutuante (Picture-in-Picture) por cima do app do jogo, e o
    // jogo só abaixa o volume. Página: narracao.html (eventos 'gates-narr-pip' e 'gates-narr-action').

    // Apps de esporte/vídeo que aparecem primeiro na lista (versão de TV e de celular).
    private static final String[] NARR_KNOWN = {
            "com.globo.globotv", // Globoplay (Premiere, SporTV…)
            "com.globo.globosatplay", // Canais Globo
            "com.amazon.amazonvideo.livingroom", "com.amazon.avod.thirdpartyclient", // Prime Video
            "com.disney.disneyplus", // Disney+ (ESPN)
            "com.wbd.stream", "com.hbo.hbonow", // Max / HBO Max
            "com.cbs.ott", "com.cbs.app", // Paramount+
            "com.dazn", // DAZN
            "com.google.android.youtube.tv", "com.google.android.youtube", // YouTube (CazéTV)
            "com.netflix.ninja", "com.netflix.mediaclient", // Netflix
            "com.apple.atve.androidtv.appletv", // Apple TV
            "tv.pluto.android", // Pluto TV
    };
    // Fora da lista: o nome do app decide (CazéTV, Premiere, ESPN…).
    private static final String[] NARR_WORDS = { "cazé", "caze", "premiere", "globo", "sportv", "espn", "dazn", "combate", "esporte", "sport", "futebol", "nba", "ufc" };
    private static final String NARR_ACTION = ".NARR_ACTION";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private org.json.JSONArray narrActions = new org.json.JSONArray();
    private boolean stopped = false;
    private boolean narrBackground = false; // abriu outro app sem janela flutuante: segue só o áudio
    private boolean narrDuckWanted = false;
    private Object narrFocus; // AudioFocusRequest (Android 8+)
    private final long[] narrRetries = new long[4];
    private BroadcastReceiver narrReceiver;

    private void narrSetup() {
        // O WebView começou/parou de tocar (NarrAudioManager): liga/desliga a entrada automática na janela.
        NarrAudioManager.onChange = new Runnable() {
            @Override
            public void run() {
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (narrDuckWanted && NarrAudioManager.webPlaying) narrRequestFocus();
                        narrUpdateParams();
                    }
                });
            }
        };
        if (!narrPipSupported()) return;
        // Botões da janela flutuante (RemoteAction) -> página.
        narrReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                String id = i.getStringExtra("id");
                if (id != null) narrEvent("gates-narr-action", "{id:" + org.json.JSONObject.quote(id) + "}");
            }
        };
        IntentFilter f = new IntentFilter(getPackageName() + NARR_ACTION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(narrReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(narrReceiver, f);
        narrUpdateParams();
    }

    private boolean narrPipSupported() {
        return isNarr() && Build.VERSION.SDK_INT >= 26
                && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private boolean inPip() {
        return Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode();
    }

    // Há narração tocando: o WebView está com som ou a página pediu para o outro app abaixar o volume.
    private boolean narrPlaying() {
        return NarrAudioManager.webPlaying || narrDuckWanted;
    }

    // Não pausar a página ao sair da tela: janela flutuante, modo só áudio ou entrada automática armada.
    private boolean narrKeepPlaying() {
        return isNarr() && (inPip() || narrBackground
                || (Build.VERSION.SDK_INT >= 31 && narrPlaying() && narrPipSupported()));
    }

    private void narrEvent(String name, String detail) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('" + name + "',{detail:" + detail + "}));", null);
    }

    private Icon narrIcon(String name) {
        String n = name.replaceAll("[^a-z]", "");
        int own = n.isEmpty() ? 0 : getResources().getIdentifier("narr_" + n, "drawable", getPackageName());
        if (own != 0) return Icon.createWithResource(this, own);
        int sys = "pause".equals(n) ? android.R.drawable.ic_media_pause
                : "plus".equals(n) ? android.R.drawable.ic_media_ff
                : "minus".equals(n) ? android.R.drawable.ic_media_rew
                : android.R.drawable.ic_media_play;
        return Icon.createWithResource("android", sys);
    }

    // Janela 16:9 com os botões atuais; no Android 12+ entra sozinha ao apertar Home se houver narração.
    private PictureInPictureParams narrParams() {
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9));
        List<RemoteAction> list = new ArrayList<>();
        int max = getMaxNumPictureInPictureActions();
        for (int i = 0; i < narrActions.length() && list.size() < max; i++) {
            org.json.JSONObject a = narrActions.optJSONObject(i);
            String id = a == null ? "" : a.optString("id", "");
            if (id.isEmpty()) continue;
            String title = a.optString("title", id);
            Intent it = new Intent(getPackageName() + NARR_ACTION).setPackage(getPackageName()).putExtra("id", id);
            PendingIntent pi = PendingIntent.getBroadcast(this, 100 + i, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            list.add(new RemoteAction(narrIcon(a.optString("icon", "")), title, title, pi));
        }
        b.setActions(list);
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(narrPlaying()).setSeamlessResizeEnabled(false);
        return b.build();
    }

    private void narrUpdateParams() {
        if (!narrPipSupported()) return;
        try {
            setPictureInPictureParams(narrParams());
        } catch (Exception ignored) {
        }
    }

    private boolean narrEnterPip() {
        if (!narrPipSupported()) return false;
        if (inPip()) return true;
        try {
            return enterPictureInPictureMode(narrParams());
        } catch (Exception e) {
            return false;
        }
    }

    // Abre o app do jogo com a narração na janela flutuante (sem ela, a narração segue só no áudio).
    private void narrLaunch(final Intent open) {
        Runnable start = new Runnable() {
            @Override
            public void run() {
                try {
                    startActivity(open);
                } catch (Exception ignored) {
                }
            }
        };
        if (narrEnterPip()) ui.postDelayed(start, 400); // dá tempo de a janela flutuante se ajeitar
        else {
            narrBackground = true;
            start.run();
        }
    }

    // Janelinha fechada (ou saiu do app sem ela): devolve o foco de áudio e pausa a página.
    private void narrClosed() {
        narrBackground = false;
        narrSetDuck(false);
        if (web != null) web.onPause();
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Home ou outro app com a narração tocando: vai para a janela flutuante.
        if (isNarr() && narrPlaying() && !inPip()) narrEnterPip();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean on, Configuration cfg) {
        super.onPictureInPictureModeChanged(on, cfg);
        if (!isNarr()) return;
        // Ao fechar a janelinha, o onStop vem antes (ainda em modo janela); ao expandir, não.
        boolean closed = !on && stopped;
        narrEvent("gates-narr-pip", "{on:" + on + (closed ? ",closed:true" : "") + "}");
        if (closed) narrClosed();
        else if (on && web != null) web.onResume();
    }

    // ---------- foco de áudio: o outro app abaixa o volume (AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) ----------

    // O AudioManager da activity é o do sistema (o do NarrApp é só para o WebView).
    private AudioManager narrAudio() {
        return (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    }

    private final AudioManager.OnAudioFocusChangeListener narrFocusListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override
        public void onAudioFocusChange(int change) {
            // O app do jogo pediu o foco total (começou a tocar): pede de novo, para ele voltar a abaixar.
            if (change == AudioManager.AUDIOFOCUS_LOSS && narrDuckWanted && narrRetryOk()) {
                ui.removeCallbacks(narrRetry);
                ui.postDelayed(narrRetry, 1500);
            }
        }
    };

    private final Runnable narrRetry = new Runnable() {
        @Override
        public void run() {
            if (narrDuckWanted) narrRequestFocus();
        }
    };

    // No máximo 4 novos pedidos por minuto (evita uma disputa sem fim com um app que pede o foco de volta).
    private boolean narrRetryOk() {
        long now = System.currentTimeMillis();
        int recent = 0;
        for (long t : narrRetries) if (now - t < 60000) recent++;
        if (recent >= narrRetries.length) return false;
        System.arraycopy(narrRetries, 1, narrRetries, 0, narrRetries.length - 1);
        narrRetries[narrRetries.length - 1] = now;
        return true;
    }

    private void narrSetDuck(boolean on) {
        narrDuckWanted = on;
        if (on) narrRequestFocus();
        else narrAbandonFocus();
        narrUpdateParams();
    }

    private void narrRequestFocus() {
        // Só depois que o WebView passou pelo NarrAudioManager: se ele tiver o foco de verdade
        // (desvio indisponível), este pedido faria a própria narração abaixar.
        if (!NarrAudioManager.used) return;
        AudioManager am = narrAudio();
        if (am == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                // Fala, sem pedir pausa: o sistema abaixa o volume do outro app sozinho. "Pausa quando
                // abaixado" = nunca abaixam/silenciam a narração quando o jogo pega o foco (Android 12+).
                if (narrFocus == null) narrFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build())
                        .setWillPauseWhenDucked(true)
                        .setOnAudioFocusChangeListener(narrFocusListener, ui)
                        .build();
                am.requestAudioFocus((AudioFocusRequest) narrFocus);
            } else {
                am.requestAudioFocus(narrFocusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        } catch (Exception ignored) {
        }
    }

    private void narrAbandonFocus() {
        ui.removeCallbacks(narrRetry);
        AudioManager am = narrAudio();
        if (am == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                if (narrFocus != null) am.abandonAudioFocusRequest((AudioFocusRequest) narrFocus);
            } else {
                am.abandonAudioFocus(narrFocusListener);
            }
        } catch (Exception ignored) {
        }
    }

    // Apps do launcher da TV (e do celular), com os de esporte/vídeo primeiro; sem o próprio app.
    private String narrAppsJson() {
        final PackageManager pm = getPackageManager();
        final Map<String, String> labels = new LinkedHashMap<>();
        for (String cat : new String[] { Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER }) {
            List<ResolveInfo> found;
            try {
                found = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(cat), 0);
            } catch (Exception e) {
                continue;
            }
            for (ResolveInfo ri : found) {
                String pkg = ri.activityInfo.packageName;
                if (pkg.equals(getPackageName()) || labels.containsKey(pkg)) continue;
                CharSequence label = ri.activityInfo.applicationInfo.loadLabel(pm);
                labels.put(pkg, label == null ? pkg : label.toString().trim());
            }
        }
        List<String> order = new ArrayList<>(labels.keySet());
        final java.text.Collator col = java.text.Collator.getInstance(new java.util.Locale("pt", "BR"));
        Collections.sort(order, new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                int ra = narrRank(a, labels.get(a)), rb = narrRank(b, labels.get(b));
                return ra != rb ? ra - rb : col.compare(labels.get(a), labels.get(b));
            }
        });
        org.json.JSONArray out = new org.json.JSONArray();
        for (String pkg : order) {
            try {
                out.put(new org.json.JSONObject().put("pkg", pkg).put("label", labels.get(pkg)));
            } catch (Exception ignored) {
            }
        }
        return out.toString();
    }

    private static int narrRank(String pkg, String label) {
        for (int i = 0; i < NARR_KNOWN.length; i++) if (NARR_KNOWN[i].equals(pkg)) return i;
        String l = label.toLowerCase(java.util.Locale.ROOT);
        for (String w : NARR_WORDS) if (l.contains(w)) return NARR_KNOWN.length;
        return NARR_KNOWN.length + 1;
    }

    // ---------------------------------------------------------------- captura da tela (CaptureService)
    // A página lê o relógio do placar no vídeo do jogo e na janelinha da narração (iframe do YouTube,
    // que ela não consegue ler) para sincronizar a narração. Autorização do sistema uma vez por sessão;
    // o resultado volta no evento 'gates-capture' ({ok:true} ou {ok:false, error}).

    private static final int CAPTURE_REQUEST = 73;
    private boolean capturePending = false; // pedido de autorização aberto
    private volatile boolean captureWanted = false; // false: a página parou antes de o usuário responder
    private volatile String captureInfo; // JSON do último quadro entregue (captureFrameInfo)
    // Chave aleatória por abertura do app, entregue só à página (onPageFinished).
    private final String capKey = java.util.UUID.randomUUID().toString().replace("-", "");

    @SuppressWarnings("deprecation")
    private Intent captureIntent() {
        if (Build.VERSION.SDK_INT < 21) return null;
        android.media.projection.MediaProjectionManager mpm =
                (android.media.projection.MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null) return null;
        Intent i = null;
        // Android 14+: tela inteira (sem a opção "um app só", que no Narração deixaria o jogo de fora).
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                i = mpm.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay());
            } catch (Throwable ignored) {
            }
        }
        return i != null ? i : mpm.createScreenCaptureIntent();
    }

    // Há a tela de autorização de captura? (algumas TVs não têm)
    private boolean captureReady() {
        try {
            Intent i = captureIntent();
            return i != null && i.resolveActivity(getPackageManager()) != null;
        } catch (Throwable e) {
            return false;
        }
    }

    private void captureEvent(boolean ok, String error) {
        if (web == null) return;
        String detail = ok ? "{ok:true}" : "{ok:false,error:" + org.json.JSONObject.quote(error == null ? "unavailable" : error) + "}";
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('gates-capture',{detail:" + detail + "}));", null);
    }

    private void captureStartUi() {
        if (CaptureService.active()) {
            captureEvent(true, null);
            return;
        }
        captureWanted = true;
        if (capturePending) return;
        // O serviço avisa (em outra thread) se começou, falhou ou se o sistema encerrou a captura.
        CaptureService.listener = new CaptureService.Listener() {
            @Override
            public void onCapture(final boolean ok, final String error) {
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (!ok) captureInfo = null;
                        captureEvent(ok, error);
                    }
                });
            }
        };
        Intent i = captureReady() ? captureIntent() : null;
        if (i == null) {
            captureEvent(false, "unavailable");
            return;
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NO_USER_ACTION); // não é "sair do app" (Narração: não abre a janela flutuante)
        try {
            capturePending = true;
            startActivityForResult(i, CAPTURE_REQUEST);
        } catch (Exception e) {
            capturePending = false;
            captureEvent(false, "unavailable");
        }
    }

    private void captureResult(final int resultCode, final Intent data) {
        capturePending = false;
        if (!captureWanted) return;
        if (resultCode != RESULT_OK || data == null) {
            captureEvent(false, "denied");
            return;
        }
        // Depois do onResume: o serviço em primeiro plano tem de ser iniciado com o app visível.
        ui.post(new Runnable() {
            @Override
            public void run() {
                try {
                    CaptureService.start(MainActivity.this, resultCode, data);
                } catch (Exception e) {
                    captureEvent(false, e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                }
            }
        });
    }

    private void captureStopAll() {
        captureWanted = false;
        CaptureService.listener = null;
        captureInfo = null;
        try {
            CaptureService.stop(getApplicationContext());
        } catch (Exception ignored) {
        }
    }

    // Onde a WebView está na tela (px) e a escala CSS -> px; lido na thread de UI (até 300 ms).
    private org.json.JSONObject webGeometry() {
        final org.json.JSONObject g = new org.json.JSONObject();
        final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        Runnable read = new Runnable() {
            @Override
            @SuppressWarnings("deprecation")
            public void run() {
                try {
                    if (web != null) {
                        int[] loc = new int[2];
                        web.getLocationOnScreen(loc);
                        float density = getResources().getDisplayMetrics().density;
                        float scale = web.getScale();
                        g.put("webX", loc[0]).put("webY", loc[1]).put("webW", web.getWidth()).put("webH", web.getHeight())
                                .put("dpr", scale > 0 ? scale : density).put("density", density).put("pip", inPip());
                    }
                } catch (Exception ignored) {
                }
                done.countDown();
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) read.run();
        else {
            ui.post(read);
            try {
                if (!done.await(300, java.util.concurrent.TimeUnit.MILLISECONDS)) return new org.json.JSONObject();
            } catch (InterruptedException ignored) {
            }
        }
        return g;
    }

    // ---------------------------------------------------------------- atualização automática

    private String otaUrl = "";
    private String otaKey = "";
    private boolean wentBackground = false;
    private long lastOtaCheck = 0;

    private boolean otaEnabled() {
        return !otaUrl.isEmpty() && !otaKey.isEmpty();
    }

    private void startOtaCheck() {
        lastOtaCheck = System.currentTimeMillis();
        OtaUpdater.checkAsync(getApplicationContext(), getAssets(), otaUrl, otaKey);
    }

    private CastClient castClient;

    private synchronized CastClient cast() {
        if (castClient == null) castClient = new CastClient(getApplicationContext());
        return castClient;
    }

    // Smart TVs (DLNA). Os aparelhos DLNA têm id começando com "dlna:"; a transmissão ativa decide
    // para quem vão pausar/avançar/parar.
    private DlnaClient dlnaClient;
    private volatile boolean usingDlna = false;

    private synchronized DlnaClient dlna() {
        if (dlnaClient == null) dlnaClient = new DlnaClient(getApplicationContext());
        return dlnaClient;
    }

    // Abre o espelhamento de tela do Android (Smart View na Samsung; "Transmitir" nos demais).
    private boolean openMirror() {
        Intent smartView = getPackageManager().getLaunchIntentForPackage("com.samsung.android.smartmirroring");
        Intent[] tries = {
                smartView,
                new Intent("android.settings.CAST_SETTINGS"),
                new Intent("android.settings.WIFI_DISPLAY_SETTINGS"),
        };
        for (Intent i : tries) {
            if (i == null) continue;
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    @Override
    protected void onDestroy() {
        captureStopAll();
        if (isNarr()) {
            narrAbandonFocus();
            NarrAudioManager.onChange = null;
            if (narrReceiver != null) {
                try {
                    unregisterReceiver(narrReceiver);
                } catch (Exception ignored) {
                }
            }
        }
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
            dlna().startDiscovery();
        }

        @JavascriptInterface
        public String castDevices() {
            try {
                org.json.JSONArray all = new org.json.JSONArray(cast().devicesJson());
                org.json.JSONArray tvs = dlna().devices();
                for (int i = 0; i < tvs.length(); i++) all.put(tvs.get(i));
                return all.toString();
            } catch (Exception e) {
                return cast().devicesJson();
            }
        }

        /** media (JSON): {url, contentType, title, image, live, start} */
        @JavascriptInterface
        public void castStart(String deviceId, String media) {
            try {
                org.json.JSONObject m = new org.json.JSONObject(media);
                if (deviceId != null && deviceId.startsWith(DlnaClient.PREFIX)) {
                    if (!usingDlna) cast().stop();
                    usingDlna = true;
                    dlna().cast(deviceId, m);
                } else {
                    if (usingDlna) dlna().stop();
                    usingDlna = false;
                    cast().cast(deviceId, m);
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String castStatus() {
            return usingDlna ? dlna().statusJson() : cast().statusJson();
        }

        @JavascriptInterface
        public void castPause() {
            if (usingDlna) dlna().togglePause();
            else cast().togglePause();
        }

        @JavascriptInterface
        public void castSeek(double to) {
            if (usingDlna) dlna().seek(to);
            else cast().seek(to);
        }

        @JavascriptInterface
        public void castStop() {
            if (usingDlna) dlna().stop();
            else cast().stop();
        }

        /** Este APK guarda imagens no aparelho (rota /img do servidor local). */
        @JavascriptInterface
        public boolean imageCache() {
            return true;
        }

        /** Espelhar a tela (Smart View / Transmitir do Android). false = o aparelho não tem atalho. */
        @JavascriptInterface
        public boolean mirrorScreen() {
            return openMirror();
        }

        // ---------- Busca por voz (o texto volta no evento 'gates-voice') ----------
        @JavascriptInterface
        public boolean voiceAvailable() {
            return voiceReady();
        }

        @JavascriptInterface
        public void voiceSearch() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    startVoice();
                }
            });
        }

        // ---------- Captura da tela (relógio do placar; resultado no evento 'gates-capture') ----------
        @JavascriptInterface
        public boolean captureAvailable() {
            return captureReady();
        }

        @JavascriptInterface
        public void captureStart() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    captureStartUi();
                }
            });
        }

        /** JPEG (qualidade 80, até 1280 px de largura) em base64 sem prefixo; "" se não houver quadro. */
        @JavascriptInterface
        public String captureFrame(String key) {
            if (key == null || !key.equals(capKey)) return ""; // só a página do app (ver onPageFinished)
            int[] size = new int[4];
            String jpeg = CaptureService.frame(size);
            if (jpeg == null) return "";
            org.json.JSONObject info = webGeometry();
            try {
                info.put("w", size[0]).put("h", size[1]).put("screenW", size[2]).put("screenH", size[3]);
            } catch (Exception ignored) {
            }
            captureInfo = info.toString();
            return jpeg;
        }

        /**
         * {w, h, screenW, screenH, webX, webY, webW, webH, dpr, density, pip} do último quadro entregue.
         * Pixel do quadro = (webX + cssX * dpr) * w / screenW (idem y com webY, h e screenH).
         */
        @JavascriptInterface
        public String captureFrameInfo() {
            String last = captureInfo;
            if (last != null) return last;
            org.json.JSONObject info = webGeometry();
            try {
                android.util.DisplayMetrics m = new android.util.DisplayMetrics();
                getWindowManager().getDefaultDisplay().getRealMetrics(m);
                info.put("w", 0).put("h", 0).put("screenW", m.widthPixels).put("screenH", m.heightPixels);
            } catch (Exception ignored) {
            }
            return info.toString();
        }

        @JavascriptInterface
        public void captureStop() {
            captureStopAll();
        }

        @JavascriptInterface
        public boolean captureActive() {
            return CaptureService.active();
        }

        // ---------- Lembretes de programas favoritos (ReminderReceiver) ----------
        @JavascriptInterface
        public void scheduleReminder(String key, double at, String title, String text, String channel) {
            if (key == null || at < System.currentTimeMillis()) return;
            ReminderReceiver.schedule(MainActivity.this, key, (long) at, title, text, channel);
            // Android 13+: pede a permissão de notificação (uma vez por abertura do app).
            if (Build.VERSION.SDK_INT >= 33 && !askedNotify
                    && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                askedNotify = true;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 71);
                    }
                });
            }
        }

        @JavascriptInterface
        public void cancelReminder(String key) {
            if (key != null) ReminderReceiver.cancel(MainActivity.this, key);
        }

        // Canal do aviso que abriu o app (uma vez só; vazio se não veio de um aviso).
        @JavascriptInterface
        public String takeReminder() {
            String ch = pendingReminder;
            pendingReminder = null;
            return ch == null ? "" : ch;
        }

        // Tela "Procurar atualizações": situação, verificar agora e aplicar a versão baixada.
        @JavascriptInterface
        public String otaInfo() {
            return OtaUpdater.status(getApplicationContext(), getAssets(), otaEnabled());
        }

        @JavascriptInterface
        public boolean otaCheck() {
            if (!otaEnabled()) return false;
            startOtaCheck();
            return true;
        }

        @JavascriptInterface
        public void otaApply() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (otaEnabled() && OtaUpdater.applyPending(MainActivity.this)) {
                        LocalServer.webDir = OtaUpdater.activeDir(MainActivity.this, getAssets());
                        web.reload();
                    }
                }
            });
        }

        // ---------- GATES Narração (nos outros apps não fazem nada) ----------
        /** [{pkg, label}] dos apps do launcher, os de esporte/vídeo primeiro. */
        @JavascriptInterface
        public String narrApps() {
            return isNarr() ? narrAppsJson() : "[]";
        }

        /** Entra na janela flutuante e abre o app. false = app não encontrado. */
        @JavascriptInterface
        public boolean narrOpenApp(String pkg) {
            if (!isNarr() || pkg == null || pkg.isEmpty()) return false;
            PackageManager pm = getPackageManager();
            Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (i == null) i = pm.getLaunchIntentForPackage(pkg);
            if (i == null) return false;
            final Intent open = i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    narrLaunch(open);
                }
            });
            return true;
        }

        @JavascriptInterface
        public boolean narrPipSupported() {
            return MainActivity.this.narrPipSupported();
        }

        @JavascriptInterface
        public void narrPip() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    narrEnterPip();
                }
            });
        }

        /** [{id, title, icon: 'plus'|'minus'|'pause'|'play'}]; o toque volta no evento 'gates-narr-action'. */
        @JavascriptInterface
        public void narrPipActions(String json) {
            if (!isNarr()) return;
            final org.json.JSONArray list;
            try {
                list = new org.json.JSONArray(json == null ? "[]" : json);
            } catch (Exception e) {
                return;
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    narrActions = list;
                    narrUpdateParams();
                }
            });
        }

        /** true: o outro app abaixa o volume enquanto a narração toca; false: devolve o foco. */
        @JavascriptInterface
        public void narrDuck(final boolean on) {
            if (!isNarr()) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    narrSetDuck(on);
                }
            });
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
