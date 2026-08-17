package com.smsmarketing.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingBubble")
public class FloatingBubblePlugin extends Plugin {

    private static final int REQ_OVERLAY = 4001;
    private static final int REQ_NOTIF = 4002;
    private PluginCall pendingCall;

    @PluginMethod
    public void echo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", call.getString("value", "pong"));
        ret.put("plugin", "FloatingBubble");
        ret.put("package", getContext().getPackageName());
        call.resolve(ret);
    }

    @PluginMethod
    public void canDrawOverlays(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("package", getContext().getPackageName());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext())) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        pendingCall = call;
        saveCall(call);
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivityForResult(call, intent, REQ_OVERLAY);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + ctx.getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void requestAllPermissions(PluginCall call) {
        boolean overlayGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || Settings.canDrawOverlays(getContext());
        boolean notifGranted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifGranted = ContextCompat.checkSelfPermission(getContext(),
                Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }

        JSObject ret = new JSObject();
        ret.put("overlayGranted", overlayGranted);
        ret.put("notificationsGranted", notifGranted);

        if (!notifGranted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pendingCall = call;
            saveCall(call);
            ActivityCompat.requestPermissions(getActivity(),
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
            return;
        }
        if (!overlayGranted) {
            pendingCall = call;
            saveCall(call);
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivityForResult(call, intent, REQ_OVERLAY);
                return;
            } catch (Exception ignore) {}
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                call.resolve();
                return;
            }
        } catch (Exception ignore) {}
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception ignore) {}
        call.resolve();
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) ignoring = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(getContext())) {
            call.reject("OVERLAY_PERMISSION_DENIED");
            return;
        }
        String serverUrl = call.getString("url", "");
        Intent intent = new Intent(getContext(), FloatingBubbleService.class);
        intent.putExtra("serverUrl", serverUrl);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        FloatingBubbleService.requestStop(getContext());
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", FloatingBubbleService.isRunning());
        call.resolve(ret);
    }

    @PluginMethod
    public void diagnose(PluginCall call) {
        JSObject ret = new JSObject();
        Context ctx = getContext();
        ret.put("package", ctx.getPackageName());
        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("overlayGranted", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx));
        ret.put("serviceRunning", FloatingBubbleService.isRunning());
        boolean notifGranted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifGranted = ContextCompat.checkSelfPermission(ctx,
                Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        ret.put("notificationsGranted", notifGranted);
        boolean ignoringBattery = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) ignoringBattery = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        }
        ret.put("ignoringBattery", ignoringBattery);
        ret.put("serverUrl", FloatingBubbleService.getServerUrl(ctx));
        call.resolve(ret);
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OVERLAY) {
            PluginCall call = getSavedCall();
            if (call != null) {
                boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                    || Settings.canDrawOverlays(getContext());
                JSObject ret = new JSObject();
                ret.put("granted", granted);
                call.resolve(ret);
            }
        }
    }

    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIF) {
            PluginCall call = getSavedCall();
            boolean overlayGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(getContext());
            if (!overlayGranted) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivityForResult(call, intent, REQ_OVERLAY);
                    return;
                } catch (Exception ignore) {}
            }
            if (call != null) {
                JSObject ret = new JSObject();
                ret.put("overlayGranted", overlayGranted);
                ret.put("notificationsGranted", grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED);
                call.resolve(ret);
            }
        }
    }
}
