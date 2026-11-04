import { setLogic } from "./logic";
import { rustSdk, type WireHandle } from "./rustSdk";

export type { WireHandle, RustSdk } from "./rustSdk";

export const NO_SDK = "This build has no Rust SDK. Run apps/mobile/scripts/enable-sdk.sh and make a development build (Expo Go cannot load it). See docs/SDK.md.";

let ready: Promise<void> | undefined;

/** Loads the Rust SDK (once) and connects the app's logic to it. Rejects when this build has none. */
export function initSdk(): Promise<void> {
  ready ??= (async () => {
    if (!rustSdk) throw new Error(NO_SDK);
    await rustSdk.uniffiInitAsync?.();
    setLogic(rustSdk.logic);
  })();
  ready.catch(() => {
    ready = undefined; // a failed load can be tried again
  });
  return ready;
}

/** The connection to a server, made by the Rust SDK. Rejects when this build has none. */
export async function wireFor(config: { baseUrl: string; token: string }): Promise<WireHandle> {
  await initSdk();
  return new rustSdk!.Wire(config.baseUrl, config.token);
}
