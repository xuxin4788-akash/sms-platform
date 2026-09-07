#!/usr/bin/env bash
# Build the signed production release APK.
#
# Prereqs: JDK 17 + Android SDK (ANDROID_HOME), pnpm deps installed,
# and a release keystore configured via EITHER:
#   - mobile/android/keystore.properties  (storeFile/storePassword/keyAlias/keyPassword)
#   - OR env vars KEYSTORE_FILE / KEYSTORE_STORE_PASSWORD / KEYSTORE_ALIAS / KEYSTORE_KEY_PASSWORD
#
# Usage:
#   SMS_SERVER_URL="https://pagoserve.com" bash scripts/build-release.sh
set -euo pipefail

cd "$(dirname "$0")/.."

export SMS_SERVER_URL="${SMS_SERVER_URL:-https://pagoserve.com}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/build-tools/34.0.0:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

echo "==> Target server: $SMS_SERVER_URL"
echo "==> Installing deps"
pnpm install

echo "==> Writing Capacitor config + syncing web assets"
node scripts/write-capacitor-config.js
node scripts/sync-web.js

echo "==> cap sync android"
pnpm exec cap sync android

echo "==> Patching manifest"
python3 scripts/patch-android.py

echo "==> Building signed release APK"
( cd android && ./gradlew assembleRelease --no-daemon )

APK="android/app/build/outputs/apk/release/app-release.apk"
echo ""
echo "==> Done: $APK"
ls -lh "$APK"
echo "==> Verify signature:"
"$ANDROID_HOME/build-tools/34.0.0/apksigner" verify --verbose "$APK" | grep -iE "verified using v1|verified using v2" || true
