#!/usr/bin/env bash
# Builds the Rust SDK (crates/sdk) for the app and turns it on (opt-in; see docs/SDK.md).
#
#   scripts/enable-sdk.sh web                browser: WebAssembly, needs wasm-bindgen-cli (see below)
#   scripts/enable-sdk.sh android            phone: needs cargo-ndk and the Android NDK
#   scripts/enable-sdk.sh ios                phone: needs Xcode (macOS)
#
# Then start or build the app with EXPO_PUBLIC_RUST_SDK=1. Without it (the default) the app uses its
# TypeScript client, which also runs in Expo Go and in any browser. If the SDK cannot be loaded at
# run time, the app falls back to that client by itself.
set -euo pipefail
platform="${1:-web}"
case "$platform" in web | android | ios) ;; *) echo "usage: $0 web|android|ios" >&2; exit 2 ;; esac

app="$(cd "$(dirname "$0")/.." && pwd)"
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
echo "Rust SDK built for $platform. Start the app with EXPO_PUBLIC_RUST_SDK=1 (npx expo start / export)."
