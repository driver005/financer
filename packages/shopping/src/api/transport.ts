// How the module reaches the shopping API: over HTTP (a server) or in-process on the phone.
// Pure TypeScript with no React Native imports, so it runs in plain Node tests.
//
// The shapes match the finance app's transport on purpose: in the bundled app a finance
// `RemoteTransport` is passed to the module as it is, and both apps share one server and token.

export type ShopRequest = {
  method: string;
  /** Path and query, e.g. `/v1/shop/search`. */
  path: string;
  headers?: Record<string, string>;
  body?: string;
};

export type ShopResponse = { status: number; text: string };

export interface ShopTransport {
  send(req: ShopRequest): Promise<ShopResponse>;
}

export type ShopServerConfig = { baseUrl: string; token: string };

export class RemoteShopTransport implements ShopTransport {
  constructor(
    private config: ShopServerConfig,
    // wrapped for the same reason as in the finance app: browsers throw "Illegal invocation"
    // when fetch is called as a method of another object
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async send(req: ShopRequest): Promise<ShopResponse> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}${req.path}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${this.config.token}`, ...(req.headers ?? {}) },
      body: req.body,
    });
    return { status: res.status, text: await res.text() };
  }

  /** The open endpoint; checks that the address points at a server. */
  async health(): Promise<boolean> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/health`);
    return res.ok;
  }
}

/** The generated binding of `ShopBackend` (crates/embedded), reduced to what the module uses. */
export interface ShopBackendHandle {
  handle(request: {
    method: string;
    pathAndQuery: string;
    contentType?: string;
    body: ArrayBuffer;
  }): Promise<{ status: number; contentType?: string; body: ArrayBuffer }>;
  checkDeals?(): Promise<number>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Calls the shopping backend that runs inside the app: no network, no token. */
export class EmbeddedShopTransport implements ShopTransport {
  constructor(private backend: ShopBackendHandle) {}

  async send(req: ShopRequest): Promise<ShopResponse> {
    const bytes = encoder.encode(req.body ?? "");
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = await this.backend.handle({
      method: req.method,
      pathAndQuery: req.path,
      contentType: req.headers?.["Content-Type"],
      body,
    });
    return { status: res.status, text: decoder.decode(res.body) };
  }
}
