package br.com.gatestv.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Lembretes de programas de TV favoritos: o app agenda um alarme do sistema para 5 min antes do
 * programa; na hora, este receptor mostra a notificação (mesmo com o app fechado). Tocar nela abre
 * o app já no canal (extra "reminderChannel", lido pela página com GatesAndroid.takeReminder()).
 */
public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL = "lembretes";
    static final String EXTRA_CHANNEL = "reminderChannel";
    // FLAG_IMMUTABLE (API 23+), obrigatório a partir do Android 12.
    private static final int IMMUTABLE = Build.VERSION.SDK_INT >= 23 ? 0x04000000 : 0;

    private static PendingIntent alarmIntent(Context ctx, String key, String title, String text, String channel) {
        Intent i = new Intent(ctx, ReminderReceiver.class);
        i.setAction("br.com.gatestv.REMINDER." + key);
        if (title != null) {
            i.putExtra("title", title);
            i.putExtra("text", text);
            i.putExtra(EXTRA_CHANNEL, channel);
        }
        return PendingIntent.getBroadcast(ctx, key.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | IMMUTABLE);
    }

    static void schedule(Context ctx, String key, long at, String title, String text, String channel) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = alarmIntent(ctx, key, title, text, channel);
        if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.set(AlarmManager.RTC_WAKEUP, at, pi);
    }

    static void cancel(Context ctx, String key) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(ctx, key, null, null, null));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String title = intent.getStringExtra("title");
        if (title == null) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Lembretes de programas", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Aviso 5 minutos antes dos programas de TV favoritos");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(EXTRA_CHANNEL, intent.getStringExtra(EXTRA_CHANNEL));
        String key = intent.getAction() == null ? title : intent.getAction();
        PendingIntent tap = PendingIntent.getActivity(ctx, key.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(intent.getStringExtra("text"))
                .setContentIntent(tap)
                .setAutoCancel(true);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        try {
            nm.notify(key.hashCode(), b.build());
        } catch (SecurityException e) {
            // Sem permissão de notificação (Android 13+): o aviso aparece só com o app aberto.
        }
    }
}
