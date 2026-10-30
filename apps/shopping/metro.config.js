// The shopping module lives outside this app (packages/shopping) and is bundled as source. Metro
// has to watch that folder, and its imports of react, react-native and the expo packages must
// resolve to THIS app's copies (one React, one native module registry).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const shared = path.resolve(__dirname, "../../packages");

config.watchFolders = [...(config.watchFolders ?? []), shared];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
// a second copy of React in the shared package would break hooks
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
