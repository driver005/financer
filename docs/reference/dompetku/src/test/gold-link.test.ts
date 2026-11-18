import { describe, expect, it } from "vitest";
import { goldLinkAction, goldLinkedTx } from "../lib/assets";

const base = {
  kind: "buy" as const,
  grams: 2,
  total: 3_000_000,
  place: "Antam",
  occurred_at: "2026-10-03",
  account_id: "a1",
  notes: null,
};

describe("gold linked transaction", () => {
  it("buy becomes expense, sell becomes income", () => {
    expect(goldLinkedTx(base)).toMatchObject({
      kind: "expense",
      amount: 3_000_000,
      description: "Beli emas 2 g · Antam",
      occurred_at: "2026-10-03",
    });
    expect(goldLinkedTx({ ...base, kind: "sell", place: null })).toMatchObject({
      kind: "income",
      description: "Jual emas 2 g",
    });
  });
  it("no account means no transaction", () => {
    expect(goldLinkedTx({ ...base, account_id: null })).toBeNull();
  });
  it("chooses create/update/delete/none", () => {
    expect(goldLinkAction(null, "a1")).toBe("create");
    expect(goldLinkAction("t1", "a1")).toBe("update");
    expect(goldLinkAction("t1", null)).toBe("delete");
    expect(goldLinkAction(null, null)).toBe("none");
  });
});
