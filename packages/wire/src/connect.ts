import { rustSdk, type WireHandle } from "./rustSdk";

export type { WireHandle, RustSdk } from "./rustSdk";

export const NO_SDK = "This build has no Rust SDK. Run apps/mobile/scripts/enable-sdk.sh and make a development build (Expo Go cannot load it). See docs/SDK.md.";

/** The connection to a server, made by the Rust SDK. Rejects when this build has none. */
export async function wireFor(config: { baseUrl: string; token: string }): Promise<WireHandle> {
  if (!rustSdk) throw new Error(NO_SDK);
  await rustSdk.uniffiInitAsync?.();
  return new rustSdk.Wire(config.baseUrl, config.token);
}
