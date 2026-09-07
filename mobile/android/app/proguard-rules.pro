# Keep line numbers for crash reports
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*,Signature,Exceptions,InnerClasses,EnclosingMethod

# Capacitor: WebView <-> native bridge must not be obfuscated.
-keep class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# Capacitor plugins (JS calls plugins by class name).
-keep class com.capacitorjs.** { *; }
-keep @com.getcapacitor.Plugin public class *
-keep class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class *
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
    @android.webkit.JavascriptInterface <methods>;
}

# WebView local server used by bundled/server.loaded web assets
-keep class com.getcapacitor.WebViewLocalServer { *; }
-keep class com.getcapacitor.CapacitorWebChromeClient { *; }

# Bridge config / generated configuration
-keep class com.smsmarketing.app.** { *; }
