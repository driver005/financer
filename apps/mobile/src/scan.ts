/**
 * Barcode scan logic without any React or native code: validating what the camera or the
 * keyboard produced, ignoring repeated reads, and turning the server's answer into rows.
 */
import type { BasketItem, ChainPrice, EanLookup, Observation } from "./api/client";
import { formatCents, formatDate } from "./format";

export type EanKind = "ean8" | "upc_a" | "ean13";

export type EanCheck = { ok: true; code: string; kind: EanKind } | { ok: false; reason: string };

/** Camera barcode types that are asked for (expo-camera names). */
export const BARCODE_TYPES = ["ean13", "ean8", "upc_a"] as const;

/** Same rule as the server: weights 3,1,3,1... from the digit left of the check digit. */
function checksumOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48;
    sum += i % 2 === 1 ? d * 3 : d;
  }
  return sum % 10 === 0;
}

/** Check what was scanned or typed. Spaces and hyphens are ignored. */
export function checkEan(input: string): EanCheck {
  const code = input.replace(/[\s-]/g, "");
  if (code === "") return { ok: false, reason: "Enter the digits under the barcode." };
  if (!/^[0-9]+$/.test(code)) return { ok: false, reason: "A barcode has digits only." };
  const kind: EanKind | null = code.length === 8 ? "ean8" : code.length === 12 ? "upc_a" : code.length === 13 ? "ean13" : null;
  if (!kind) return { ok: false, reason: `A barcode has 8, 12 or 13 digits, this one has ${code.length}.` };
  if (!checksumOk(code)) return { ok: false, reason: "The last digit does not fit. Check the number and try again." };
  return { ok: true, code, kind };
}

/**
 * Lets a camera feed through one read at a time. The camera reports the same barcode many times
 * per second, and a misread produces a different one: only valid codes pass, the same code
 * again only after `cooldownMs`, and nothing while a lookup is running.
 */
export class ScanGate {
  private last: { code: string; at: number } | null = null;
  private busy = false;

  constructor(private readonly cooldownMs = 4000) {}

  /** The normalised code if this read should start a lookup, otherwise `null`. */
  accept(raw: string, now: number): string | null {
    if (this.busy) return null;
    const check = checkEan(raw);
    if (!check.ok) return null;
    if (this.last && this.last.code === check.code && now - this.last.at < this.cooldownMs) return null;
    this.last = { code: check.code, at: now };
    this.busy = true;
    return check.code;
  }

  /** The lookup is over; the next read may start a new one. */
  done(): void {
    this.busy = false;
  }

  /** Forget the last code, for "scan again" on the same product. */
  reset(): void {
    this.last = null;
    this.busy = false;
  }
}

const CHAIN_NAME: Record<string, string> = { aldi: "Aldi", lidl: "Lidl", kaufland: "Kaufland", rewe: "Rewe" };

export function chainName(chain: string): string {
  return CHAIN_NAME[chain] ?? chain;
}

/** `258` -> `2,58 €/kg` */
export function formatUnitPrice(cents: number, unit: string): string {
  return `${formatCents(cents)}/${unit}`;
}

export type ChainRow = {
  key: string;
  chain: string;
  name: string;
  /** The price as the main figure: the unit price when there is one, else the shelf price. */
  main: string;
  /** Smaller line: the pack price, the pack, where the price comes from. */
  detail: string;
  isCheapest: boolean;
  isTied: boolean;
  isOffer: boolean;
};

function scopeDetail(p: ChainPrice): string {
  const parts: string[] = [];
  if (p.scope === "product") {
    parts.push(`${formatCents(p.price_cents)}${p.pack ? ` for ${p.pack}` : ""}`);
    if (p.observed_on) parts.push(`seen ${formatDate(p.observed_on)}`);
  } else {
    parts.push(`${formatCents(p.price_cents)}${p.pack ? ` per ${p.pack}` : ""}, typical price`);
    if (p.valid_until) parts.push(`until ${formatDate(p.valid_until)}`);
  }
  return parts.join(" · ");
}

