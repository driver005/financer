#!/usr/bin/env bash
# Opens every screen of the app on the running emulator (by its financer:// link) and saves a
# screenshot of each, in light and dark. Needs the demo data and on-phone mode that the smoke build
# sets up (apps/mobile/scripts/demo-seed.js), so it runs after emulator-smoke.sh reported OK.
#   emulator-screens.sh <package> <output-dir>
set -uo pipefail
pkg="$1"; out="$2"
mkdir -p "$out"

routes="today spending budget prices recipes settings stores mealplan scan receipts receipt-sources basket rules alerts subscriptions sync trophies onboarding"

# Start fresh so the app reads the mode and the data the smoke run saved.
adb shell am force-stop "$pkg"
sleep 2

shot() { # shot <name>
  adb exec-out screencap -p > "$out/$1.png"
  if command -v convert >/dev/null 2>&1; then convert "$out/$1.png" -resize 600x "$out/$1.png"; fi
}

for scheme in light dark; do
  adb shell cmd uimode night "$([ "$scheme" = dark ] && echo yes || echo no)" >/dev/null
  sleep 2
  first=1
  for r in $routes; do
    url="financer://$([ "$r" = today ] && echo "" || echo "$r")"
    adb shell am start -W -a android.intent.action.VIEW -d "$url" "$pkg" >/dev/null
    # the first screen also loads the JavaScript bundle and starts the Rust backend
    if [ "$first" = 1 ]; then sleep 20; first=0; else sleep 4; fi
    pid=$(adb shell pidof "$pkg" 2>/dev/null | tr -d '\r' || true)
    shot "$scheme-$r"
    # What is really on screen (views, bounds, text), for a few screens, to tell "drawn but invisible"
    # from "never created". The accessibility tree and the full view hierarchy.
    case "$scheme-$r" in
      light-today|light-spending|light-settings|light-onboarding|dark-today)
        adb exec-out uiautomator dump /dev/tty > "$out/ui-$scheme-$r.xml" 2>/dev/null || true
        adb shell dumpsys activity top 2>/dev/null | sed -n '/View Hierarchy/,$p' | head -300 > "$out/views-$scheme-$r.txt" || true ;;
    esac
    echo "captured $scheme-$r${pid:+ (app running, pid $pid)}${pid:- (APP NOT RUNNING: it crashed or was killed)}"
  done
done
adb shell cmd uimode night no >/dev/null
# The app's own log goes next to the pictures (the CI job log is too noisy to read a stack trace in).
adb logcat -d > "$out/logcat-full.txt" || true
grep -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|ReactNative:|Hermes|SoLoader|UnsatisfiedLink|libc +: Fatal|DEBUG +: |tombstone|financer|$pkg" "$out/logcat-full.txt" > "$out/logcat-app.txt" || true
rm -f "$out/logcat-full.txt"
echo "== crashes during the run:"
grep -c "FATAL EXCEPTION" "$out/logcat-app.txt" || true
grep -A12 "FATAL EXCEPTION" "$out/logcat-app.txt" | head -60 || true
ls -l "$out" | head -50
