package com.smsmarketing.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FloatingBubblePlugin.class);
        super.onCreate(savedInstanceState);
        FloatingBubbleService.startIfEnabled(getApplicationContext());
    }

    @Override
    public void onResume() {
        super.onResume();
        FloatingBubbleService.startIfEnabled(getApplicationContext());
    }
}
