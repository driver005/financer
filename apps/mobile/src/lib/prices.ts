/** Idealo-style local price comparison: every item, every discounter, every sale. */
import { allPrices, type PriceRow } from "../db/prices";
import { getStores, offers } from "../db/money";
import { purchases } from "../db/purchases";
import { core } from "../rust/core";
import type { Offer } from "./types";

export type StoreQuote = {
  storeId: string;
  storeName: string;
  cents: number;
  avgCents: number;
  minCents: number;
  maxCents: number;
  samples: number;
  onSale: boolean;
  buyNow: boolean;
  nextDate: string;
  offer?: Offer;
};

export type ComparedItem = {
  name: string;
  quotes: StoreQuote[];
  bestCents: number;
  bestStore: string;
  savingCents: number;
  hasSale: boolean;
};

const STORE_COLORS: Record<string, string> = {
  rewe: "#E2231A", kaufland: "#E30613", lidl: "#0050AA", aldi: "#005CA9",
  penny: "#D99700", netto: "#C9A200", edeka: "#E2231A", real: "#005CA9",
};
export const storeColor = (id: string) => STORE_COLORS[id] ?? "#3C318F";

export async function loadPriceComparison() {
  const [rows, storeRows, offerRows, purchased] = await Promise.all([
    allPrices(), getStores(), offers(), purchases(),
  ]);
  const stores = storeRows.filter((s) => s.active !== 0);
  const storeNames = new Map(stores.map((s) => [s.id, s.name]));

  const byName = new Map<string, PriceRow[]>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  for (const row of purchased) {
    const key = row.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
  }

  const items: ComparedItem[] = [...byName.entries()].map(([key, priceRows]) => {
    const name = priceRows[0]?.name ?? purchased.find((p) => p.name.toLowerCase() === key)?.name ?? key;
    const lowerName = name.toLowerCase();
    const quotes: StoreQuote[] = [];
    for (const store of stores) {
      const series = priceRows.filter((p) => p.storeId === store.id);
      if (!series.length) continue;
      const stats = core.priceStats(series, name, store.id) as {
        current: number; min: number; max: number; avg: number;
        series: { date: string; cents: number }[];
      };
      const forecast = core.forecast(series, name, store.id) as { buyNow: boolean; nextDate: string };
      const offer = offerRows.find((o) => o.storeId === store.id &&
        (o.product.toLowerCase().includes(lowerName) || lowerName.includes(o.product.toLowerCase())));
      quotes.push({
        storeId: store.id,
        storeName: store.name,
        cents: stats.current,
        avgCents: stats.avg,
        minCents: stats.min,
        maxCents: stats.max,
        samples: stats.series.length,
        onSale: (stats.min < stats.avg * 0.9 && stats.current <= stats.min * 1.05) || !!offer,
        buyNow: forecast.buyNow,
        nextDate: forecast.nextDate,
        offer,
      });
    }
    quotes.sort((a, b) => a.cents - b.cents);
    const best = quotes[0];
    const avg = quotes.length ? quotes.reduce((sum, q) => sum + q.avgCents, 0) / quotes.length : 0;
    return {
      name,
      quotes,
      bestCents: best?.cents ?? 0,
      bestStore: best?.storeName ?? "",
      savingCents: best ? Math.max(0, Math.round(avg - best.cents)) : 0,
      hasSale: quotes.some((q) => q.onSale),
    };
  }).sort((a, b) => (b.hasSale ? 1 : 0) - (a.hasSale ? 1 : 0) || a.name.localeCompare(b.name));

  return { stores, items, offerCount: offerRows.length };
}

export async function saveItemPrice(name: string, storeId: string, cents: number) {
  const { addPrice } = await import("../db/prices");
  await addPrice({ storeId, name, cents, date: new Date().toISOString().slice(0, 10) });
}
