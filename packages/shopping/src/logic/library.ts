// The "add a product" form: what is typed becomes the request the API takes, or a list of what to fix.
// The rules are in Rust (crates/logic, shop_misc.rs).

import { logic } from "../../../wire/src/logic";
import type { AttributeDef, AttrValue, Offer } from "../api/types";

/** `649`, `649,90`, `1.299,00 €` or `12.5` as cents; null when it is not a price. */
export const parseCents = (text: string): number | null => logic("shop_misc.parse_cents", { input: text });

/** A typed value as the attribute's kind wants it; null for "left empty", undefined when it cannot be read. */
export function parseAttribute(def: Pick<AttributeDef, "kind" | "unit">, text: string): AttrValue | null | undefined {
  const r = logic<{ kind: "empty" } | { kind: "invalid" } | { kind: "value"; value: AttrValue }>("shop_misc.parse_attribute", { def, input: text });
  return r.kind === "value" ? r.value : r.kind === "empty" ? null : undefined;
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
export const buildProduct = (form: ProductForm, defs: AttributeDef[], plan: boolean): { ok: true; request: NewProductRequest } | { ok: false; problems: string[] } =>
  logic("shop_misc.build_product", { form, defs, plan });
