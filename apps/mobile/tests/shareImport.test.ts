import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyShare, fileUri, holdCsv, takeCsv } from "../src/shareImport";

const file = (fileName: string, mimeType: string, path = "/cache/" + fileName) => ({ files: [{ fileName, mimeType, path }] });

describe("what was shared", () => {
  it("knows a PDF by type or by name", () => {
    assert.deepEqual(classifyShare(file("bon.pdf", "application/pdf")), { kind: "pdf", path: "/cache/bon.pdf", name: "bon.pdf" });
    assert.equal(classifyShare(file("Beleg.PDF", "application/octet-stream")).kind, "pdf");
  });
  it("knows the images the reader takes and says why it cannot take the others", () => {
    assert.deepEqual(classifyShare(file("s.png", "image/png")), { kind: "image", path: "/cache/s.png", name: "s.png", mime: "image/png" });
    assert.equal(classifyShare(file("a.JPG", "")).kind, "image");
    assert.equal(classifyShare(file("a.heic", "image/heic")).kind, "unsupported");
  });
  it("knows an order list", () => {
    assert.equal(classifyShare(file("Retail.OrderHistory.1.csv", "text/csv")).kind, "csv");
    assert.equal(classifyShare(file("orders.csv", "application/octet-stream")).kind, "csv");
  });
  it("takes text with a receipt in it, but not a bare link", () => {
    assert.equal(classifyShare({ text: "REWE Markt\nMilch 1,09\nSUMME 1,09 EUR\nVielen Dank für Ihren Einkauf" }).kind, "text");
    assert.deepEqual(classifyShare({ text: "https://example.com/bon/1", webUrl: "https://example.com/bon/1" }), { kind: "link", url: "https://example.com/bon/1" });
    assert.equal(classifyShare({ text: "  " }).kind, "none");
    assert.equal(classifyShare(null).kind, "none");
  });
  it("says what it cannot read", () => {
    const r = classifyShare(file("x.zip", "application/zip"));
    assert.equal(r.kind, "unsupported");
    if (r.kind === "unsupported") assert.ok(r.what.includes("x.zip"));
  });
});

describe("paths and the held file", () => {
  it("gives a file address either way", () => {
    assert.equal(fileUri("file:///a/b.pdf"), "file:///a/b.pdf");
    assert.equal(fileUri("/a/b.pdf"), "file:///a/b.pdf");
    assert.equal(fileUri("a/b.pdf"), "file:///a/b.pdf");
  });
  it("hands a shared CSV on once", () => {
    holdCsv("o.csv", "a,b");
    assert.deepEqual(takeCsv(), { name: "o.csv", text: "a,b" });
    assert.equal(takeCsv(), null);
  });
});
