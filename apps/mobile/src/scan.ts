/**
 * Barcode scan logic without any screen or camera: validating what the camera or the keyboard produced
 * (Rust: crates/logic, scan.rs), ignoring repeated reads (here, beside the camera), and turning the
 * server's answer into rows (Rust).
 */
import type { BasketItem, EanLookup, Observation } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";

export type EanKind = "ean8" | "upc_a" | "ean13";

export type EanCheck = { ok: true; code: string; kind: EanKind } | { ok: false; reason: string };

/** Camera barcode types that are asked for (expo-camera names). */
export const BARCODE_TYPES = ["ean13", "ean8", "upc_a"] as const;

/** Check what was scanned or typed. Spaces and hyphens are ignored. */
export const checkEan = (input: string): EanCheck => logic("scan.check_ean", { input });

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

export const chainName = (chain: string): string => logic("mealplan.chain_name", { chain });

/** `258` -> `2,58 €/kg` */
export const formatUnitPrice = (cents: number, unit: string): string => logic("scan.format_unit_price", { cents, unit });

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

/** Rows for the result card, in the order the server ranked them (cheapest first). */
export const chainRows = (r: EanLookup): ChainRow[] => logic("scan.chain_rows", { r });

export type Headline = {
  kind: "cheapest" | "tie" | "only" | "incomparable" | "none";
  text: string;
};

/** One sentence for the top of the result card. */
export const headline = (r: EanLookup): Headline => logic("scan.headline", { r });

/** Title line of the product, "Vollmilch 3,5% · 1 l". */
export const productTitle = (r: EanLookup): string => logic("scan.product_title", { r });

/** `Rewe · 1,29 € · 03.10.2026` for the list of recent Open Prices observations. */
export const observationLine = (o: Observation): string => logic("scan.observation_line", { o });

export type UsualPlan = {
  /** What to save as the usual items. */
  items: BasketItem[];
  status: "added" | "already";
  /** Something the person should know, if any. */
  note: string | null;
};

type BasketLike = { source: string; items: { item: string; quantity: number }[] };

/**
 * Add a catalog item to the usual items without touching the rest. The comparison only uses the saved
 * list in manual mode, and a generic starter basket is not something the person chose, so it is
 * replaced instead of extended.
 */
export const planAddToUsual = (basket: BasketLike, item: string): UsualPlan => logic("scan.plan_add_to_usual", { basket, item });
