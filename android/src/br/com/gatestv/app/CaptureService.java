package br.com.gatestv.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Captura da própria tela (MediaProjection) para a página ler o relógio do placar no vídeo do jogo
 * e na janelinha da narração. Serviço em primeiro plano porque o Android 10+ exige um com o tipo
 * "mediaProjection" ativo antes de pegar a projeção. Um só VirtualDisplay + ImageReader por
 * autorização (regra do Android 14): ao girar a tela, só troca o ImageReader e redimensiona.
 * Guarda apenas o último quadro; o JPEG só é feito quando a página pede (frame()).
 */
public class CaptureService extends Service {
    static final String EXTRA_CODE = "captureCode";
    static final String EXTRA_DATA = "captureData";
    private static final String CHANNEL = "captura";
    private static final int NOTIF_ID = 7301;
    private static final int MAX_W = 1920; // a janelinha da narração é pequena: resolução cheia da TV para a IA ler o relógio
    // FLAG_IMMUTABLE (API 23+), obrigatório a partir do Android 12.
    private static final int IMMUTABLE = Build.VERSION.SDK_INT >= 23 ? 0x04000000 : 0;

    /** Resultado do início (ok/erro) e fim da captura pelo sistema; chamado na thread da captura. */
    interface Listener {
        void onCapture(boolean ok, String error);
    }

    static volatile Listener listener;
    private static volatile CaptureService instance;

    private final Object lock = new Object();
    private HandlerThread thread;
    private Handler handler;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private Image latest; // último quadro entregue pelo ImageReader (fechado ao chegar o próximo)
    private int screenW, screenH, capW, capH;
    private Bitmap buf; // reaproveitado entre os quadros
    private boolean stopping = false;
    private DisplayManager.DisplayListener rotation;

    // ---------------------------------------------------------------- uso pela activity

    static boolean active() {
        CaptureService s = instance;
        return s != null && s.display != null;
    }

