import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { PAGES, bookingEntry, eventEntry, pageEntries, priceEntries, searchEntries } from "../src/globalSearch";

const routes = () =>
  readdirSync("src/app")
    .filter((f) => /\.tsx$/.test(f) && !f.startsWith("_") && !f.startsWith("+"))
    .map((f) => (f === "index.tsx" ? "/" : `/${f.replace(/\.tsx$/, "")}`));

describe("the pages of the search", () => {
  it("has an entry for every screen of the app, except the ones with no chrome", () => {
    const listed = new Set(PAGES.map((p) => p.path));
    for (const r of routes()) if (r !== "/onboarding" && r !== "/shop") assert.ok(listed.has(r), `${r} is not in the search`);
  });
  it("only lists screens that exist", () => {
    const real = new Set(routes());
    for (const p of PAGES) assert.ok(real.has(p.path), p.path);
  });
});

describe("one search for the app", () => {
  const entries = [
    ...pageEntries(),
    bookingEntry({ id: 1, booking_date: "2026-11-05", amount_cents: -1299, counterparty: "Netflix International", purpose: "Abo", category: "subscriptions", counterparty_iban: null }),
    bookingEntry({ id: 2, booking_date: "2026-11-02", amount_cents: -87000, counterparty: "Hausverwaltung Schmidt", purpose: "Miete November", category: "housing", counterparty_iban: null }),
    eventEntry({ id: 1, calendar_id: 1, title: "Dentist", notes: null, location: "Praxis Mitte", all_day: false, start_date: "2026-11-05", start_time: "09:00", end_date: "2026-11-05", end_time: "10:00", repeat: { kind: "none", interval: 1, weekdays: [], until: null, count: null }, exceptions: [], reminders: [] }),
    ...priceEntries([
      { item: "milch", item_name: "Milch", reference_pack: "1 l", chain: "aldi", price_cents: 99, shelf_price_cents: 99, product_name: "Frische Milch", is_offer: false, valid_until: null, source: "x" },
      { item: "milch", item_name: "Milch", reference_pack: "1 l", chain: "lidl", price_cents: 89, shelf_price_cents: 89, product_name: "Milch 3,5%", is_offer: false, valid_until: null, source: "x" },
    ]),
  ];
  it("finds a page by what it is for", () => {
    assert.equal(searchEntries(entries, "bank")[0].title, "Bank sync");
    assert.equal(searchEntries(entries, "envelopes")[0].title, "Budget");
  });
  it("finds a booking despite a typo and leads to Spending with that shop in the search", () => {
    const hit = searchEntries(entries, "netfilx")[0];
    assert.equal(hit.title, "Netflix International");
    assert.deepEqual(hit.href, { pathname: "/spending", params: { q: "Netflix International" } });
  });
  it("finds an event and leads to its day", () => {
    const hit = searchEntries(entries, "dentst")[0];
    assert.equal(hit.kind, "event");
    assert.deepEqual(hit.href, { pathname: "/calendar", params: { date: "2026-11-05" } });
  });
  it("shows one price per product, the cheapest", () => {
    const hits = searchEntries(entries, "milch").filter((h) => h.kind === "price");
    assert.equal(hits.length, 1);
    assert.match(hits[0].subtitle, /lidl/);
  });
  it("finds nothing for a blank query", () => assert.deepEqual(searchEntries(entries, "   "), []));
});
