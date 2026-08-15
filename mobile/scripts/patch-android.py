#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
manifest = root / "android/app/src/main/AndroidManifest.xml"
text = manifest.read_text(encoding="utf-8")

permissions = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.READ_CONTACTS" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
]
for perm in permissions:
    if perm not in text:
        text = text.replace("</manifest>", f"  {perm}\n</manifest>")

if 'android:usesCleartextTraffic="true"' not in text:
    text = text.replace(
        "<application",
        '<application\n        android:usesCleartextTraffic="true"',
        1,
    )

manifest.write_text(text, encoding="utf-8")
print("AndroidManifest.xml patched")
