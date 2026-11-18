/** @type {import('expo/metro-config').MetroConfig} */
const path = require("node:path");
const config = require("expo/metro-config").getDefaultConfig(__dirname);

config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../../packages/finance-ui")];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@finance/ui": path.resolve(__dirname, "../../packages/finance-ui/src/index.ts"),
};

// expo-sqlite on web loads a WebAssembly build of SQLite.
config.resolver.assetExts.push("wasm");

// SharedArrayBuffer is required by the web SQLite build.
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  middleware(req, res, next);
};

module.exports = config;
