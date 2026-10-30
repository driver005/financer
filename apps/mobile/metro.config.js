const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// The shopping assistant (packages/shopping) is bundled as source from outside this folder: Metro
// has to watch it, and its imports of react, react-native and the expo packages must resolve to
// THIS app's copies (one React, one native module registry).
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../../packages")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
