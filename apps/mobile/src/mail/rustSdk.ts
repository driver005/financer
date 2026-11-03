import type { SdkModule } from "../../../../packages/mail/src";

// The Rust SDK for the mail client (crates/sdk, bindings in apps/sdk-bindings). This is the build
// without it. `rustSdk.web.ts` (the browser: a WebAssembly module) and `rustSdk.native.ts` (a phone:
// the JSI module) replace this file for their platform; scripts/enable-sdk.sh makes the bindings
// they load. See docs/SDK.md.
export const rustSdk: SdkModule | null = null;
