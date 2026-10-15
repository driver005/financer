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
    shot "$scheme-$r"
    echo "captured $scheme-$r"
  done
done
adb shell cmd uimode night no >/dev/null
echo "== crashes during the run:"
adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime: Process: $pkg" | head -5 || true
ls -l "$out" | head -50
