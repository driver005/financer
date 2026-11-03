// How the apps reach a server: through the Rust SDK (crates/sdk), by the name of a call.
//
// The arguments go in as a JSON object and the answer comes back as JSON text in the shapes the server
// speaks, so a screen reads it as before. Everything else is Rust's: the path, the verb, the encoding,
// whether the answer is what the SDK expects, how a refusal is read, the network and the token.
// Pure TypeScript with no React Native imports, so it runs in plain Node tests.

export type App = "finance" | "shop" | "mail";

/** What the SDK's `Wire` object (and the on-phone backend) offers, reduced to what the apps use. */
export interface WireLike {
  call(app: App, op: string, args: string): Promise<string>;
}

/** A refusal from the server: its status and its words, and one entry per thing to fix in a form. */
export class CallError extends Error {
  constructor(
    public status: number,
    message: string,
    public problems: string[] = [],
  ) {
    super(message);
  }
}

type Refusal = { status?: number; message?: string; problems?: string[] };

/**
 * Reads the error of a generated binding. A refusal (`SdkError.Api`, `EmbeddedError.Refused`) carries a
 * status and the server's words in `inner`; anything else (no network, an answer that was not
 * understood) is status 0 with the message it came with.
 */
export function readRefusal(e: unknown): Refusal & { message: string } {
  const any = e as { inner?: Refusal; message?: string } | null | undefined;
  const inner = any?.inner;
  if (inner && typeof inner.status === "number") {
    return { status: inner.status, message: inner.message ?? "request failed", problems: Array.isArray(inner.problems) ? inner.problems : [] };
  }
  return { status: 0, message: inner?.message ?? any?.message ?? String(e), problems: [] };
}

/** One app of the server, called by name. */
export interface Caller {
  call<T>(op: string, args?: Record<string, unknown>): Promise<T>;
}

/**
 * The calls of one app over a wire. `Failure` is the error class the app's screens already look for
 * (`ApiError`, `ShopApiError`, `MailApiError`); it is built from the refusal.
 */
export function bind(wire: WireLike, app: App, Failure: new (status: number, message: string, problems: string[]) => Error = CallError): Caller {
  return {
    async call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
      let text: string;
      try {
        text = await wire.call(app, op, JSON.stringify(args));
      } catch (e) {
        const r = readRefusal(e);
        throw new Failure(r.status ?? 0, r.message, r.problems ?? []);
      }
      return (text === "null" || text === "" ? undefined : JSON.parse(text)) as T;
    },
  };
}
