#!/usr/bin/env python3
from pathlib import Path
import json
import sys
import os

root = Path(__file__).resolve().parents[1]
manifest = root / "android/app/src/main/AndroidManifest.xml"
cap_config = root / "capacitor.config.json"

# Determine cleartext from configured server URL (http only).
cleartext = True
try:
    cfg = json.loads(cap_config.read_text(encoding="utf-8"))
    url = (cfg.get("server", {}) or {}).get("url", "")
    cleartext = url.startswith("http://")
except Exception:
    pass

text = manifest.read_text(encoding="utf-8")

permissions = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.READ_CONTACTS" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
]
for perm in permissions:
    if perm not in text:
        text = text.replace("</manifest>", f"  {perm}\n</manifest>")

if cleartext:
    if 'android:usesCleartextTraffic="true"' not in text:
        text = text.replace(
            "<application",
            '<application\n        android:usesCleartextTraffic="true"',
            1,
        )
else:
    # Production HTTPS: ensure cleartext is not enabled.
    text = text.replace('android:usesCleartextTraffic="true"\n', '')
    text = text.replace('android:usesCleartextTraffic="true"', '')

manifest.write_text(text, encoding="utf-8")
print(f"AndroidManifest.xml patched (cleartext={cleartext})")
