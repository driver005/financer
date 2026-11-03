// The "add a product" form: what is typed becomes the request the API takes, or a list of what to fix.

import type { AttributeDef, AttrValue, Offer } from "../api/types";

/** `649`, `649,90`, `1.299,00 €` or `12.5` as cents; null when it is not a price. */
export function parseCents(text: string): number | null {
  let t = text.trim().replace(/€|eur(o)?/gi, "").replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

const YES = ["yes", "ja", "true", "y", "1", "an", "on"];
const NO = ["no", "nein", "false", "n", "0", "aus", "off"];

/** A typed value as the attribute's kind wants it; null for "left empty", undefined when it cannot be read. */
export function parseAttribute(def: Pick<AttributeDef, "kind" | "unit">, text: string): AttrValue | null | undefined {
  const t = text.trim();
  if (!t) return null;
  switch (def.kind ?? "text") {
    case "number": {
      // "5000 mAh", "5,5 in" and "1.299" all mean a number; the unit is the category's, so it is dropped
      const m = /^(-?\d+(?:[.,]\d+)?)(?:\s*[^\d\s]\S*)?$/.exec(t.replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2"));
      return m ? Number(m[1].replace(",", ".")) : undefined;
    }
    case "bool": {
      const v = t.toLowerCase();
      return YES.includes(v) ? true : NO.includes(v) ? false : undefined;
    }
    case "list":
      return t.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    default:
      return t;
  }
}

export type ProductForm = {
  category: string;
  title: string;
  brand: string;
  gtin: string;
  /** The typed value of each attribute, by key. */
  attributes: Record<string, string>;
  shop: string;
  url: string;
  price: string;
  /** For a plan: the monthly price instead of a purchase price. */
  monthly: string;
};

export type NewProductRequest = {
  category: string;
  title: string;
  brand?: string;
  gtin?: string;
  attributes: Record<string, AttrValue>;
  offers: Offer[];
};

export const EMPTY_FORM: ProductForm = { category: "", title: "", brand: "", gtin: "", attributes: {}, shop: "", url: "", price: "", monthly: "" };

/** The request for a form, or what is wrong with it in plain words. */
export function buildProduct(form: ProductForm, defs: AttributeDef[], plan: boolean): { ok: true; request: NewProductRequest } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!form.category) problems.push("Choose a category.");
  if (!form.title.trim()) problems.push("Give it a name.");
  const attributes: Record<string, AttrValue> = {};
  for (const def of defs) {
    const typed = form.attributes[def.key];
    if (typed === undefined) continue;
    const v = parseAttribute(def, typed);
    if (v === undefined) problems.push(`${def.label}: "${typed.trim()}" is not ${def.kind === "number" ? "a number" : def.kind === "bool" ? "yes or no" : "readable"}.`);
    else if (v !== null && !(Array.isArray(v) && v.length === 0)) attributes[def.key] = v;
  }
  const typedPrice = plan ? form.monthly : form.price;
  const cents = parseCents(typedPrice);
  const offers: Offer[] = [];
  if (typedPrice.trim() || form.shop.trim() || form.url.trim()) {
    if (cents === null) problems.push(typedPrice.trim() ? `"${typedPrice.trim()}" is not a price.` : "Add the price, or clear the shop and link.");
    if (!form.shop.trim()) problems.push("Say which shop the price is from.");
    if (form.url.trim() && !/^https?:\/\/\S+$/i.test(form.url.trim())) problems.push("The link must start with http:// or https://.");
    if (cents !== null && form.shop.trim()) {
      offers.push({
        shop: form.shop.trim(),
        url: form.url.trim(),
        price_cents: plan ? 0 : cents,
        in_stock: true,
        condition: "new",
        recurring: plan ? { monthly_cents: cents } : null,
      });
    }
  }
  if (form.gtin.trim() && form.gtin.replace(/\D/g, "").length < 8) problems.push("A barcode has at least 8 digits.");
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    request: {
      category: form.category,
      title: form.title.trim(),
      ...(form.brand.trim() ? { brand: form.brand.trim() } : {}),
      ...(form.gtin.trim() ? { gtin: form.gtin.trim() } : {}),
      attributes,
      offers,
    },
  };
}
