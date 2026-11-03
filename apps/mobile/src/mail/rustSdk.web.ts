import { Asset } from "expo-asset";

import type { SdkModule } from "../../../../packages/mail/src";

// The browser: the SDK as WebAssembly, loaded once through the asset registry (metro.config.js
// registers `.wasm`). Without the generated bindings this file is not bundled (see MailEntry).
const bindings = require("../../../sdk-bindings/src/generated-web");
const wasm = require("../../../sdk-bindings/src/generated-web/financer_sdk.wasm");

export const rustSdk: SdkModule | null = {
  MailSdk: bindings.MailSdk,
  Choice: bindings.Choice,
  ConversationKind: bindings.ConversationKind,
  TemplateKind: bindings.TemplateKind,
  uniffiInitAsync: async () => {
    const asset = Asset.fromModule(wasm);
    await asset.downloadAsync();
    await bindings.uniffiInitAsync(asset.uri);
  },
};
