package com.smsmarketing.app;

import android.animation.ValueAnimator;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.ImageView;

import androidx.core.app.NotificationCompat;

public class FloatingBubbleService extends Service {

    private static final String CHANNEL_ID = "sms_bubble_channel";
    private static final int NOTIF_ID = 4242;
    private static final String PREFS = "sms_bubble_prefs";
    private static final String KEY_X = "bubble_x";
    private static final String KEY_Y = "bubble_y";
    private static final String KEY_ENABLED = "bubble_enabled";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_USER_STOPPED = "bubble_user_stopped";
    private static final int CLICK_SLOP_PX = 12;       // 小于该位移视为点击
    private static final int LONG_PRESS_MS = 500;      // 长按阈值
    private static final int BUBBLE_SIZE_DP = 56;
    private static final int MARGIN_DP = 8;

    private static volatile boolean running = false;
    private static volatile FloatingBubbleService instance;

    private WindowManager windowManager;
    private ImageView bubbleView;
    private WindowManager.LayoutParams bubbleParams;
    private String serverUrl;
    private int initialX, initialY;
    private float initialTouchX, initialTouchY;
    private long touchStart;
    private boolean hasMoved;
    private boolean longPressFired;
    private int screenWidth, screenHeight;
    private int bubbleSizePx, marginPx;
    private SharedPreferences prefs;
    private final Runnable longPressRunnable = new Runnable() {
        @Override
        public void run() {
            if (!hasMoved) {
                longPressFired = true;
                vibrateShort();
                showLongPressMenu();
            }
        }
    };

    public static void requestStop(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        sp.edit().putBoolean(KEY_USER_STOPPED, true).putBoolean(KEY_ENABLED, false).apply();
        ctx.stopService(new Intent(ctx, FloatingBubbleService.class));
    }

    public static boolean isRunning() {
        return running;
    }

    public static boolean isEnabled(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        return sp.getBoolean(KEY_ENABLED, false) && !sp.getBoolean(KEY_USER_STOPPED, false);
    }

    public static String getServerUrl(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        return sp.getString(KEY_SERVER_URL, "");
    }

