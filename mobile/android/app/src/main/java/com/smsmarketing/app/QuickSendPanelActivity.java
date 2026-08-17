package com.smsmarketing.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class QuickSendPanelActivity extends Activity {

    public static final String EXTRA_SERVER_URL = "serverUrl";
    private static final int OVERLAY_TYPE =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : android.view.WindowManager.LayoutParams.TYPE_PHONE;

    private WebView webView;
    private ProgressBar progress;
    private LinearLayout errorView;
    private String serverUrl;
    private String panelUrl;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        // Progress bar (top 8 px).
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(3)
        ));
        progress.setMax(100);
        root.addView(progress);

        // Error view (initially hidden).
        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(android.view.Gravity.CENTER);
        errorView.setPadding(dp(24), dp(24), dp(24), dp(24));
        errorView.setVisibility(View.GONE);
        TextView errTitle = new TextView(this);
        errTitle.setText("No se pudo cargar el panel");
        errTitle.setTextSize(18);
        errTitle.setTextColor(Color.parseColor("#1E293B"));
        TextView errMsg = new TextView(this);
        errMsg.setText("Verifica tu conexión a internet e inténtalo de nuevo.");
        errMsg.setTextSize(14);
        errMsg.setTextColor(Color.parseColor("#64748B"));
        errMsg.setPadding(0, dp(8), 0, dp(24));
        Button retry = new Button(this);
        retry.setText("Reintentar");
        retry.setOnClickListener(v -> loadPanel());
        errorView.addView(errTitle);
        errorView.addView(errMsg);
        errorView.addView(retry);
        FrameLayout.LayoutParams ep = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ep.gravity = android.view.Gravity.CENTER;
        root.addView(errorView, ep);

        // WebView.
        webView = new WebView(this);
        FrameLayout.LayoutParams wp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        wp.topMargin = dp(3);
        webView.setLayoutParams(wp);
        // Use isolated process to avoid leaking the Activity on some OEM ROMs.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WebView.setDataDirectorySuffix("bubble");
        }

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " SMSBubble/1.1");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                // If the page redirected to login (no valid session), open main app.
                if (url != null && url.contains("#/login")) {
                    launchMainAppForLogin();
                    finish();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    showError();
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void closePanel() {
                runOnUiThread(() -> finish());
            }

            @android.webkit.JavascriptInterface
            public void stopBubble() {
                FloatingBubbleService.requestStop(QuickSendPanelActivity.this);
                runOnUiThread(() -> finish());
            }

            @android.webkit.JavascriptInterface
            public void sendCompleted() {
                // Close panel shortly after a successful send so the bubble stays ready.
                runOnUiThread(() -> {
                    if (webView != null) webView.postDelayed(() -> finish(), 600);
                });
            }
        }, "AndroidBubble");

        serverUrl = getIntent().getStringExtra(EXTRA_SERVER_URL);
        if (serverUrl == null || serverUrl.isEmpty()) {
            serverUrl = "https://c47a8aad-7b15-4c7c-b011-033ea50b71af.dev.coze.site";
        }
        serverUrl = serverUrl.replaceAll("/+$", "");

        root.addView(webView);
        setContentView(root);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#2563EB"));
        }

        loadPanel();
    }

    private void loadPanel() {
        if (!isNetworkAvailable()) {
            showError();
            return;
        }
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE);
        panelUrl = serverUrl + "/#/quick-send-embed?ts=" + System.currentTimeMillis();
        webView.loadUrl(panelUrl);
    }

    private void showError() {
        progress.setVisibility(View.GONE);
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    private boolean isNetworkAvailable() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            NetworkInfo info = cm.getActiveNetworkInfo();
            return info != null && info.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    private void launchMainAppForLogin() {
        try {
            Intent main = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (main != null) {
                main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                startActivity(main);
            }
        } catch (Exception ignore) {}
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.removeJavascriptInterface("AndroidBubble");
            webView.loadUrl("about:blank");
            webView.clearHistory();
            ((ViewGroup) webView.getParent()).removeView(webView);
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}
