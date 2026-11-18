/**
 * Pure, zero-dependency helpers for structured error logging (unit-tested).
 * Server side sends these via `logError()` in monitoring.server.ts.
 */

export type LogEvent = {
  level: "error";
  scope: string;
  message: string;
  stack?: string;
  path?: string;
  method?: string;
  timestamp: string;
  extra?: Record<string, unknown>;
};

const MAX_STACK = 4000;
const MAX_MESSAGE = 1000;

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` (caused by: ${err.cause.message})` : "";
    const out: { message: string; stack?: string } = {
      message: `${err.name}: ${err.message}${cause}`,
    };
    if (err.stack) out.stack = err.stack;
    return out;
  }
  if (err instanceof Response) return { message: `Response ${err.status} ${err.url}`.trim() };
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) ?? String(err) };
  } catch {
    return { message: String(err) };
  }
}

/** Path only (no query string: it may carry tokens or personal data). */
export function requestPath(request: Request | undefined): string | undefined {
  if (!request) return undefined;
  try {
    return new URL(request.url).pathname;
  } catch {
    return undefined;
  }
}

export function buildLogEvent(
  scope: string,
  err: unknown,
  extra: { request?: Request | undefined; path?: string | undefined } & Record<
    string,
    unknown
  > = {},
  now: Date = new Date(),
): LogEvent {
  const { request, path, ...rest } = extra;
  const { message, stack } = describe(err);
  const ev: LogEvent = {
    level: "error",
    scope,
    message: message.slice(0, MAX_MESSAGE),
    timestamp: now.toISOString(),
  };
  if (stack) ev.stack = stack.slice(0, MAX_STACK);
  const p = path ?? requestPath(request);
  if (p) ev.path = p;
  if (request?.method) ev.method = request.method;
  if (Object.keys(rest).length) ev.extra = rest;
  return ev;
}

/** Single-line JSON (one log entry per error in Vercel's log viewer). */
export function formatLogLine(ev: LogEvent): string {
  try {
    return JSON.stringify(ev);
  } catch {
    return JSON.stringify({ ...ev, extra: "[unserializable]" });
  }
}

export type SentryDsn = { envelopeUrl: string; publicKey: string; dsn: string };

/** Parses `https://<key>@<host>/<projectId>` (optionally with a path prefix) into the envelope endpoint. */
export function parseSentryDsn(dsn: string | undefined | null): SentryDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn.trim());
    if (!/^https?:$/.test(u.protocol) || !u.username) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const projectId = parts.pop();
    if (!projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = parts.length ? `/${parts.join("/")}` : "";
    return {
      envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`,
      publicKey: u.username,
      dsn: dsn.trim(),
    };
  } catch {
    return null;
  }
}

function eventId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/** Builds a Sentry envelope body (header line, item header line, event JSON). */
export function buildSentryEnvelope(
  ev: LogEvent,
  dsn: SentryDsn,
  opts: { environment?: string; release?: string | undefined; id?: string } = {},
): string {
  const id = opts.id ?? eventId();
  const [type, ...rest] = ev.message.split(": ");
  const event = {
    event_id: id,
    timestamp: ev.timestamp,
    platform: "javascript",
    level: "error",
    logger: ev.scope,
    environment: opts.environment ?? "production",
    ...(opts.release ? { release: opts.release } : {}),
    transaction: ev.path,
    tags: { scope: ev.scope, ...(ev.method ? { method: ev.method } : {}) },
    exception: {
      values: [
        {
          type: rest.length ? type : "Error",
          value: rest.length ? rest.join(": ") : ev.message,
          ...(ev.stack ? { stacktrace: { frames: stackFrames(ev.stack) } } : {}),
        },
      ],
    },
    ...(ev.extra ? { extra: ev.extra } : {}),
  };
  const header = { event_id: id, sent_at: new Date().toISOString(), dsn: dsn.dsn };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
}

/** Minimal V8 stack parser; Sentry expects frames oldest-first. */
export function stackFrames(
  stack: string,
): { function?: string; filename?: string; lineno?: number; colno?: number }[] {
  const frames = [];
  for (const line of stack.split("\n").slice(1, 50)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    frames.push({
      ...(m[1] ? { function: m[1] } : {}),
      filename: m[2]!,
      lineno: Number(m[3]),
      colno: Number(m[4]),
    });
  }
  return frames.reverse();
}

/**
 * Wraps an API route handler (client-safe: the server logger is imported lazily).
 * Unhandled throws are logged as `scope` and re-thrown, so the framework's response
 * (status/body) stays exactly as before.
 */
export function withErrorLogging<A extends { request: Request }>(
  scope: string,
  handler: (ctx: A) => Promise<Response> | Response,
): (ctx: A) => Promise<Response> {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (e) {
      await reportServerError(scope, e, ctx.request);
      throw e;
    }
  };
}

/** Lazy `logError` for route catch blocks; never throws. */
export async function reportServerError(scope: string, err: unknown, request?: Request) {
  try {
    const { logError } = await import("./monitoring.server");
    logError(scope, err, { request });
  } catch {
    console.error(err);
  }
}
