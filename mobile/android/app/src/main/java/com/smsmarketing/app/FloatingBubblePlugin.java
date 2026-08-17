package com.smsmarketing.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingBubble")
public class FloatingBubblePlugin extends Plugin {

    @PluginMethod
    public void canDrawOverlays(PluginCall call) {
        boolean granted = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            granted = Settings.canDrawOverlays(getContext());
        } else {
            granted = true;
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
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
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        FloatingBubbleService.requestStop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", FloatingBubbleService.isRunning());
        call.resolve(ret);
    }
}

