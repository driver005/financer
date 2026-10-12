#!/usr/bin/env bash
# Installs the APK on the running emulator, starts it, and waits for the FINANCER_SMOKE line.
set -uo pipefail
apk="$1"
adb install -r "$apk" || exit 1
pkg=$(aapt2 dump packagename "$apk" 2>/dev/null || true)
[ -n "$pkg" ] || pkg=$(sed -n 's/.*"package": *"\([^"]*\)".*/\1/p' apps/mobile/app.json | head -1)
adb logcat -c
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null
for _ in $(seq 1 90); do
  line=$(adb logcat -d | grep -m1 FINANCER_SMOKE || true)
  if [ -n "$line" ]; then
    echo "$line"
    case "$line" in *"FINANCER_SMOKE OK"*) exit 0 ;; *) adb logcat -d | tail -80; exit 1 ;; esac
  fi
  sleep 2
done
echo "no FINANCER_SMOKE line within 3 minutes"
adb logcat -d | tail -120
exit 1
