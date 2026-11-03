import type { RawClientLike, RustSdk } from "@/mail/rustSdk";

import type { ApiConfig, Transport, TransportRequest, TransportResponse } from "./transport";

// The Rust SDK, in builds made with EXPO_PUBLIC_RUST_SDK=1 (scripts/enable-sdk.sh). The flag is tested
// here with the variable written out, so a build without it leaves the generated bindings out of the
// bundle entirely (the same pattern as the shopping assistant, see src/shop/ShoppingEntry.tsx).
export const rustSdk: RustSdk | null = process.env.EXPO_PUBLIC_RUST_SDK === "1" ? require("@/mail/rustSdk").rustSdk : null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Carries every request in Rust: the network, TLS and the token are the SDK's. The finance app and the
 * shopping assistant keep their typed TypeScript wrappers (they decide what to ask and read the
 * answer); this is what they ask through. It has the shape of both their transports.
 */
export class RustTransport implements Transport {
  constructor(private client: RawClientLike) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    const body = req.body === undefined ? new ArrayBuffer(0) : typeof req.body === "string" ? toArrayBuffer(encoder.encode(req.body)) : req.body;
    const res = await this.client.send({ method: req.method, path: req.path, contentType: req.headers?.["Content-Type"], body });
    return { status: res.status, text: decoder.decode(res.body) };
  }

  /** Open endpoint that needs no token; checks that the address points at a Financer server. */
  health(): Promise<boolean> {
    return this.client.health();
  }
}

/** The Rust transport for a server, or `null` when this build has no SDK or it cannot be loaded (then the caller uses the TypeScript one). */
export async function rustTransportFor(config: ApiConfig): Promise<RustTransport | null> {
  if (!rustSdk) return null;
  try {
    await rustSdk.uniffiInitAsync?.();
    return new RustTransport(new rustSdk.ApiClient(config.baseUrl, config.token));
  } catch (e) {
    console.warn("The Rust SDK could not be loaded; using the TypeScript client.", e);
    return null;
  }
}
