#!/usr/bin/env bash
# Builds the Rust SDK (crates/sdk) for an app. The apps reach every server through it (docs/SDK.md),
# so run this once before starting, bundling or building an app.
#
#   scripts/enable-sdk.sh web [app]          browser: WebAssembly, needs wasm-bindgen-cli (see below)
#   scripts/enable-sdk.sh android [app]      phone: needs cargo-ndk and the Android NDK
#   scripts/enable-sdk.sh ios [app]          phone: needs Xcode (macOS)
#
# `app` is the app folder (default: this one, apps/mobile; apps/shopping is the other one that calls
# a server). Expo Go cannot load the native module: a phone needs a development build.
set -euo pipefail
platform="${1:-web}"
case "$platform" in web | android | ios) ;; *) echo "usage: $0 web|android|ios" >&2; exit 2 ;; esac

app="$(cd "${2:-$(dirname "$0")/..}" && pwd)"
bindings="$app/../sdk-bindings"

(cd "$bindings" && npm install --no-audit --no-fund)
case "$platform" in
  web)
    rustup target add wasm32-unknown-unknown
    # the rewriter must be the wasm-bindgen version Cargo.lock resolves; the build names it if it differs
    version="$(grep -A1 '^name = "wasm-bindgen"$' "$bindings/../../Cargo.lock" | sed -n 's/^version = "\(.*\)"/\1/p' | head -1)"
    command -v wasm-bindgen >/dev/null || cargo install wasm-bindgen-cli --version "$version" --locked
    (cd "$bindings" && npx ubrn build wasm2 --config ubrn.config.yaml --release)
    # the generated files import the player and the runtime; the app resolves modules from its own node_modules
    (cd "$app" && npm install --no-save --no-audit --no-fund @ubjs/wasm@0.31.0-6 @ubjs/core@0.31.0-6)
    ;;
  *)
    (cd "$bindings" && npx ubrn build jsi2 "$platform" --config ubrn.config.yaml --release --and-generate)
    # autolinking only reads the app's own package.json; --install-links copies the package, because
    # Metro does not follow links out of the project
    (cd "$app" && npm install --no-audit --no-fund --install-links "$bindings" @ubjs/react-native@0.31.0-6 @ubjs/core@0.31.0-6)
    ;;
esac
echo "Rust SDK built for $platform. Start or bundle the app now (npx expo start / export)."
