package br.com.gatestv.app;

import android.app.Application;
import android.util.Log;

/**
 * Application do GATES Narração (só nesse APK). O WebView pega o AudioManager pelo contexto do
 * aplicativo; aqui ele recebe o NarrAudioManager, que não deixa o Chromium pedir o foco de áudio
 * total (veja NarrAudioManager). Se o aparelho não aceitar, tudo segue como num app normal.
 */
public class NarrApp extends Application {
    private NarrAudioManager audio;

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            audio = new NarrAudioManager(getBaseContext());
        } catch (Throwable t) {
            Log.w("GatesNarr", "AudioManager próprio indisponível; o WebView vai pedir o foco sozinho", t);
        }
    }

    /** O desvio do foco de áudio está ativo neste aparelho. */
    boolean audioHooked() {
        return audio != null;
    }

    @Override
    public Object getSystemService(String name) {
        if (audio != null && AUDIO_SERVICE.equals(name)) return audio;
        return super.getSystemService(name);
    }
}
