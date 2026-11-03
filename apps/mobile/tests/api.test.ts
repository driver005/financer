import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api, ApiError } from "../src/api/client";
import { apiWith, refusal } from "./fakeWire";

describe("Api", () => {
  it("reads the server's JSON, nulls included", async () => {
    const { api } = apiWith(() => [{ id: 1, counterparty: "REWE", note: null }]);
    const txs = await api.transactions();
    assert.equal(txs[0].counterparty, "REWE");
    assert.equal((txs[0] as unknown as { note: unknown }).note, null);
  });

  it("turns a refusal into an ApiError with the server's message", async () => {
    const { api } = apiWith(() => refusal(400, "set a groceries limit in the budget or pass budget_cents"));
    await assert.rejects(api.affordability(), (e: unknown) => e instanceof ApiError && e.status === 400 && /groceries limit/.test(e.message));
  });

  it("reports 401 as a token problem and keeps 409 distinguishable", async () => {
    const { api } = apiWith((op) => (op === "list_transactions" ? refusal(401, "unauthorized") : refusal(409, "still waiting")));
    await assert.rejects(api.transactions(), (e: unknown) => e instanceof ApiError && e.status === 401 && /token/.test(e.message));
    await assert.rejects(api.confirmSync("abc"), (e: unknown) => e instanceof ApiError && e.status === 409);
  });

  it("keeps the problems of a refused form", async () => {
    const { api } = apiWith(() => refusal(422, "not saved", ["port is not a number"]));
    await assert.rejects(api.saveSettings({}), (e: unknown) => e instanceof ApiError && e.problems[0] === "port is not a number");
  });

  it("handles a call that answers nothing", async () => {
    const { api } = apiWith(() => undefined);
    assert.equal(await api.deleteReceipt(3), undefined);
  });

  it("names the calls and passes values by name, leaving out what is not given", async () => {
    const { api, calls } = apiWith();
    await api.recipes({ budgetCents: 1500, tag: "vegan", limit: 5 });
    await api.affordability(8000, 7);
    await api.affordability();
    await api.confirmSync("a/b c");
    await api.budgetStatus(2026, 3);
    await api.budgetStatusFor("previous", "2026-03-15");
    await api.prices("milch");
    assert.deepEqual(
      calls.map((c) => [c.op, c.args]),
      [
        ["recipes", { budget_cents: 1500, tag: "vegan", limit: 5 }],
        ["affordability", { budget_cents: 8000, days_per_basket: 7 }],
        ["affordability", {}],
        ["confirm_sync", { id: "a/b c" }], // encoding it into a path is the SDK's job
        ["budget_status", { year: 2026, month: 3 }],
        ["budget_status", { period: "previous", date: "2026-03-15" }],
        ["list_prices", { item: "milch" }],
      ],
    );
  });

  it("sends a bank export as the bytes it came in, base64 (it may not be UTF-8)", async () => {
    const { api, calls } = apiWith(() => ({ imported: 1 }));
    const latin1 = new Uint8Array([0x42, 0xfc, 0x63, 0x68, 0x65, 0x72]); // "Bücher" in ISO-8859-1
    await api.importCsv(latin1.buffer);
    assert.deepEqual(calls[0], { app: "finance", op: "import_transactions", args: { csv_base64: Buffer.from(latin1).toString("base64") } });
  });

  it("reads the shopping contracts through the shop app, and gives an empty list when there is none", async () => {
    const answers: Record<string, unknown> = {
      "shop.categories": [
        { id: "mobile_plan", name: "Mobile plan", kind: "subscription" },
        { id: "smartphone", name: "Phone", kind: "product" },
      ],
      "shop.my_plan": { name: "Flex", ends_on: "2027-01-31" },
    };
    const { api, calls } = apiWith();
    // the wire sees app and op separately
    const wired = apiWith((op, _args, call) => answers[`${call.app}.${op}`]);
    assert.deepEqual(await wired.api.shopContracts(), [{ category: "mobile_plan", name: "Mobile plan", plan: "Flex", endsOn: "2027-01-31" }]);
    assert.deepEqual(wired.calls.map((c) => [c.app, c.op]), [["shop", "categories"], ["shop", "my_plan"]]);
    const none = apiWith(() => refusal(404, "no shop"));
    assert.deepEqual(await none.api.shopContracts(), []);
    void api;
    void calls;
  });

  it("health asks the server only when the connection can", async () => {
    const { api } = apiWith();
    assert.equal(await api.health(), true);
  });
});
