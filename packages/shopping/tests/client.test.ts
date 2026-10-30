import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ShopApiError, ShopClient } from "../src/api/client";
import { EmbeddedShopTransport, RemoteShopTransport, type ShopRequest, type ShopResponse, type ShopTransport } from "../src/api/transport";

function fake(answer: (req: ShopRequest) => ShopResponse): ShopTransport & { log: ShopRequest[] } {
  const log: ShopRequest[] = [];
  return {
    log,
    async send(req) {
      log.push(req);
      return answer(req);
    },
  };
}

describe("ShopClient", () => {
  it("sends JSON to /v1/shop paths and parses the answer", async () => {
    const t = fake(() => ({ status: 200, text: JSON.stringify({ items: [], category: "smartphone" }) }));
    const r = await new ShopClient(t).search({ query: "handy", profile: { weights: { camera: 3 } } });
    assert.equal(r.category, "smartphone");
    assert.equal(t.log[0].path, "/v1/shop/search");
    assert.equal(t.log[0].method, "POST");
    assert.equal(t.log[0].headers?.["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(t.log[0].body ?? ""), { query: "handy", profile: { weights: { camera: 3 } } });
  });

  it("encodes ids and builds query strings", async () => {
    const t = fake(() => ({ status: 200, text: "[]" }));
    const c = new ShopClient(t);
    await c.product("smartphone:google-pixel-9");
    await c.products("smartphone", 10, 20);
    await c.notifications(7, 5);
    assert.equal(t.log[0].path, "/v1/shop/products/smartphone%3Agoogle-pixel-9");
    assert.equal(t.log[1].path, "/v1/shop/products?limit=10&offset=20&category=smartphone");
    assert.equal(t.log[2].path, "/v1/shop/notifications?after=7&limit=5");
  });

  it("treats 204 as nothing and a list of problems as an error with problems", async () => {
    const ok = new ShopClient(fake(() => ({ status: 204, text: "" })));
    assert.equal(await ok.deleteWatch(3), undefined);

    const bad = new ShopClient(fake(() => ({ status: 422, text: JSON.stringify({ error: "a; b", problems: ["a", "b"] }) })));
    await assert.rejects(
      () => bad.saveCategory({ id: "x", name: "X" }),
      (e: unknown) => e instanceof ShopApiError && e.status === 422 && e.problems.length === 2 && e.message === "a; b",
    );
  });

  it("explains a refused token and unreadable errors", async () => {
    await assert.rejects(
      () => new ShopClient(fake(() => ({ status: 401, text: "" }))).info(),
      (e: unknown) => e instanceof ShopApiError && /token/.test(e.message),
    );
    await assert.rejects(
      () => new ShopClient(fake(() => ({ status: 500, text: "<html>boom</html>" }))).info(),
      (e: unknown) => e instanceof ShopApiError && e.status === 500,
    );
  });
});

describe("transports", () => {
  it("the remote transport adds the bearer token and joins the base address", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const t = new RemoteShopTransport({ baseUrl: "https://shop.example/", token: "tok" }, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { status: 200, ok: true, text: async () => "{}" };
    }) as unknown as typeof fetch);
    const res = await t.send({ method: "GET", path: "/v1/shop/info" });
    assert.equal(res.status, 200);
    assert.equal(calls[0].url, "https://shop.example/v1/shop/info");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer tok");
    assert.equal(await t.health(), true);
  });

  it("the embedded transport hands bytes to the backend and decodes the answer", async () => {
    let seen: { method: string; pathAndQuery: string; contentType?: string; body: string } | undefined;
    const t = new EmbeddedShopTransport({
      async handle(r) {
        seen = { method: r.method, pathAndQuery: r.pathAndQuery, contentType: r.contentType, body: new TextDecoder().decode(r.body) };
        const bytes = new TextEncoder().encode('{"ok":true}');
        return { status: 202, body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
      },
    });
    const res = await t.send({ method: "POST", path: "/v1/shop/index", headers: { "Content-Type": "application/json" }, body: '{"query":"ä"}' });
    assert.deepEqual(seen, { method: "POST", pathAndQuery: "/v1/shop/index", contentType: "application/json", body: '{"query":"ä"}' });
    assert.deepEqual(res, { status: 202, text: '{"ok":true}' });
  });
});