    static void start(Context ctx, int resultCode, Intent data) {
        Intent i = new Intent(ctx, CaptureService.class).putExtra(EXTRA_CODE, resultCode).putExtra(EXTRA_DATA, data);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void stop(Context ctx) {
        CaptureService s = instance;
        if (s != null) s.release(null);
        else ctx.stopService(new Intent(ctx, CaptureService.class));
    }

    /** Último quadro em JPEG (base64 sem prefixo); size = {w, h, screenW, screenH}. null se não houver. */
    static String frame(int[] size) {
        CaptureService s = instance;
        return s == null ? null : s.encode(size);
    }

    // ---------------------------------------------------------------- serviço

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Primeiro o serviço em primeiro plano (com o tipo no Android 10+), depois a projeção.
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(NOTIF_ID, notification());
        } catch (Exception e) {
            fail(String.valueOf(e.getMessage()));
            return START_NOT_STICKY;
        }
        Intent data = intent == null ? null : (Intent) intent.getParcelableExtra(EXTRA_DATA);
        int code = intent == null ? 0 : intent.getIntExtra(EXTRA_CODE, 0);
        if (data == null || projection != null) {
            // Reiniciado sem autorização (ou já capturando): não fica rodando à toa.
            if (projection == null) fail("unavailable");
            else notifyListener(true, null);
            return START_NOT_STICKY;
        }
        instance = this;
        stopping = false;
        thread = new HandlerThread("gates-capture");
        thread.start();
        handler = new Handler(thread.getLooper());
        try {
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            projection = mpm == null ? null : mpm.getMediaProjection(code, data);
            if (projection == null) {
                fail("unavailable");
                return START_NOT_STICKY;
            }
            // Android 14: o callback precisa estar registrado antes do createVirtualDisplay.
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    release("stopped");
                }
            }, handler);
            measure();
            reader = newReader();
            display = projection.createVirtualDisplay("gates-capture", capW, capH, dpi(),
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, handler);
            watchRotation();
            notifyListener(true, null);
        } catch (Exception e) {
            fail(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        // Encerrado por fora (a página e a activity tiram o listener antes de parar): avisa a página.
        release("stopped");
        super.onDestroy();
    }

    private void fail(String error) {
        release(null);
        notifyListener(false, error);
    }

    private static void notifyListener(boolean ok, String error) {
        Listener l = listener;
        if (l != null) l.onCapture(ok, error);
    }

    /** Para tudo (projeção, tela virtual, leitor, thread e o serviço). error != null avisa a página. */
    private void release(String error) {
        synchronized (lock) {
            if (stopping) return;
            stopping = true;
            if (rotation != null) {
                try {
                    ((DisplayManager) getSystemService(Context.DISPLAY_SERVICE)).unregisterDisplayListener(rotation);
                } catch (Exception ignored) {
                }
                rotation = null;
            }
            if (latest != null) latest.close();
            latest = null;
            if (display != null) display.release();
            display = null;
            if (reader != null) reader.close();
            reader = null;
            MediaProjection p = projection;
            projection = null;
            if (p != null) {
                try {
                    p.stop();
                } catch (Exception ignored) {
                }
            }
            if (buf != null) buf.recycle();
            buf = null;
            if (thread != null) thread.quitSafely();
            thread = null;
            if (instance == this) instance = null;
        }
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {
        }
        stopSelf();
        if (error != null) notifyListener(false, error);
    }

    // ---------------------------------------------------------------- tamanho da captura

    @SuppressWarnings("deprecation")
    private Display screen() {
        return ((WindowManager) getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay();
    }

    // Tela real (com as barras) reduzida para no máximo 1920 px de largura, mantendo a proporção.
    private void measure() {
        DisplayMetrics m = new DisplayMetrics();
        screen().getRealMetrics(m);
        screenW = Math.max(1, m.widthPixels);
        screenH = Math.max(1, m.heightPixels);
        float k = Math.min(1f, MAX_W / (float) screenW);
        capW = Math.max(2, Math.round(screenW * k) & ~1);
        capH = Math.max(2, Math.round(screenH * k) & ~1);
    }

    private int dpi() {
        DisplayMetrics m = new DisplayMetrics();
        screen().getRealMetrics(m);
        return Math.max(1, Math.round(m.densityDpi * capW / (float) screenW));
    }

    private ImageReader newReader() {
        // 3 imagens: uma guardada (latest), uma chegando e uma livre para o sistema desenhar.
        final ImageReader r = ImageReader.newInstance(capW, capH, PixelFormat.RGBA_8888, 3);
        r.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
            @Override
            public void onImageAvailable(ImageReader ir) {
                synchronized (lock) {
                    if (ir != reader) return;
                    Image img;
                    try {
                        img = ir.acquireLatestImage();
                    } catch (Exception e) {
                        return; // todas as imagens em uso: espera o próximo aviso
                    }
                    if (img == null) return;
                    if (latest != null) latest.close();
                    latest = img;
                }
            }
        }, handler);
        return r;
    }

    // Celular/tablet girou: novo ImageReader no tamanho novo, no mesmo VirtualDisplay (resize).
    private void watchRotation() {
        rotation = new DisplayManager.DisplayListener() {
            @Override
            public void onDisplayChanged(int id) {
                if (id != Display.DEFAULT_DISPLAY) return;
                synchronized (lock) {
                    if (display == null) return;
                    int ow = screenW, oh = screenH;
                    measure();
                    if (ow == screenW && oh == screenH) return;
                    ImageReader old = reader;
                    reader = newReader();
                    display.setSurface(reader.getSurface());
                    display.resize(capW, capH, dpi());
                    if (latest != null) latest.close();
                    latest = null;
                    if (old != null) old.close();
                }
            }

            @Override
            public void onDisplayAdded(int id) {
            }

            @Override
            public void onDisplayRemoved(int id) {
            }
        };
        ((DisplayManager) getSystemService(Context.DISPLAY_SERVICE)).registerDisplayListener(rotation, handler);
    }

    // ---------------------------------------------------------------- quadro -> JPEG

    private String encode(int[] size) {
        // Tudo no lock: o release() não pode reciclar o bitmap no meio da compressão.
        synchronized (lock) {
            if (latest == null) return null;
            Bitmap out = null;
            try {
                Image.Plane p = latest.getPlanes()[0];
                int w = latest.getWidth(), h = latest.getHeight();
                int px = p.getPixelStride(), row = p.getRowStride();
                // A linha pode ter sobra (rowStride > w * 4): o bitmap tem a largura da linha e é cortado.
                int bw = row / px;
                if (buf == null || buf.getWidth() != bw || buf.getHeight() != h) {
                    if (buf != null) buf.recycle();
                    buf = Bitmap.createBitmap(bw, h, Bitmap.Config.ARGB_8888);
                }
                ByteBuffer b = p.getBuffer();
                b.rewind();
                buf.copyPixelsFromBuffer(b);
                out = bw == w ? buf : Bitmap.createBitmap(buf, 0, 0, w, h);
                if (w > MAX_W) {
                    Bitmap s = Bitmap.createScaledBitmap(out, MAX_W, Math.round(h * MAX_W / (float) w), true);
                    if (out != buf && s != out) out.recycle();
                    out = s;
                }
                ByteArrayOutputStream bytes = new ByteArrayOutputStream(128 * 1024);
                out.compress(Bitmap.CompressFormat.JPEG, 80, bytes);
                size[0] = out.getWidth();
                size[1] = out.getHeight();
                size[2] = screenW;
                size[3] = screenH;
                return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
            } catch (Throwable e) {
                return null; // inclui falta de memória: a página tenta de novo no próximo quadro
            } finally {
                if (out != null && out != buf) out.recycle();
            }
        }
    }

    // ---------------------------------------------------------------- notificação

    private Notification notification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Sincronia da narração", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Aviso enquanto o app lê o relógio do jogo na tela");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, NOTIF_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(getApplicationInfo().loadLabel(getPackageManager()))
                .setContentText("GATES! TV está lendo o relógio do jogo para sincronizar a narração")
                .setContentIntent(tap)
                .setOngoing(true);
        return b.build();
    }
}
