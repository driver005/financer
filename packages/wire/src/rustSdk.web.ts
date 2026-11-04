import { Asset } from "expo-asset";

import type { RustSdk } from "./rustSdk";

// The browser: the SDK as WebAssembly, loaded once through the asset registry (metro.config.js
// registers `.wasm`). Needs the bindings made by scripts/enable-sdk.sh web.
const bindings = require("../../../apps/sdk-bindings/src/generated-web");
const wasm = require("../../../apps/sdk-bindings/src/generated-web/financer_sdk.wasm");

export const rustSdk: RustSdk | null = {
  Wire: bindings.Wire,
  logic: (name, args) => bindings.logic(name, args),
  uniffiInitAsync: () => (ready ??= load()),
};

// loaded once, however many parts of the app ask
let ready: Promise<void> | undefined;
async function load(): Promise<void> {
  const asset = Asset.fromModule(wasm);
  await asset.downloadAsync();
  await bindings.uniffiInitAsync(asset.uri);
}
