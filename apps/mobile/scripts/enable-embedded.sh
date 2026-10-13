#!/usr/bin/env bash
# Builds the Rust backend for the phone and wires it into this app (opt-in; see docs/EMBEDDED.md).
#
#   scripts/enable-embedded.sh android      (needs cargo-ndk + the Android NDK)
#   scripts/enable-embedded.sh ios          (needs Xcode, macOS)
#
# It changes package.json, node_modules and modules/financer-embedded/index.ts in your working
# copy. The committed app stays the no-native-code version that runs in Expo Go; after this the
# app needs a custom build (`npx expo prebuild`, then Gradle or Xcode).
set -euo pipefail
platform="${1:-android}"
case "$platform" in android | ios) ;; *) echo "usage: $0 android|ios" >&2; exit 2 ;; esac

app="$(cd "$(dirname "$0")/.." && pwd)"
bindings="$app/../embedded-bindings"

# 1. Compile the Rust library and generate the TypeScript and native glue next to it.
(cd "$bindings" && npm install --no-audit --no-fund \
  && npx ubrn build jsi2 "$platform" --config ubrn.config.yaml --release --and-generate)

# 2. Make the bindings and the JSI player direct dependencies of the app (autolinking only reads
#    the app's own package.json). --install-links copies the package instead of symlinking it,
#    because Metro does not follow links out of the project.
cd "$app"
npm install --no-audit --no-fund --install-links "$bindings" @ubjs/react-native@0.31.0-6 @ubjs/core@0.31.0-6

# 3. Point the app's wrapper at the real module.
cat > modules/financer-embedded/index.ts <<'TS'
// Written by scripts/enable-embedded.sh: the generated binding of crates/embedded.
export { Backend, generateDeviceSecret } from "financer-embedded-bindings";
export type BackendHandle = import("financer-embedded-bindings").BackendLike;
export type { StartConfig } from "financer-embedded-bindings";
TS
# 4. CI smoke test: run the backend at app start and log the result (see scripts/smoke-entry.js).
if [ "${FINANCER_SMOKE:-}" = "1" ]; then
  cp scripts/smoke-entry.js smoke-entry.js
  npm pkg set main=smoke-entry.js
fi
echo "Embedded backend enabled for $platform. Next: npx expo prebuild --platform $platform"
