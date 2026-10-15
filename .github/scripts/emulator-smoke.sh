#!/usr/bin/env bash
# Installs the APK on the running emulator, starts it, and waits for the FINANCER_SMOKE line.
set -uo pipefail
apk="$1"
adb install -r "$apk" || exit 1
pkg=$(aapt2 dump packagename "$apk" 2>/dev/null || true)
[ -n "$pkg" ] || pkg=$(sed -n 's/.*"package": *"\([^"]*\)".*/\1/p' apps/mobile/app.json | head -1)
# What went wrong, when the app does not report: its own process, Java crashes, native crashes and
# the JavaScript console, not the last lines of the whole device log (those are mostly Google Play).
diagnose() {
  local pid
  pid=$(adb shell pidof "$pkg" 2>/dev/null | tr -d '\r' || true)
  echo "=== app process: ${pid:-not running (it crashed or was killed)}"
  echo "=== crashes and the JavaScript console"
  adb logcat -d | grep -E "AndroidRuntime|FATAL EXCEPTION|ReactNativeJS|ReactNative:|Hermes|SoLoader|UnsatisfiedLink|libc +: Fatal|DEBUG +: (Abort|signal|backtrace|\*\*\*)|$pkg" | tail -150
  if [ -n "${pid:-}" ]; then echo "=== all lines of pid $pid"; adb logcat -d --pid="$pid" | tail -120; fi
}

adb logcat -c
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null
for _ in $(seq 1 90); do
  line=$(adb logcat -d | grep -m1 FINANCER_SMOKE || true)
  if [ -n "$line" ]; then
    echo "$line"
    case "$line" in
      *"FINANCER_SMOKE OK"*)
        # The screenshot run (native.yml, workflow_dispatch with screenshots) continues here.
        if [ "${SCREENSHOTS:-}" = "true" ]; then
          sleep 10 # let the demo data finish importing
          bash "$(dirname "$0")/emulator-screens.sh" "$pkg" screens || true
        fi
        exit 0 ;;
      *) diagnose; exit 1 ;;
    esac
  fi
  sleep 2
done
echo "no FINANCER_SMOKE line within 3 minutes"
diagnose
exit 1
