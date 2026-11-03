import type { RustSdk } from "./rustSdk";

// A phone: the SDK as a native JSI module, built by scripts/enable-sdk.sh (needs the Android NDK or
// Xcode, and a custom build: it does not run in Expo Go).
const bindings = require("financer-sdk-bindings");

export const rustSdk: RustSdk | null = {
  Wire: bindings.Wire,
};
