import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChainPrice, EanLookup } from "../src/api/client";
import {
  ScanGate,
  chainName,
  chainRows,
  checkEan,
  formatUnitPrice,
  headline,
  observationLine,
  planAddToUsual,
  productTitle,
} from "../src/scan";

function price(chain: string, cents: number, extra: Partial<ChainPrice> = {}): ChainPrice {
  return {
    chain,
    scope: "product",
    price_cents: cents,
    pack: "1 l",
    unit_price_cents: cents,
    unit: "l",
    is_offer: false,
    valid_until: null,
    observed_on: "2026-10-05",
    product_name: "Vollmilch",
    source: "open-prices",
    ...extra,
  };
}

function lookup(chains: ChainPrice[], extra: Partial<EanLookup> = {}): EanLookup {
  return {
    ean: "4006381333931",
    kind: "ean13",
    product_name: "Vollmilch 3,5%",
    pack: "1 l",
    item: "milch",
    item_name: "Milch",
    reference_pack: "1 l",
    chains,
    compared_by: "unit_price",
    cheapest: chains[0]?.chain ?? null,
    tied_cheapest: [],
    observations: [],
    live_lookup: true,
    notes: [],
    ...extra,
  };
}

describe("checkEan", () => {
  it("accepts EAN-13, EAN-8 and UPC-A with a valid check digit", () => {
    assert.deepEqual(checkEan("4006381333931"), { ok: true, code: "4006381333931", kind: "ean13" });
    assert.deepEqual(checkEan("73513537"), { ok: true, code: "73513537", kind: "ean8" });
    assert.deepEqual(checkEan("036000291452"), { ok: true, code: "036000291452", kind: "upc_a" });
  });

  it("ignores spaces and hyphens", () => {
    const r = checkEan(" 4006381 333931 ");
    assert.equal(r.ok && r.code, "4006381333931");
    assert.equal(checkEan("4-006381-333931").ok, true);
  });

  it("explains what is wrong", () => {
    const reason = (s: string) => {
      const r = checkEan(s);
      assert.equal(r.ok, false, s);
      return r.ok ? "" : r.reason;
    };
    assert.match(reason(""), /digits under/);
    assert.match(reason("40063813339A1"), /digits only/);
    assert.match(reason("1234567"), /8, 12 or 13 digits, this one has 7/);
    assert.match(reason("4006381333932"), /last digit/);
    assert.match(reason("14006381333938"), /has 14/);
  });
});

describe("ScanGate", () => {
  it("lets a valid code through once and ignores repeats during the cooldown", () => {
    const gate = new ScanGate(4000);
    assert.equal(gate.accept("4006381333931", 0), "4006381333931");
    gate.done();
    assert.equal(gate.accept("4006381333931", 1000), null);
    assert.equal(gate.accept("4006381333931", 3999), null);
    assert.equal(gate.accept("4006381333931", 4000), "4006381333931");
  });

  it("ignores everything while a lookup is running", () => {
    const gate = new ScanGate();
    assert.equal(gate.accept("4006381333931", 0), "4006381333931");
    assert.equal(gate.accept("73513537", 10), null);
    gate.done();
    assert.equal(gate.accept("73513537", 20), "73513537");
  });

  it("ignores misreads and other barcode content", () => {
    const gate = new ScanGate();
    assert.equal(gate.accept("4006381333932", 0), null); // check digit does not fit
    assert.equal(gate.accept("https://example.com", 1), null);
    assert.equal(gate.accept("", 2), null);
    // a misread did not start a lookup, so the right read still goes through
    assert.equal(gate.accept("4006381333931", 3), "4006381333931");
  });

  it("scanning another product right after is fine", () => {
    const gate = new ScanGate();
    assert.ok(gate.accept("4006381333931", 0));
    gate.done();
    assert.equal(gate.accept("73513537", 100), "73513537");
  });

  it("reset forgets the last code", () => {
    const gate = new ScanGate();
    gate.accept("4006381333931", 0);
    gate.reset();
    assert.equal(gate.accept("4006381333931", 10), "4006381333931");
  });
});

describe("formatting", () => {
  it("formats unit prices in German notation", () => {
    assert.equal(formatUnitPrice(258, "kg"), "2,58 €/kg");
    assert.equal(formatUnitPrice(99, "l"), "0,99 €/l");
  });

  it("names the chains", () => {
    assert.equal(chainName("rewe"), "Rewe");
    assert.equal(chainName("other"), "other");
  });

  it("titles the product with its pack, and copes with unknown products", () => {
    assert.equal(productTitle(lookup([])), "Vollmilch 3,5% · 1 l");
    assert.equal(productTitle(lookup([], { product_name: null, pack: null })), "Milch");
    assert.equal(productTitle(lookup([], { product_name: null, pack: null, item_name: null })), "Unknown product");
  });

  it("describes an observation", () => {
    assert.equal(
      observationLine({ price_cents: 129, date: "2026-10-03", store: "REWE Markt", chain: "rewe", unit_price_cents: 129, unit: "l" }),
      "Rewe · 1,29 € (1,29 €/l) · 03.10.2026",
    );
    assert.equal(
      observationLine({ price_cents: 89, date: "2026-10-04", store: "Edeka", chain: null, unit_price_cents: null, unit: null }),
      "Edeka · 0,89 € · 04.10.2026",
    );
    assert.equal(
      observationLine({ price_cents: 89, date: "2026-10-04", store: null, chain: null, unit_price_cents: null, unit: null }),
      "Unknown store · 0,89 € · 04.10.2026",
    );
  });
});

