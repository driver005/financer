#!/usr/bin/env bash
# Tests of assemble-shop-desktop.sh with stand-in binaries: what is in each bundle, and that a bad
# call fails loudly. Runs in a second; no build needed.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/repo/.github/scripts" "$work/repo/target/release" "$work/web"
cp "$root/.github/scripts/assemble-shop-desktop.sh" "$work/repo/.github/scripts/"
cp -r "$root/deploy" "$work/repo/deploy"
printf 'bin' > "$work/repo/target/release/financer-shop-server"
printf 'bin' > "$work/repo/target/release/financer-server"
printf 'bin' > "$work/repo/target/release/financer-shop-server.exe"
echo '<html></html>' > "$work/web/index.html"
cd "$work/repo"

fail() { echo "FAIL: $1" >&2; exit 1; }
has() { tar tzf "$1" | grep -qx "$2" || fail "$1 does not contain $2"; }

bash .github/scripts/assemble-shop-desktop.sh shop linux-x64 "" start.sh "$work/web" >/dev/null
for f in financer-shop-server start.sh README.txt shop-sources.example.json web/index.html; do
  has financer-shop-desktop-linux-x64.tar.gz "financer-shop-desktop-linux-x64/$f"
done
tar xzOf financer-shop-desktop-linux-x64.tar.gz financer-shop-desktop-linux-x64/start.sh | grep -q FINANCER_SHOP_API_TOKEN \
  || fail "the standalone bundle must start the shop server with its own token"

bash .github/scripts/assemble-shop-desktop.sh bundle linux-x64 "" start.sh "$work/web" >/dev/null
for f in financer-server start.sh README.txt shop-sources.example.json web/index.html; do
  has financer-bundle-desktop-linux-x64.tar.gz "financer-bundle-desktop-linux-x64/$f"
done
tar xzOf financer-bundle-desktop-linux-x64.tar.gz financer-bundle-desktop-linux-x64/README.txt | grep -q "shopping assistant (this build only)" \
  || fail "the bundled bundle's README must explain the shop"

# a missing binary, a missing web app and an unknown variant are errors, not empty bundles
if bash .github/scripts/assemble-shop-desktop.sh shop macos-arm64 "" start.sh "$work/nope" 2>/dev/null; then fail "missing web directory accepted"; fi
if bash .github/scripts/assemble-shop-desktop.sh shop windows-x64 .exe start.bat "$work/web" 2>/dev/null; then
  : # 7z may be absent on this machine; the failure that matters is the next one
fi
rm target/release/financer-server
if bash .github/scripts/assemble-shop-desktop.sh bundle linux-x64 "" start.sh "$work/web" 2>/dev/null; then fail "missing binary accepted"; fi
if bash .github/scripts/assemble-shop-desktop.sh nope linux-x64 "" start.sh "$work/web" 2>/dev/null; then fail "unknown variant accepted"; fi

echo "assemble-shop-desktop: all tests passed"
