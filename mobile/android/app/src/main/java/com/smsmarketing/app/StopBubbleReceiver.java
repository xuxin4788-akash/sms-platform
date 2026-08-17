package com.smsmarketing.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class StopBubbleReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        FloatingBubbleService.requestStop(context);
    }
}
