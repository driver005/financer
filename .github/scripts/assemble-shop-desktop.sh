#!/usr/bin/env bash
# Assemble a desktop bundle of the shopping assistant (release.yml, job desktop-shop).
#
#   assemble-shop-desktop.sh <shop|bundle> <target> <exe-suffix> <start-script> <web-dir>
#
#   shop    the standalone shopping server  -> financer-shop-desktop-<target>
#   bundle  the finance server with the shop -> financer-bundle-desktop-<target>
#
# Run from the repository root after `cargo build --release`; writes the .zip (Windows) or .tar.gz
# next to it. Plain bash, cp, tar and 7z, so it works on Linux, macOS and Git Bash.
set -euo pipefail

variant="${1:?variant (shop|bundle)}"
target="${2:?target, e.g. linux-x64}"
exe="${3-}"
start="${4:?start script, start.sh or start.bat}"
web="${5:?directory of the built web app}"

case "$variant" in
  shop)
    bin=financer-shop-server
    src=deploy/desktop-shop
    name="financer-shop-desktop-$target"
    ;;
  bundle)
    bin=financer-server
    src=deploy/desktop
    name="financer-bundle-desktop-$target"
    ;;
  *) echo "assemble-shop-desktop: unknown variant '$variant'" >&2; exit 2 ;;
esac

[ -f "target/release/$bin$exe" ] || { echo "assemble-shop-desktop: target/release/$bin$exe is missing" >&2; exit 1; }
[ -d "$web" ] || { echo "assemble-shop-desktop: $web is not a directory" >&2; exit 1; }
[ -f "$src/$start" ] || { echo "assemble-shop-desktop: $src/$start is missing" >&2; exit 1; }

rm -rf "$name"
mkdir "$name"
cp "target/release/$bin$exe" "$name/"
cp -r "$web" "$name/web"
cp "$src/$start" "$src/README.txt" "$name/"
cp deploy/config/shop-sources.example.json "$name/"
if [ "$variant" = bundle ]; then
  cat deploy/desktop/README-shop-addendum.txt >> "$name/README.txt"
fi
if [ "$exe" = ".exe" ]; then
  7z a -tzip "$name.zip" "$name" >/dev/null
  echo "$name.zip"
else
  tar czf "$name.tar.gz" "$name"
  echo "$name.tar.gz"
fi
