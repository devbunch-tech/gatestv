package br.com.gatestv.app;

import android.content.Context;
import android.media.AudioFocusRequest;
import android.media.AudioManager;

/**
 * GATES Narração: AudioManager entregue ao WebView (via NarrApp). O Chromium pede o foco de áudio
 * "total" (AUDIOFOCUS_GAIN) quando a live começa a tocar, o que faz o app do jogo pausar; e, quando o
 * jogo começa, o Chromium perde o foco e pausa a narração. Aqui os pedidos do Chromium são só
 * anotados (respondemos "concedido" sem pedir ao sistema); quem pede o foco de verdade é o
 * MainActivity (narrDuck: o outro app só abaixa o volume). O resto funciona como o AudioManager normal.
 * Compilado contra android/stubs (o construtor com Context é escondido no SDK).
 */
public class NarrAudioManager extends AudioManager {
    /** O WebView está tocando mídia com som (pediu o foco e ainda não devolveu). */
    static volatile boolean webPlaying = false;
    /** O WebView já passou por aqui (prova de que o desvio funcionou neste aparelho). */
    static volatile boolean used = false;
    /** Avisado (na thread do Chromium, a principal) quando webPlaying muda. */
    static volatile Runnable onChange;

    public NarrAudioManager(Context base) {
        super(base);
    }

    private static int set(boolean playing) {
        if (!used) android.util.Log.i("GatesNarr", "WebView usando o AudioManager da Narração (foco de áudio desviado)");
        used = true;
        if (webPlaying != playing) {
            webPlaying = playing;
            Runnable r = onChange;
            if (r != null) r.run();
        }
        return AUDIOFOCUS_REQUEST_GRANTED;
    }

    @Override
    public int requestAudioFocus(AudioFocusRequest focusRequest) {
        return set(true);
    }

    @Override
    public int abandonAudioFocusRequest(AudioFocusRequest focusRequest) {
        return set(false);
    }

    // WebView antigo (Android 7 e anteriores).
    @Override
    public int requestAudioFocus(OnAudioFocusChangeListener l, int streamType, int durationHint) {
        return set(true);
    }

    @Override
    public int abandonAudioFocus(OnAudioFocusChangeListener l) {
        return set(false);
    }
}
