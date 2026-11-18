import type { Offer, Store } from "./types";
import { monthKey } from "./period";

export const SUPERMARKETS: Store[] = [
  { id: "rewe", name: "REWE", aliases: "rewe, rewe markt, rewe center, rewe to go, rewe ebon", active: 1 },
  { id: "kaufland", name: "Kaufland", aliases: "kaufland, kaufland card", active: 1 },
  { id: "lidl", name: "Lidl", aliases: "lidl, lidl plus, lidl markt", active: 1 },
  { id: "aldi", name: "Aldi", aliases: "aldi, aldi nord, aldi sud, aldi süd", active: 1 },
  { id: "penny", name: "Penny", aliases: "penny, penny markt", active: 1 },
  { id: "netto", name: "Netto", aliases: "netto, netto marken-discount, neto", active: 1 },
];

export function matchStore(merchant: string, stores: Store[]): string | null {
  const text = merchant.toLowerCase();
  for (const store of stores) {
    if (!store.active) continue;
    if (store.aliases.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean).some((alias) => text.includes(alias))) {
      return store.id;
    }
  }
  return null;
}

export function autoMatchCount(merchants: string[], stores: Store[]): number {
  return merchants.filter((m) => matchStore(m, stores) !== null).length;
}

/** Parse pasted Angebote text. Lines look like "Milch 1,29 €" or "Lidl: Joghurt 0,99". */
export function parseOffers(text: string, storeId: string, source = "paste"): Offer[] {
  const today = new Date();
  const until = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  const out: Offer[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^[-*•]\s*/, "");
    if (!cleaned) continue;
    const price = cleaned.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?\s*$/i);
    if (!price) continue;
    const product = cleaned.slice(0, price.index).replace(/^[^:]+:\s*/, "").trim();
    if (!product) continue;
    out.push({
      id: 0,
      storeId,
      product,
      price: price[1].replace(".", ",") + " €",
      note: "",
      validFrom: today.toISOString().slice(0, 10),
      validTo: until.toISOString().slice(0, 10),
      source,
      createdAt: Date.now(),
    });
  }
  return out;
}

export type StoreSync = {
  id: string;
  name: string;
  note: string;
  /** All adapters stay on device: paste a receipt/offer export, no cloud relay. */
  kind: "ebon" | "app-export" | "manual";
};

export const STORE_SYNCS: StoreSync[] = [
  { id: "rewe", name: "REWE", note: "eBon receipt paste or exported receipt text", kind: "ebon" },
  { id: "kaufland", name: "Kaufland", note: "Kaufland Card receipt export", kind: "app-export" },
  { id: "lidl", name: "Lidl", note: "Lidl Plus receipt export / Angebote", kind: "app-export" },
  { id: "aldi", name: "Aldi", note: "Receipt text or pasted Angebote", kind: "manual" },
  { id: "penny", name: "Penny", note: "Receipt text or pasted Angebote", kind: "manual" },
  { id: "netto", name: "Netto", note: "Receipt text or pasted Angebote", kind: "manual" },
];

export function storeSummary(transactions: { date: string; amountCents: number; storeId: string | null }[], storeId: string, month = monthKey(new Date())) {
  const rows = transactions.filter((t) => t.storeId === storeId && t.date.startsWith(month));
  const total = rows.reduce((sum, t) => sum + t.amountCents, 0);
  return { visits: rows.length, total, average: rows.length ? Math.round(total / rows.length) : 0 };
}
