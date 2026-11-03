import { Asset } from "expo-asset";

import type { RustSdk } from "./rustSdk";

// The browser: the SDK as WebAssembly, loaded once through the asset registry (metro.config.js
// registers `.wasm`). Without the generated bindings this file is not bundled (see MailEntry).
const bindings = require("../../../sdk-bindings/src/generated-web");
const wasm = require("../../../sdk-bindings/src/generated-web/financer_sdk.wasm");

export const rustSdk: RustSdk | null = {
  MailSdk: bindings.MailSdk,
  ApiClient: bindings.ApiClient,
  Choice: bindings.Choice,
  ConversationKind: bindings.ConversationKind,
  TemplateKind: bindings.TemplateKind,
  uniffiInitAsync: () => (ready ??= load()),
};

// loaded once, however many parts of the app ask
let ready: Promise<void> | undefined;
async function load(): Promise<void> {
  const asset = Asset.fromModule(wasm);
  await asset.downloadAsync();
  await bindings.uniffiInitAsync(asset.uri);
}
