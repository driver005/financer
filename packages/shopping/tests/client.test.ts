import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bind, type App } from "../../wire/src";
import { ShopApiError, ShopClient } from "../src/api/client";

type Seen = { app: App; op: string; args: Record<string, unknown> };

/** A wire that answers with `answer` and remembers what it was asked. */
function fake(answer: (op: string) => string | Error) {
  const log: Seen[] = [];
  const wire = {
    async call(app: App, op: string, args: string) {
      log.push({ app, op, args: JSON.parse(args) });
      const a = answer(op);
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { log, client: new ShopClient(bind(wire, "shop", ShopApiError)) };
}

const refusal = (status: number, message: string, problems: string[] = []) => Object.assign(new Error("Api"), { inner: { status, message, problems } });

describe("ShopClient", () => {
  it("names the call of the shopping API and hands over the request as its body", async () => {
    const { client, log } = fake(() => JSON.stringify({ items: [], category: "smartphone" }));
    const r = await client.search({ query: "handy", profile: { weights: { camera: 3 } } });
    assert.equal(r.category, "smartphone");
    assert.deepEqual(log[0], { app: "shop", op: "search", args: { body: { query: "handy", profile: { weights: { camera: 3 } } } } });
  });

  it("passes ids, paging and filters by name; the SDK builds the paths and encodes them", async () => {
    const { client, log } = fake(() => "[]");
    await client.product("smartphone:google-pixel-9");
    await client.products("smartphone", 10, 20);
    await client.notifications(7, 5);
    await client.deals("smartphone");
    await client.compare(["a", "b"]);
    assert.deepEqual(
      log.map((l) => [l.op, l.args]),
      [
        ["product", { id: "smartphone:google-pixel-9" }],
        ["products", { category: "smartphone", limit: 10, offset: 20 }],
        ["notifications", { after: 7, limit: 5 }],
        ["deals", { category: "smartphone", limit: 30 }],
        ["compare", { product_ids: ["a", "b"] }],
      ],
    );
  });

  it("a call that answers nothing resolves with undefined", async () => {
    const { client } = fake(() => "null");
    assert.equal(await client.deleteWatch(3), undefined);
  });

  it("a refusal keeps its words and its problems", async () => {
    const { client } = fake(() => refusal(422, "a; b", ["a", "b"]));
    await assert.rejects(
      () => client.saveCategory({ id: "x", name: "X" }),
      (e: unknown) => e instanceof ShopApiError && e.status === 422 && e.problems.length === 2 && e.message === "a; b",
    );
  });

  it("explains a refused token", async () => {
    const { client } = fake(() => refusal(401, "unauthorized"));
    await assert.rejects(
      () => client.info(),
      (e: unknown) => e instanceof ShopApiError && e.status === 401 && /token/.test(e.message),
    );
  });

  it("updates a watch by its id", async () => {
    const { client, log } = fake(() => "{}");
    await client.updateWatch({ id: 4, name: "Cheap" });
    assert.deepEqual(log[0].args, { id: 4, watch: { id: 4, name: "Cheap" } });
  });
});
