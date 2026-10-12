import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api, ApiError } from "../src/api/client";
import { EmbeddedTransport, type EmbeddedBackend } from "../src/api/transport";

function backendReplying(status: number, body: string) {
  const seen: Array<{ method: string; pathAndQuery: string; body: string }> = [];
  const backend: EmbeddedBackend = {
    async handle(req) {
      seen.push({ method: req.method, pathAndQuery: req.pathAndQuery, body: new TextDecoder().decode(req.body) });
      const bytes = new TextEncoder().encode(body);
      return {
        status,
        contentType: "application/json",
        body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      };
    },
  };
  return { api: new Api(new EmbeddedTransport(backend)), seen };
}

describe("encrypted backup client", () => {
  it("sends the passphrase only in the request body of /v1/backup/create", async () => {
    const { api, seen } = backendReplying(200, '{"data_base64":"AAAA","transactions":2,"receipts":1}');
    const r = await api.createBackup("correct horse");
    assert.deepEqual(r, { data_base64: "AAAA", transactions: 2, receipts: 1 });
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].pathAndQuery, "/v1/backup/create");
    assert.deepEqual(JSON.parse(seen[0].body), { passphrase: "correct horse" });
  });

  it("restores with passphrase and base64 data", async () => {
    const { api, seen } = backendReplying(
      200,
      '{"transactions_added":2,"transactions_known":0,"receipts_added":1,"receipts_known":0,"budget_envelopes":1,"basket_items":0}',
    );
    const r = await api.restoreBackup("correct horse", "QUJD");
    assert.equal(r.transactions_added, 2);
    assert.equal(seen[0].pathAndQuery, "/v1/backup/restore");
    assert.deepEqual(JSON.parse(seen[0].body), { passphrase: "correct horse", data_base64: "QUJD" });
  });

  it("surfaces a wrong passphrase as an ApiError without echoing the passphrase", async () => {
    const { api } = backendReplying(400, '{"error":"Wrong passphrase, or this is not an intact Financer backup."}');
    await assert.rejects(
      () => api.restoreBackup("hunter2hunter2", "QUJD"),
      (e: unknown) => e instanceof ApiError && e.status === 400 && /Wrong passphrase/.test(e.message) && !e.message.includes("hunter2"),
    );
  });
});
