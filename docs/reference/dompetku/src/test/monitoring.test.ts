import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLogEvent,
  buildSentryEnvelope,
  formatLogLine,
  parseSentryDsn,
  stackFrames,
  withErrorLogging,
} from "@/lib/monitoring";

describe("monitoring", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds a single-line structured event without query strings", () => {
    const req = new Request("https://x.app/api/public/n8n/bot?token=secret", { method: "POST" });
    const ev = buildLogEvent("n8n:bot", new Error("boom"), { request: req, chat: 1 }, new Date(0));
    expect(ev).toMatchObject({
      level: "error",
      scope: "n8n:bot",
      message: "Error: boom",
      path: "/api/public/n8n/bot",
      method: "POST",
      timestamp: "1970-01-01T00:00:00.000Z",
      extra: { chat: 1 },
    });
    expect(ev.stack).toContain("boom");
    const line = formatLogLine(ev);
    expect(line).not.toContain("\n");
    expect(line).not.toContain("secret");
    expect(buildLogEvent("x", "plain").message).toBe("plain");
    expect(buildLogEvent("x", { a: 1 }).message).toBe('{"a":1}');
  });

  it("parses Sentry DSNs", () => {
    expect(parseSentryDsn("https://abc@o1.ingest.sentry.io/42")).toEqual({
      envelopeUrl: "https://o1.ingest.sentry.io/api/42/envelope/",
      publicKey: "abc",
      dsn: "https://abc@o1.ingest.sentry.io/42",
    });
    expect(parseSentryDsn("https://k@host.example/sub/7")?.envelopeUrl).toBe(
      "https://host.example/sub/api/7/envelope/",
    );
    expect(parseSentryDsn("")).toBeNull();
    expect(parseSentryDsn("not a dsn")).toBeNull();
    expect(parseSentryDsn("https://host/42")).toBeNull();
    expect(parseSentryDsn("https://k@host/abc")).toBeNull();
  });

  it("builds a Sentry envelope", () => {
    const dsn = parseSentryDsn("https://abc@o1.ingest.sentry.io/42")!;
    const ev = buildLogEvent("ssr", new TypeError("bad"), { path: "/x" });
    const lines = buildSentryEnvelope(ev, dsn, { id: "e1", environment: "test" })
      .trim()
      .split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event_id: "e1", dsn: dsn.dsn });
    expect(JSON.parse(lines[1]!)).toEqual({ type: "event" });
    const event = JSON.parse(lines[2]!);
    expect(event.environment).toBe("test");
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "bad" });
    expect(event.tags.scope).toBe("ssr");
  });

  it("parses V8 stack frames oldest-first", () => {
    const f = stackFrames("Error: x\n    at inner (/a.js:1:2)\n    at /b.js:3:4");
    expect(f).toEqual([
      { filename: "/b.js", lineno: 3, colno: 4 },
      { function: "inner", filename: "/a.js", lineno: 1, colno: 2 },
    ]);
  });

  it("withErrorLogging passes responses through and rethrows errors", async () => {
    const request = new Request("https://x.app/api/public/n8n/ocr");
    const ok = withErrorLogging("n8n:ocr", async () => new Response("hi", { status: 201 }));
    expect((await ok({ request })).status).toBe(201);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = withErrorLogging("n8n:ocr", async () => {
      throw new Error("kaput");
    });
    await expect(bad({ request })).rejects.toThrow("kaput");
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ scope: "n8n:ocr", path: "/api/public/n8n/ocr" });
  });
});
