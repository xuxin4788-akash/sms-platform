package com.smsmarketing.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int REQ_AUDIO = 3101;

    // Held while the WebView asks for the microphone before the native runtime
    // permission has been granted; granted once onRequestPermissionsResult runs.
    private PermissionRequest pendingWebRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FloatingBubblePlugin.class);
        super.onCreate(savedInstanceState);
        ensureAudioPermission();
        bridge.getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean needsAudio = false;
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                        needsAudio = true;
                        break;
                    }
                }
                if (!needsAudio) {
                    super.onPermissionRequest(request);
                    return;
                }
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                } else {
                    pendingWebRequest = request;
                    ensureAudioPermission();
                }
            }
        });
        FloatingBubbleService.startIfEnabled(getApplicationContext());
    }

    private void ensureAudioPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.RECORD_AUDIO }, REQ_AUDIO);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_AUDIO && pendingWebRequest != null) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                pendingWebRequest.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            } else {
                pendingWebRequest.deny();
            }
            pendingWebRequest = null;
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        FloatingBubbleService.startIfEnabled(getApplicationContext());
    }
}