describe("chainRows and headline", () => {
  const three = lookup([price("aldi", 99), price("lidl", 109), price("rewe", 129)]);

  it("keeps the server's order and marks only the cheapest", () => {
    const rows = chainRows(three);
    assert.deepEqual(
      rows.map((r) => [r.name, r.main, r.isCheapest]),
      [
        ["Aldi", "0,99 €/l", true],
        ["Lidl", "1,09 €/l", false],
        ["Rewe", "1,29 €/l", false],
      ],
    );
    assert.equal(rows[0].detail, "0,99 € for 1 l · seen 05.10.2026");
  });

  it("names the winner and how much cheaper it is", () => {
    const h = headline(three);
    assert.equal(h.kind, "cheapest");
    assert.equal(h.text, "Aldi is cheapest at 0,99 €/l, 0,10 €/l less than Lidl.");
  });

  it("compares the shelf price when there is no unit price", () => {
    const r = lookup(
      [price("lidl", 89, { unit_price_cents: null, unit: null, pack: "6 Stück" }), price("rewe", 109, { unit_price_cents: null, unit: null, pack: "6 Stück" })],
      { compared_by: "pack_price" },
    );
    assert.equal(chainRows(r)[0].main, "0,89 €");
    assert.equal(headline(r).text, "Lidl is cheapest at 0,89 €, 0,20 € less than Rewe.");
  });

  it("says so when only one chain has a price", () => {
    const h = headline(lookup([price("kaufland", 149)]));
    assert.equal(h.kind, "only");
    assert.equal(h.text, "Only Kaufland has a known price: 1,49 €/l.");
  });

  it("reports a tie instead of picking a winner", () => {
    const r = lookup([price("lidl", 99), price("aldi", 99), price("rewe", 129)], { cheapest: null, tied_cheapest: ["lidl", "aldi"] });
    const rows = chainRows(r);
    assert.deepEqual(rows.map((x) => [x.isCheapest, x.isTied]), [[false, true], [false, true], [false, false]]);
    assert.deepEqual(headline(r), { kind: "tie", text: "Lidl and Aldi cost the same." });
    const three3 = lookup([price("lidl", 99), price("aldi", 99), price("kaufland", 99)], { cheapest: null, tied_cheapest: ["lidl", "aldi", "kaufland"] });
    assert.equal(headline(three3).text, "Lidl, Aldi and Kaufland cost the same.");
  });

  it("does not name a winner for prices that cannot be compared", () => {
    const r = lookup([price("lidl", 99, { unit_price_cents: null, unit: null }), price("rewe", 199)], { cheapest: null, compared_by: null });
    assert.equal(headline(r).kind, "incomparable");
  });

  it("handles an empty result", () => {
    assert.equal(headline(lookup([], { cheapest: null })).kind, "none");
    assert.deepEqual(chainRows(lookup([], { cheapest: null })), []);
  });

  it("labels stored item prices as typical prices", () => {
    const r = lookup([price("aldi", 89, { scope: "item", pack: "1 l", observed_on: null, valid_until: "2026-10-20", is_offer: true })]);
    assert.equal(chainRows(r)[0].detail, "0,89 € per 1 l, typical price · until 20.10.2026");
    assert.equal(chainRows(r)[0].isOffer, true);
  });
});

describe("planAddToUsual", () => {
  const manual = { source: "manual", items: [{ item: "milch", quantity: 2 }, { item: "butter", quantity: 1 }] };

  it("appends one pack of a new item and keeps the rest", () => {
    const p = planAddToUsual(manual, "nudeln");
    assert.equal(p.status, "added");
    assert.deepEqual(p.items, [{ item: "milch", quantity: 2 }, { item: "butter", quantity: 1 }, { item: "nudeln", quantity: 1 }]);
    assert.equal(p.note, null);
  });

  it("does not change an item that is already there", () => {
    const p = planAddToUsual(manual, "milch");
    assert.equal(p.status, "already");
    assert.deepEqual(p.items, manual.items);
  });

  it("replaces a generic starter basket instead of extending it", () => {
    const p = planAddToUsual({ source: "starter", items: [{ item: "milch", quantity: 1 }, { item: "brot", quantity: 1 }] }, "milch");
    assert.equal(p.status, "added");
    assert.deepEqual(p.items, [{ item: "milch", quantity: 1 }]);
  });

  it("warns when the list in use is not the manual one", () => {
    assert.match(planAddToUsual({ source: "receipts", items: [] }, "milch").note ?? "", /habit mode to manual/);
    assert.match(planAddToUsual({ source: "spending", items: [] }, "milch").note ?? "", /habit mode to manual/);
  });

  it("does not modify its input", () => {
    const input = { source: "manual", items: [{ item: "milch", quantity: 2 }] };
    planAddToUsual(input, "butter");
    assert.deepEqual(input.items, [{ item: "milch", quantity: 2 }]);
  });
});
