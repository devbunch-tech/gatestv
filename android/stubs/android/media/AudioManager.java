package android.media;

import android.content.Context;

/**
 * Só para compilar (não vai no APK): o android.jar esconde o construtor AudioManager(Context),
 * que existe no aparelho. Usado por android/src-hidden (NarrAudioManager).
 */
public class AudioManager {
    public static final int AUDIOFOCUS_REQUEST_GRANTED = 1;

    public AudioManager(Context context) {
    }

    public int requestAudioFocus(AudioFocusRequest focusRequest) {
        return 0;
    }

    public int abandonAudioFocusRequest(AudioFocusRequest focusRequest) {
        return 0;
    }

    public int requestAudioFocus(OnAudioFocusChangeListener l, int streamType, int durationHint) {
        return 0;
    }

    public int abandonAudioFocus(OnAudioFocusChangeListener l) {
        return 0;
    }

    public interface OnAudioFocusChangeListener {
        void onAudioFocusChange(int focusChange);
    }
}
