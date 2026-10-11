import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api, ApiError } from "../src/api/client";
import { EmbeddedTransport, RemoteTransport, type EmbeddedBackend } from "../src/api/transport";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body: string }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: "" };
    return { status: r.status, ok: r.status < 300, text: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("RemoteTransport", () => {
  it("calls the global fetch with the global as `this` (browsers throw 'Illegal invocation' otherwise)", async () => {
    const original = globalThis.fetch;
    let thisSeen: unknown = "never called";
    globalThis.fetch = function (this: unknown) {
      thisSeen = this;
      return Promise.resolve({ status: 200, ok: true, text: async () => "ok" } as Response);
    } as unknown as typeof fetch;
    try {
      await new RemoteTransport({ baseUrl: "https://x.test", token: "t" }).send({ method: "GET", path: "/v1/x" });
      await new RemoteTransport({ baseUrl: "https://x.test", token: "t" }).health();
    } finally {
      globalThis.fetch = original;
    }
    assert.ok(thisSeen === undefined || thisSeen === globalThis, `fetch was called with this=${String(thisSeen)}`);
  });

  it("sends the bearer token, joins the base URL and passes the body", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: "[]" }]);
    const t = new RemoteTransport({ baseUrl: "https://example.test///", token: "tok" }, impl);
    const res = await t.send({ method: "POST", path: "/v1/x?y=1", headers: { "Content-Type": "text/csv" }, body: "a;b" });
    assert.deepEqual(res, { status: 200, text: "[]" });
    assert.equal(calls[0].url, "https://example.test/v1/x?y=1");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer tok", "Content-Type": "text/csv" });
    assert.equal(calls[0].init.body, "a;b");
  });

  it("health does not send the token", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: "ok" }]);
    const t = new RemoteTransport({ baseUrl: "https://example.test", token: "secret" }, impl);
    assert.equal(await t.health(), true);
    assert.equal(calls[0].url, "https://example.test/health");
    assert.equal(calls[0].init.headers, undefined);
  });
});

function fakeBackend(status: number, body: string) {
  const seen: Array<{ method: string; pathAndQuery: string; contentType: string | undefined; body: string }> = [];
  const backend: EmbeddedBackend = {
    async handle(req) {
      seen.push({ ...req, body: new TextDecoder().decode(req.body) });
      const bytes = new TextEncoder().encode(body);
      return { status, contentType: "application/json", body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
    },
  };
  return { backend, seen };
}

describe("EmbeddedTransport", () => {
  it("turns text bodies into bytes and maps the content type", async () => {
    const { backend, seen } = fakeBackend(200, '{"imported":1}');
    const res = await new EmbeddedTransport(backend).send({
      method: "POST",
      path: "/v1/transactions/import",
      headers: { "Content-Type": "text/csv" },
      body: "Bücher;1,00",
    });
    assert.deepEqual(res, { status: 200, text: '{"imported":1}' });
    assert.deepEqual(seen[0], { method: "POST", pathAndQuery: "/v1/transactions/import", contentType: "text/csv", body: "Bücher;1,00" });
  });

  it("sends an empty body when there is none", async () => {
    const { backend, seen } = fakeBackend(200, "[]");
    await new EmbeddedTransport(backend).send({ method: "GET", path: "/v1/transactions" });
    assert.equal(seen[0].body, "");
    assert.equal(seen[0].contentType, undefined);
  });
});

describe("Api", () => {
  it("parses JSON from either transport", async () => {
    const { backend } = fakeBackend(200, '[{"id":1,"counterparty":"REWE"}]');
    const api = new Api(new EmbeddedTransport(backend));
    const txs = await api.transactions();
    assert.equal(txs[0].counterparty, "REWE");
  });

  it("turns error bodies into ApiError with the server's message", async () => {
    const { impl } = fakeFetch([{ status: 400, body: '{"error":"set a groceries limit in the budget or pass budget_cents"}' }]);
    const api = new Api(new RemoteTransport({ baseUrl: "https://x.test", token: "t" }, impl));
    await assert.rejects(api.affordability(), (e: unknown) => e instanceof ApiError && e.status === 400 && /groceries limit/.test(e.message));
  });

  it("reports 401 as a token problem and keeps 409 distinguishable", async () => {
    const { impl } = fakeFetch([
      { status: 401, body: "" },
      { status: 409, body: '{"error":"still waiting"}' },
    ]);
    const api = new Api(new RemoteTransport({ baseUrl: "https://x.test", token: "t" }, impl));
    await assert.rejects(api.transactions(), (e: unknown) => e instanceof ApiError && e.status === 401 && /token/.test(e.message));
    await assert.rejects(api.confirmSync("abc"), (e: unknown) => e instanceof ApiError && e.status === 409);
  });

  it("handles 204 and non-JSON error bodies", async () => {
    const { impl } = fakeFetch([
      { status: 204, body: "" },
      { status: 502, body: "<html>bad gateway</html>" },
    ]);
    const api = new Api(new RemoteTransport({ baseUrl: "https://x.test", token: "t" }, impl));
    assert.equal(await api.deleteReceipt(3), undefined);
    await assert.rejects(api.transactions(), (e: unknown) => e instanceof ApiError && e.message === "HTTP 502");
  });

  it("builds query strings and encodes ids", async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: "[]" },
      { status: 200, body: "{}" },
      { status: 200, body: "{}" },
    ]);
    const api = new Api(new RemoteTransport({ baseUrl: "https://x.test", token: "t" }, impl));
    await api.recipes({ budgetCents: 1500, tag: "vegan", limit: 5 });
    await api.affordability(8000, 7);
    await api.confirmSync("a/b c");
    assert.equal(calls[0].url, "https://x.test/v1/recipes?budget_cents=1500&tag=vegan&limit=5");
    assert.equal(calls[1].url, "https://x.test/v1/affordability?budget_cents=8000&days_per_basket=7");
    assert.equal(calls[2].url, "https://x.test/v1/bank/sync/a%2Fb%20c/confirm");
  });

  it("embedded health is always true; remote health asks the server", async () => {
    assert.equal(await new Api(new EmbeddedTransport(fakeBackend(200, "").backend)).health(), true);
    const { impl, calls } = fakeFetch([{ status: 200, body: "ok" }]);
    assert.equal(await new Api(new RemoteTransport({ baseUrl: "https://x.test", token: "t" }, impl)).health(), true);
    assert.equal(calls[0].url, "https://x.test/health");
  });
});
