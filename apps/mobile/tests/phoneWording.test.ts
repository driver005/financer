import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { liveSyncMissing } from "../src/bankConnections";
import { servingsText } from "../src/format";
import { lidlStateText } from "../src/receiptSources";

describe("wording that depends on where the backend runs", () => {
  it("never tells a phone user the server is the problem", () => {
    const phone = liveSyncMissing(true);
    assert.match(phone.body, /On-phone settings/);
    assert.ok(!/server|FINANCER_|financer\.toml/i.test(`${phone.title} ${phone.body}`));
    assert.match(lidlStateText("disabled", null, 0, true), /phone/);
    assert.ok(!/server/i.test(lidlStateText("disabled", null, 0, true)));
  });

  it("keeps the server wording for a server", () => {
    const server = liveSyncMissing(false);
    assert.match(server.title, /server/);
    assert.match(server.body, /financer\.toml/);
    assert.match(lidlStateText("disabled", null, 0), /server/);
  });
});

describe("servingsText", () => {
  it("is singular for one", () => {
    assert.equal(servingsText(1), "1 serving");
    assert.equal(servingsText(2), "2 servings");
    assert.equal(servingsText(4), "4 servings");
  });
});
