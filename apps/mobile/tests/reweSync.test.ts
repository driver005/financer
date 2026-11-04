import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_PER_RUN, detailScript, idsToRead, isReceiptId, isReweUrl, isShopPage, localStamp, parseList, parseMessage, runText, toImport } from "../src/reweSync";

const LIST = JSON.stringify({
  items: [
    { receiptId: "A1-b2", receiptTimestamp: 1772470800000, receiptTotalPrice: 367 },
    { receiptId: 77, receiptTimestamp: "2026-03-01T10:00:00+01:00", receiptTotalPrice: 299 },
    { receiptId: "bad id", receiptTimestamp: 1, receiptTotalPrice: 1 },
    { receiptId: "no-total", receiptTimestamp: 1772470800 },
  ],
});

const DETAIL = JSON.stringify({
  marketName: "REWE Köln-Ehrenfeld",
  articles: [
    { quantity: 2, productName: "Vollmilch 3,5%", unitPrice: 109, totalPrice: 218 },
    { quantity: 1, productName: "Bio Bananen", totalPrice: 149 },
    { quantity: 1, totalPrice: 25 }, // deposit: no product name
    { quantity: 1.5, productName: "Käse", totalPrice: 400 },
  ],
});

describe("addresses", () => {
  it("only REWE's own pages load, over https", () => {
    assert.equal(isReweUrl("https://shop.rewe.de/mein-konto"), true);
    assert.equal(isReweUrl("https://account.rewe.de/login?x=1"), true);
    assert.equal(isReweUrl("https://rewe.de"), true);
    assert.equal(isReweUrl("http://shop.rewe.de/"), false);
    assert.equal(isReweUrl("https://rewe.de.evil.example/"), false);
    assert.equal(isReweUrl("https://evilrewe.de/"), false);
    assert.equal(isReweUrl("javascript:alert(1)"), false);
  });
  it("trusts messages only from the shop page itself", () => {
    assert.equal(isShopPage("https://shop.rewe.de/mein-konto"), true);
    assert.equal(isShopPage("https://account.rewe.de/"), false);
    assert.equal(isShopPage("https://shop.rewe.de.evil.example/"), false);
    assert.equal(isShopPage(undefined), false);
  });
});

describe("messages from the page", () => {
  it("accepts the three kinds and nothing else", () => {
    assert.deepEqual(parseMessage('{"kind":"done"}'), { kind: "done" });
    assert.deepEqual(parseMessage('{"kind":"list","status":200,"body":"{}"}'), { kind: "list", status: 200, body: "{}" });
    assert.deepEqual(parseMessage('{"kind":"detail","id":"A1","status":200,"body":"x"}'), { kind: "detail", id: "A1", status: 200, body: "x" });
    for (const bad of ["not json", "42", "null", '{"kind":"list"}', '{"kind":"detail","id":"../x","status":200,"body":""}', '{"kind":"other"}']) {
      assert.equal(parseMessage(bad), null, bad);
    }
  });
  it("puts only safe ids into the script", () => {
    assert.equal(isReceiptId("A1-b_2"), true);
    assert.equal(isReceiptId('x"); alert(1); ("'), false);
    const script = detailScript(["ok-1", 'x"); alert(1); ("', "ok_2"]);
    assert.ok(script.includes('["ok-1","ok_2"]'));
    assert.ok(!script.includes("alert(1)"));
  });
});

describe("the list", () => {
  it("reads the entries it can use and says null when it is not a list", () => {
    const list = parseList(LIST)!;
    assert.deepEqual(list.map((e) => e.id), ["A1-b2", "77", "no-total"]);
    assert.equal(list[0].totalCents, 367);
    assert.equal(list[2].totalCents, null);
    assert.equal(parseList("<html>login</html>"), null);
    assert.equal(parseList('{"items":"x"}'), null);
    assert.equal(parseList("{}"), null);
  });
  it("reads local day and time from milliseconds, seconds or text", () => {
    assert.deepEqual(localStamp(1772470800000, 60), { date: "2026-03-02", time: "18:00" });
    assert.deepEqual(localStamp(1772470800, 60), { date: "2026-03-02", time: "18:00" });
    assert.deepEqual(localStamp("2026-03-01T10:00:00+01:00", 60), { date: "2026-03-01", time: "10:00" });
    assert.deepEqual(localStamp(1772489400000, 60), { date: "2026-03-02", time: "23:10" });
    assert.deepEqual(localStamp(1772493000000, 60), { date: "2026-03-03", time: "00:10" }, "past midnight is the next day");
    assert.equal(localStamp("garbage"), null);
  });
  it("picks the unknown ones, newest first, at most one run's worth", () => {
    const list = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, at: 1, totalCents: 1 }));
    const unknown = list.map((e) => e.id);
    const ids = idsToRead(list, unknown);
    assert.equal(ids.length, MAX_PER_RUN);
    assert.equal(ids[0], "r0");
    assert.deepEqual(idsToRead(list, ["r7", "nope"]), ["r7"]);
  });
});

describe("a receipt", () => {
  const entry = { id: "A1-b2", at: 1772470800000, totalCents: 367 };
  it("becomes lines, leaves out deposit lines and keeps the printed total", () => {
    const r = toImport(entry, DETAIL, 60)!;
    assert.equal(r.date, "2026-03-02");
    assert.equal(r.time, "18:00");
    assert.equal(r.store, "REWE Köln-Ehrenfeld");
    assert.equal(r.total_cents, 367);
    assert.deepEqual(r.lines.map((l) => [l.name, l.quantity, l.total_cents]), [
      ["Vollmilch 3,5%", 2, 218],
      ["Bio Bananen", 1, 149],
      ["Käse", 1, 400], // a quantity that is not a whole number counts as one
    ]);
  });
  it("is nothing when there is no date or no lines or the answer is not JSON", () => {
    assert.equal(toImport({ ...entry, at: null }, DETAIL), null);
    assert.equal(toImport(entry, '{"articles":[]}'), null);
    assert.equal(toImport(entry, "<html>"), null);
    assert.equal(toImport(entry, '{"articles":[{"quantity":1,"totalPrice":25}]}'), null);
  });
});

describe("the sentence at the end", () => {
  it("says what happened", () => {
    assert.equal(runText({ imported: 0, duplicates: 0, skipped: 0, linked: 0 }, 0), "No new receipts.");
    assert.equal(runText({ imported: 2, duplicates: 0, skipped: 1, linked: 1 }, 5), "2 new receipts, 1 matched to a bank payment, 1 could not be read, 5 more follow next time.");
  });
});
