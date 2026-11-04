// The shopping module lives outside this app (packages/shopping) and is bundled as source. Metro
// has to watch that folder, and its imports of react, react-native and the expo packages must
// resolve to THIS app's copies (one React, one native module registry).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const shared = path.resolve(__dirname, "../../packages");

config.watchFolders = [...(config.watchFolders ?? []), shared, path.resolve(__dirname, "../sdk-bindings")];
// The Rust SDK as WebAssembly (apps/sdk-bindings, docs/SDK.md) is loaded as an asset.
config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];
// the design system, by its package name
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@financer/ui": path.resolve(shared, "ui"),
  "@financer/shopping": path.resolve(shared, "shopping"),
};
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
// a second copy of React in the shared package would break hooks
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
