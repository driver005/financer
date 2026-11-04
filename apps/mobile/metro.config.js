const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The shopping assistant (packages/shopping) is bundled as source from outside this folder: Metro
// has to watch it, and its imports of react, react-native and the expo packages must resolve to
// THIS app's copies (one React, one native module registry).
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../../packages"), path.resolve(__dirname, "../sdk-bindings")];
// The Rust SDK as WebAssembly (apps/sdk-bindings, docs/SDK.md) is loaded as an asset.
config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@financer/ui": path.resolve(__dirname, "../../packages/ui"),
};

module.exports = config;
