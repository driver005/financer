import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Api, type StoreSpend, type StoreSpending } from "../src/api/client";
import { RemoteTransport } from "../src/api/transport";
import {
  barFraction,
  changeText,
  changeTone,
  compareText,
  formatPermille,
  lastVisitText,
  rankedRows,
  rowLabel,
  totalText,
  unmatchedHint,
  viewQuery,
  visitsText,
} from "../src/stores";

function row(over: Partial<StoreSpend>): StoreSpend {
  return {
    chain: "lidl",
    name: "Lidl",
    total_cents: 3777,
    visits: 3,
    average_basket_cents: 1259,
    share_permille: 296,
    last_visit: "2026-10-09",
    previous_total_cents: 4500,
    previous_visits: 1,
    change_cents: -723,
    change_permille: -161,
    ...over,
  };
}

function report(over: Partial<StoreSpending> = {}): StoreSpending {
  return {
    start: "2026-10-01",
    end: "2026-10-31",
    periods: 1,
    compare_start: "2026-09-01",
    compare_end: "2026-09-11",
    compare_is_partial: true,
    total_cents: 12777,
    previous_total_cents: 11000,
    chains: [row({ chain: "rewe", name: "REWE", total_cents: 6000, change_cents: 0, change_permille: 0, previous_total_cents: 6000 }), row({})],
    other: row({ chain: "other", name: "Other groceries", total_cents: 1000, visits: 1, previous_total_cents: 0, change_cents: 1000, change_permille: null }),
    ...over,
  };
}

describe("formatPermille", () => {
  it("writes tenths of a percent the German way", () => {
    assert.equal(formatPermille(123), "12,3 %");
    assert.equal(formatPermille(470), "47 %");
    assert.equal(formatPermille(5), "0,5 %");
    assert.equal(formatPermille(0), "0 %");
    assert.equal(formatPermille(1000), "100 %");
    assert.equal(formatPermille(-333), "-33,3 %");
    assert.equal(formatPermille(-5), "-0,5 %");
  });
});

describe("change", () => {
  it("is up, down, same or new", () => {
    assert.equal(changeTone(row({ change_cents: 100, change_permille: 25 })), "up");
    assert.equal(changeTone(row({})), "down");
    assert.equal(changeTone(row({ change_cents: 0, change_permille: 0 })), "flat");
    assert.equal(changeTone(row({ previous_total_cents: 0, change_cents: 3777, change_permille: null })), "new");
    assert.equal(changeTone(row({ total_cents: 0, previous_total_cents: 0, change_cents: 0, change_permille: null })), "flat");
  });

  it("words the chip", () => {
    assert.equal(changeText(row({})), "-16,1 %");
    assert.equal(changeText(row({ change_cents: 250, change_permille: 55 })), "+5,5 %");
    assert.equal(changeText(row({ change_cents: 0, change_permille: 0 })), "same");
    assert.equal(changeText(row({ previous_total_cents: 0, change_cents: 3777, change_permille: null })), "new");
  });
});

describe("ranked list", () => {
  it("keeps the server's order and puts unmatched groceries last", () => {
    assert.deepEqual(rankedRows(report()).map((r) => r.chain), ["rewe", "lidl", "other"]);
  });

  it("leaves out an empty unmatched bucket", () => {
    const r = report({ other: row({ chain: "other", total_cents: 0, visits: 0 }) });
    assert.deepEqual(rankedRows(r).map((x) => x.chain), ["rewe", "lidl"]);
    assert.equal(unmatchedHint(r), null);
  });

  it("scales bars to the biggest row", () => {
    const rows = rankedRows(report());
    assert.equal(barFraction(rows[0], rows), 1);
    assert.ok(Math.abs(barFraction(rows[1], rows) - 3777 / 6000) < 1e-9);
    assert.equal(barFraction(rows[0], []), 0);
    assert.equal(barFraction(row({ total_cents: 0 }), [row({ total_cents: 0 })]), 0);
  });
});

describe("texts", () => {
  it("counts visits", () => {
    assert.equal(visitsText(1), "1 visit");
    assert.equal(visitsText(3), "3 visits");
    assert.equal(visitsText(0), "0 visits");
  });

  it("says when the last visit was", () => {
    assert.equal(lastVisitText("2026-10-11", "2026-10-11"), "today");
    assert.equal(lastVisitText("2026-10-10", "2026-10-11"), "yesterday");
    assert.equal(lastVisitText("2026-10-06", "2026-10-11"), "5 days ago");
    assert.equal(lastVisitText("2026-09-01", "2026-10-11"), "01.09.2026");
    assert.equal(lastVisitText("2026-10-20", "2026-10-11"), "20.10.2026");
    assert.equal(lastVisitText(null, "2026-10-11"), null);
    // across a month and a year end
    assert.equal(lastVisitText("2026-12-31", "2027-01-02"), "2 days ago");
  });

  it("says what the figures are compared with", () => {
    assert.equal(compareText(report()), "01.09.2026 - 11.09.2026 (the same number of days)");
    assert.equal(compareText(report({ compare_is_partial: false, compare_end: "2026-09-30" })), "01.09.2026 - 30.09.2026");
  });

  it("summarizes the total", () => {
    assert.equal(totalText(report()), "127,77 € in stores, 17,77 € more than before.");
    assert.equal(totalText(report({ total_cents: 5000, previous_total_cents: 6000 })), "50,00 € in stores, 10,00 € less than before.");
    assert.equal(totalText(report({ total_cents: 5000, previous_total_cents: 5000 })), "50,00 € in stores, the same as before.");
    assert.equal(totalText(report({ total_cents: 5000, previous_total_cents: 0 })), "50,00 € in stores. Nothing to compare with before.");
    assert.equal(totalText(report({ total_cents: 0, previous_total_cents: 0, chains: [] })), "Nothing spent in stores yet.");
  });

  it("points at financer.toml for unmatched groceries", () => {
    assert.match(unmatchedHint(report()) ?? "", /10,00 € of groceries could not be matched.*\[\[stores\]\].*financer\.toml/);
  });

  it("has an accessible label for a row", () => {
    assert.equal(rowLabel(row({})), "Lidl, 37,77 €, 29,6 % of store spending, 3 visits, -16,1 %");
  });
});

describe("views and the API", () => {
  it("maps the period choices to the query", () => {
    assert.deepEqual(viewQuery("current"), { period: "current", n: undefined });
    assert.deepEqual(viewQuery("previous"), { period: "previous", n: undefined });
    assert.deepEqual(viewQuery("last3"), { period: "last_n", n: 3 });
  });

  it("asks the server with the right URLs", async () => {
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(url);
      return { status: 200, ok: true, text: async () => "[]" } as Response;
    }) as unknown as typeof fetch;
    const api = new Api(new RemoteTransport({ baseUrl: "https://x.test", token: "t" }, impl));
    await api.storeSpending("current", { date: "2026-10-11" });
    await api.storeSpending("last_n", { n: 3, date: "2026-10-11" });
    await api.storeSpending("previous", { n: 3 }); // n only counts for last_n
    await api.storeTransactions("bio-company", "previous", { date: "2026-10-11" });
    await api.storeTransactions("other");
    assert.deepEqual(calls, [
      "https://x.test/v1/spending/stores?period=current&date=2026-10-11",
      "https://x.test/v1/spending/stores?period=last_n&n=3&date=2026-10-11",
      "https://x.test/v1/spending/stores?period=previous",
      "https://x.test/v1/spending/stores/bio-company/transactions?period=previous&date=2026-10-11",
      "https://x.test/v1/spending/stores/other/transactions?period=current",
    ]);
  });
});
