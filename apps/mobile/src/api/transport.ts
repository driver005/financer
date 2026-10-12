// Pure TypeScript with no React Native imports, so it can be unit-tested in plain Node.

export type TransportRequest = {
  method: string;
  /** Path and query, e.g. `/v1/transactions?x=1`. */
  path: string;
  headers?: Record<string, string>;
  /** Request body: JSON text, CSV text or raw bytes. */
  body?: string | ArrayBuffer;
};

export type TransportResponse = { status: number; text: string };

/** How the app reaches the Financer API: over HTTP, or in-process on the phone. */
export interface Transport {
  send(req: TransportRequest): Promise<TransportResponse>;
}

export type ApiConfig = { baseUrl: string; token: string };

export class RemoteTransport implements Transport {
  constructor(
    private config: ApiConfig,
    // Wrapped, never stored bare: browsers throw "Illegal invocation" when `fetch` is called as a
    // method of another object (`this.fetchImpl(...)`). The global is looked up at call time.
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}${req.path}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${this.config.token}`, ...(req.headers ?? {}) },
      body: req.body as BodyInit | undefined,
    });
    return { status: res.status, text: await res.text() };
  }

  /** Open endpoint that needs no token; checks that the address points at a Financer server. */
  async health(): Promise<boolean> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/health`);
    return res.ok;
  }
}

/**
 * The generated UniFFI binding of `financer-embedded`, reduced to what the app uses. The
 * native module is wrapped to this shape (see docs/EMBEDDED.md); keeping it small means the
 * generated naming can change without touching the rest of the app.
 */
export interface EmbeddedBackend {
  handle(request: {
    method: string;
    pathAndQuery: string;
    contentType?: string;
    body: ArrayBuffer;
  }): Promise<{ status: number; contentType?: string; body: ArrayBuffer }>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Calls the backend that runs inside the app. No network, no token: it is not reachable from outside. */
export class EmbeddedTransport implements Transport {
  constructor(private backend: EmbeddedBackend) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    const body =
      req.body === undefined ? new ArrayBuffer(0) : typeof req.body === "string" ? toArrayBuffer(encoder.encode(req.body)) : req.body;
    const res = await this.backend.handle({
      method: req.method,
      pathAndQuery: req.path,
      contentType: req.headers?.["Content-Type"],
      body,
    });
    return { status: res.status, text: decoder.decode(res.body) };
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