    public static void startIfEnabled(Context ctx) {
        if (!isEnabled(ctx)) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
            return;
        }
        Intent intent = new Intent(ctx, FloatingBubbleService.class);
        String url = getServerUrl(ctx);
        if (url != null && !url.isEmpty()) intent.putExtra("serverUrl", url);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        bubbleSizePx = dp(BUBBLE_SIZE_DP);
        marginPx = dp(MARGIN_DP);
        if (windowManager != null) {
            screenWidth = windowManager.getDefaultDisplay().getWidth();
            screenHeight = windowManager.getDefaultDisplay().getHeight();
        } else {
            screenWidth = 1080;
            screenHeight = 1920;
        }
        createNotificationChannel();
        startForeground(NOTIF_ID, buildNotification());
        running = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getStringExtra("serverUrl") != null) {
            serverUrl = intent.getStringExtra("serverUrl");
            prefs.edit()
                .putBoolean(KEY_ENABLED, true)
                .putBoolean(KEY_USER_STOPPED, false)
                .putString(KEY_SERVER_URL, serverUrl)
                .apply();
        } else {
            serverUrl = prefs.getString(KEY_SERVER_URL, serverUrl);
        }
        if (bubbleView == null) {
            showBubble();
        }
        return START_STICKY;
    }

    private void showBubble() {
        bubbleView = new ImageView(this);
        bubbleView.setBackgroundResource(R.drawable.bubble_bg);
        bubbleView.setImageResource(android.R.drawable.ic_dialog_email);
        int pad = dp(14);
        bubbleView.setPadding(pad, pad, pad, pad);
        bubbleView.setContentDescription("SMS Marketing quick send");

        int type;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            type = WindowManager.LayoutParams.TYPE_PHONE;
        }
        bubbleParams = new WindowManager.LayoutParams(
            bubbleSizePx, bubbleSizePx,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        );
        bubbleParams.gravity = Gravity.TOP | Gravity.START;

        // Restore last position, default to right edge vertically centered.
        int savedX = prefs.getInt(KEY_X, -1);
        int savedY = prefs.getInt(KEY_Y, -1);
        if (savedX >= 0 && savedY >= 0) {
            bubbleParams.x = clampX(savedX);
            bubbleParams.y = clampY(savedY);
        } else {
            bubbleParams.x = screenWidth - bubbleSizePx - marginPx;
            bubbleParams.y = screenHeight / 2;
        }

        bubbleView.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    initialX = bubbleParams.x;
                    initialY = bubbleParams.y;
                    initialTouchX = event.getRawX();
                    initialTouchY = event.getRawY();
                    touchStart = System.currentTimeMillis();
                    hasMoved = false;
                    longPressFired = false;
                    v.setAlpha(0.85f);
                    v.removeCallbacks(longPressRunnable);
                    v.postDelayed(longPressRunnable, LONG_PRESS_MS);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = event.getRawX() - initialTouchX;
                    float dy = event.getRawY() - initialTouchY;
                    if (Math.abs(dx) > CLICK_SLOP_PX || Math.abs(dy) > CLICK_SLOP_PX) {
                        hasMoved = true;
                        v.removeCallbacks(longPressRunnable);
                    }
                    bubbleParams.x = clampX(initialX + (int) dx);
                    bubbleParams.y = clampY(initialY + (int) dy);
                    try {
                        windowManager.updateViewLayout(bubbleView, bubbleParams);
                    } catch (Exception ignore) {}
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    v.setAlpha(1f);
                    v.removeCallbacks(longPressRunnable);
                    long dt = System.currentTimeMillis() - touchStart;
                    if (longPressFired) {
                        // Menu already shown; do nothing.
                        return true;
                    }
                    if (!hasMoved && dt < 400) {
                        openPanel();
                    } else {
                        snapToEdge();
                    }
                    return true;
            }
            return false;
        });

        windowManager.addView(bubbleView, bubbleParams);

        // Animate in.
        bubbleView.setScaleX(0.4f);
        bubbleView.setScaleY(0.4f);
        bubbleView.animate().scaleX(1f).scaleY(1f).setDuration(220)
            .setInterpolator(new DecelerateInterpolator()).start();
    }

    private void snapToEdge() {
        if (bubbleView == null || bubbleParams == null) return;
        int currentX = bubbleParams.x;
        int targetX;
        if (currentX + bubbleSizePx / 2 < screenWidth / 2) {
            targetX = marginPx;
        } else {
            targetX = screenWidth - bubbleSizePx - marginPx;
        }
        ValueAnimator anim = ValueAnimator.ofInt(currentX, targetX);
        anim.setDuration(220);
        anim.setInterpolator(new DecelerateInterpolator());
        anim.addUpdateListener(a -> {
            if (bubbleView == null || bubbleParams == null || windowManager == null) return;
            bubbleParams.x = (int) a.getAnimatedValue();
            try {
                windowManager.updateViewLayout(bubbleView, bubbleParams);
            } catch (Exception ignore) {}
        });
        anim.start();
        prefs.edit().putInt(KEY_X, targetX).putInt(KEY_Y, bubbleParams.y).apply();
    }

    private void showLongPressMenu() {
        try {
            new AlertDialog.Builder(this)
                .setTitle("SMS Marketing")
                .setItems(new CharSequence[]{"Abrir panel", "Detener burbuja"}, (d, which) -> {
                    if (which == 0) openPanel();
                    else stopSelf();
                })
                .setOnCancelListener(d -> {})
                .show();
        } catch (Exception ignore) {}
    }

    private void openPanel() {
        try {
            Intent intent = new Intent(this, QuickSendPanelActivity.class);
            if (serverUrl != null) intent.putExtra("serverUrl", serverUrl);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            // If panel cannot be shown (no host), open main activity instead.
            try {
                Intent main = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (main != null) {
                    main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(main);
                }
            } catch (Exception ignore) {}
        }
    }

    private void vibrateShort() {
        try {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(25, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(25);
            }
        } catch (Exception ignore) {}
    }

    private int clampX(int x) {
        return Math.max(marginPx, Math.min(x, screenWidth - bubbleSizePx - marginPx));
    }

    private int clampY(int y) {
        int statusBar = dp(24);
        int navBar = dp(48);
        return Math.max(statusBar, Math.min(y, screenHeight - bubbleSizePx - navBar));
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    public void onDestroy() {
        running = false;
        instance = null;
        if (bubbleView != null) {
            bubbleView.removeCallbacks(longPressRunnable);
            bubbleView.animate().cancel();
        }
        if (bubbleView != null && windowManager != null) {
            try { windowManager.removeView(bubbleView); } catch (Exception ignore) {}
            bubbleView = null;
        }
        super.onDestroy();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "SMS Bubble", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Floating quick-SMS bubble");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(this, 0, openIntent, flags);

        Intent stopIntent = new Intent(this, StopBubbleReceiver.class);
        int stopFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            stopFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent stopPi = PendingIntent.getBroadcast(this, 1, stopIntent, stopFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("SMS Marketing")
            .setContentText("Burbuja de envío rápido activa")
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Detener", stopPi)
            .build();
    }
}
