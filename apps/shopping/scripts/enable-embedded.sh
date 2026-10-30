#!/usr/bin/env bash
# Builds the Rust backend for the phone and wires its shopping part into this app (opt-in; see
# docs/SHOP.md and docs/EMBEDDED.md).
#
#   scripts/enable-embedded.sh android      (needs cargo-ndk + the Android NDK)
#   scripts/enable-embedded.sh ios          (needs Xcode, macOS)
#
# It is the finance app's script pointed at this app: the native library is the same one
# (crates/embedded) and `ShopBackend` is part of it. It changes package.json, node_modules and
# modules/financer-embedded/index.ts in your working copy; the committed app stays the version that
# runs in Expo Go and in the browser.
set -euo pipefail
platform="${1:-android}"
case "$platform" in android | ios) ;; *) echo "usage: $0 android|ios" >&2; exit 2 ;; esac

app="$(cd "$(dirname "$0")/.." && pwd)"
bindings="$app/../embedded-bindings"

(cd "$bindings" && npm install --no-audit --no-fund \
  && npx ubrn build jsi2 "$platform" --config ubrn.config.yaml --release --and-generate)

cd "$app"
npm install --no-audit --no-fund --install-links "$bindings" @ubjs/react-native@0.31.0-6 @ubjs/core@0.31.0-6

cat > modules/financer-embedded/index.ts <<'TS'
// Written by scripts/enable-embedded.sh: the generated binding of crates/embedded (shopping part).
export { ShopBackend } from "financer-embedded-bindings";
export type { ShopStartConfig } from "financer-embedded-bindings";
TS
echo "Embedded shopping backend enabled for $platform. Next: npx expo prebuild --platform $platform"
