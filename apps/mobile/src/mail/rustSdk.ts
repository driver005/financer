import type { SdkModule } from "../../../../packages/mail/src";

/** What one request to the server looks like to the SDK's generic client, and what comes back. */
export interface RawClientLike {
  send(request: { method: string; path: string; contentType: string | undefined; body: ArrayBuffer }): Promise<{ status: number; body: ArrayBuffer }>;
  health(): Promise<boolean>;
}

/** The generated bindings of crates/sdk: the typed mail calls and the generic client of every other call. */
export type RustSdk = SdkModule & { ApiClient: new (baseUrl: string, token: string) => RawClientLike };

// The Rust SDK (crates/sdk, bindings in apps/sdk-bindings). This is the build without it.
// `rustSdk.web.ts` (the browser: a WebAssembly module) and `rustSdk.native.ts` (a phone: the JSI
// module) replace this file for their platform; scripts/enable-sdk.sh makes the bindings they load.
// See docs/SDK.md.
export const rustSdk: RustSdk | null = null;
