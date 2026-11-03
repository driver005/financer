import type { WireLike } from "./index";

/** The connection to a server, as the generated bindings of crates/sdk give it. */
export type WireHandle = WireLike & { health(): Promise<boolean> };

/** What the app uses of the generated bindings. */
export type RustSdk = {
  Wire: new (baseUrl: string, token: string) => WireHandle;
  /** The browser loads the WebAssembly module first; a phone needs nothing. */
  uniffiInitAsync?: () => Promise<void>;
};

// Every request of the app goes through the Rust SDK (crates/sdk, docs/SDK.md). This file is what a
// platform without the bindings gets (Expo Go, plain Node): `null`, and the app says so.
// `rustSdk.web.ts` (the browser: a WebAssembly module) and `rustSdk.native.ts` (a phone: the JSI
// module) replace it for their platform; scripts/enable-sdk.sh makes the bindings they load.
export const rustSdk: RustSdk | null = null;