/** Rows for the result card, in the order the server ranked them (cheapest first). */
export function chainRows(r: EanLookup): ChainRow[] {
  const tied = new Set(r.tied_cheapest);
  return r.chains.map((p, i) => ({
    key: `${p.chain}-${p.scope}-${i}`,
    chain: p.chain,
    name: chainName(p.chain),
    main:
      p.unit_price_cents !== null && p.unit_price_cents !== undefined && p.unit
        ? formatUnitPrice(p.unit_price_cents, p.unit)
        : formatCents(p.price_cents),
    detail: scopeDetail(p),
    isCheapest: r.cheapest === p.chain,
    isTied: tied.has(p.chain),
    isOffer: p.is_offer,
  }));
}

export type Headline = {
  kind: "cheapest" | "tie" | "only" | "incomparable" | "none";
  text: string;
};

/** One sentence for the top of the result card. */
export function headline(r: EanLookup): Headline {
  const rows = chainRows(r);
  if (rows.length === 0) return { kind: "none", text: "No price known at Lidl, Aldi, Kaufland or Rewe." };
  if (r.cheapest && rows.length === 1) {
    return { kind: "only", text: `Only ${rows[0].name} has a known price: ${rows[0].main}.` };
  }
  if (r.cheapest) {
    const first = rows.find((x) => x.isCheapest) ?? rows[0];
    const next = rows.find((x) => !x.isCheapest);
    const gap = next ? savingText(r, first.chain, next.chain) : null;
    return { kind: "cheapest", text: `${first.name} is cheapest at ${first.main}${gap ? `, ${gap}` : ""}.` };
  }
  if (r.tied_cheapest.length > 1) {
    const names = r.tied_cheapest.map(chainName);
    const last = names.pop();
    return { kind: "tie", text: `${names.join(", ")} and ${last} cost the same.` };
  }
  return { kind: "incomparable", text: "These prices are not for the same pack, so there is no cheapest chain." };
}

/** "0,10 €/l less than Lidl", on the unit price when there is one, else on the price shown. */
function savingText(r: EanLookup, cheap: string, other: string): string | null {
  const a = r.chains.find((c) => c.chain === cheap);
  const b = r.chains.find((c) => c.chain === other);
  if (!a || !b) return null;
  const useUnit = a.unit_price_cents != null && b.unit_price_cents != null && a.unit && a.unit === b.unit;
  const diff = useUnit ? b.unit_price_cents! - a.unit_price_cents! : b.price_cents - a.price_cents;
  if (diff <= 0) return null;
  return `${useUnit ? formatUnitPrice(diff, a.unit!) : formatCents(diff)} less than ${chainName(other)}`;
}

/** Title line of the product, "Vollmilch 3,5% · 1 l". */
export function productTitle(r: EanLookup): string {
  const name = r.product_name ?? r.item_name ?? "Unknown product";
  return r.pack ? `${name} · ${r.pack}` : name;
}

/** `Rewe · 1,29 € · 03.10.2026` for the list of recent Open Prices observations. */
export function observationLine(o: Observation): string {
  const store = o.chain ? chainName(o.chain) : (o.store ?? "Unknown store");
  const unit = o.unit_price_cents != null && o.unit ? ` (${formatUnitPrice(o.unit_price_cents, o.unit)})` : "";
  return `${store} · ${formatCents(o.price_cents)}${unit} · ${formatDate(o.date)}`;
}

export type UsualPlan = {
  /** What to save as the usual items. */
  items: BasketItem[];
  status: "added" | "already";
  /** Something the person should know, if any. */
  note: string | null;
};

type BasketLike = { source: string; items: { item: string; quantity: number }[] };

/**
 * Add a catalog item to the usual items without touching the rest. The comparison only uses the
 * saved list in manual mode, and a generic starter basket is not something the person chose, so
 * it is replaced instead of extended.
 */
export function planAddToUsual(basket: BasketLike, item: string): UsualPlan {
  if (basket.items.some((i) => i.item === item) && basket.source !== "starter") {
    return { items: basket.items.map((i) => ({ item: i.item, quantity: i.quantity })), status: "already", note: null };
  }
  const kept = basket.source === "starter" ? [] : basket.items.map((i) => ({ item: i.item, quantity: i.quantity }));
  return {
    items: [...kept, { item, quantity: 1 }],
    status: "added",
    note:
      basket.source === "receipts"
        ? "Your list is learned from receipts right now. Set the habit mode to manual in Settings to use this list."
        : basket.source === "spending"
          ? "Your list comes from your spending right now. Set the habit mode to manual in Settings to use this list."
          : null,
  };
}
