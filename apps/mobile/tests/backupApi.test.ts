import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "../src/api/client";
import { apiWith, refusal } from "./fakeWire";

describe("encrypted backup client", () => {
  it("sends the passphrase only in the body of create_backup", async () => {
    const { api, calls } = apiWith(() => ({ data_base64: "AAAA", transactions: 2, receipts: 1 }));
    const r = await api.createBackup("correct horse");
    assert.deepEqual(r, { data_base64: "AAAA", transactions: 2, receipts: 1 });
    assert.deepEqual(calls[0], { app: "finance", op: "create_backup", args: { body: { passphrase: "correct horse" } } });
  });

  it("restores with passphrase and base64 data", async () => {
    const { api, calls } = apiWith(() => ({ transactions_added: 2, transactions_known: 0, receipts_added: 1, receipts_known: 0, budget_envelopes: 1, basket_items: 0 }));
    const r = await api.restoreBackup("correct horse", "QUJD");
    assert.equal(r.transactions_added, 2);
    assert.deepEqual(calls[0].args, { body: { passphrase: "correct horse", data_base64: "QUJD" } });
  });

  it("surfaces a wrong passphrase as an ApiError without echoing the passphrase", async () => {
    const { api } = apiWith(() => refusal(400, "Wrong passphrase, or this is not an intact Financer backup."));
    await assert.rejects(
      () => api.restoreBackup("hunter2hunter2", "QUJD"),
      (e: unknown) => e instanceof ApiError && e.status === 400 && /Wrong passphrase/.test(e.message) && !e.message.includes("hunter2"),
    );
  });
});
