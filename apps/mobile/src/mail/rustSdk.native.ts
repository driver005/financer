import type { SdkModule } from "../../../../packages/mail/src";

// A phone: the SDK as a native JSI module, built by scripts/enable-sdk.sh (needs the Android NDK or
// Xcode, and a custom build: it does not run in Expo Go). Without it this file is not bundled
// (see MailEntry).
const bindings = require("financer-sdk-bindings");

export const rustSdk: SdkModule | null = {
  MailSdk: bindings.MailSdk,
  Choice: bindings.Choice,
  ConversationKind: bindings.ConversationKind,
  TemplateKind: bindings.TemplateKind,
};
